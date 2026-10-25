'use strict';

// Agent 侧的知识检索适配：把已独立评测的题库检索层接入工具链。
// 语料沿用 retrieval-eval 的 exam-bank，保证工具线上结果与 benchmark 使用同一份数据。
import { EXAM_BANK } from './exam-bank';
import {
  Bm25Index,
  cosineTopK,
  embedTexts,
  embeddingAvailable,
  rrfFuse,
  type Doc,
  type Hit,
  type EmbedOptions
} from '../../packages/retrieval/dist/index';

export type RetrievalMode = 'none' | 'bm25' | 'vector' | 'hybrid';

export interface KnowledgeHit {
  id: string;
  rank: number;
  score: number;
  text: string;
  domain: string;
  tags: string[];
}

export interface KnowledgeResult {
  query: string;
  mode: RetrievalMode;
  requestedTopK: number;
  results: KnowledgeHit[];
  vectorAvailable: boolean | null;
  vectorModel: string | null;
  fallbackMode?: 'bm25';
  note: string;
}

const docs: Doc[] = EXAM_BANK.map((q) => ({
  id: q.id,
  text: [q.stem, (q.options || []).join(' '), q.explanation || '', (q.tags || []).join(' ')].join(' ').trim()
}));
const docById = new Map(EXAM_BANK.map((q) => [q.id, q]));
const bm25 = new Bm25Index(docs);

interface VectorCache {
  key: string;
  vectors: Map<string, number[]>;
}
let vectorCache: VectorCache | null = null;

function options(): EmbedOptions {
  return {
    endpoint: process.env.AGENT_RETRIEVAL_ENDPOINT || process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434',
    model: process.env.AGENT_RETRIEVAL_MODEL || 'nomic-embed-text',
    concurrency: 2,
    timeoutMs: Number(process.env.AGENT_RETRIEVAL_TIMEOUT_MS || 60000)
  };
}

function clampTopK(topK: unknown): number {
  const n = typeof topK === 'number' && Number.isFinite(topK) ? Math.floor(topK) : 5;
  return Math.max(1, Math.min(10, n));
}

function asKnowledgeHits(hits: Hit[]): KnowledgeHit[] {
  return hits.map((hit) => {
    const q = docById.get(hit.id);
    return {
      id: hit.id,
      rank: hit.rank,
      score: hit.score,
      text: q ? [q.stem, q.explanation || ''].filter(Boolean).join(' ') : '',
      domain: q ? q.domain : 'unknown',
      tags: q ? q.tags : []
    };
  });
}

async function vectorHits(query: string, topK: number, opts: EmbedOptions): Promise<{ hits: Hit[]; available: boolean }> {
  const key = (opts.endpoint || '') + '|' + (opts.model || '');
  if (!vectorCache || vectorCache.key !== key || vectorCache.vectors.size !== docs.length) {
    const available = await embeddingAvailable(opts);
    if (!available) return { hits: [], available: false };
    const vectors = await embedTexts(docs.map((d) => d.text), opts);
    vectorCache = { key, vectors: new Map(docs.map((d) => [d.id, vectors.get(d.text)!])) };
  }
  const qVec = await embedTexts([query], opts);
  const queryVec = qVec.get(query);
  if (!queryVec) return { hits: [], available: false };
  return { hits: cosineTopK(queryVec, vectorCache.vectors, topK), available: true };
}

/**
 * Agent 的 retrieve_knowledge 工具实现。
 * none 不访问语料；bm25 始终可用；vector/hybrid 只在真实 embedding 可用时返回向量结果。
 */
export async function retrieveKnowledge(queryValue: unknown, topKValue?: unknown, modeValue?: unknown): Promise<KnowledgeResult> {
  const query = String(queryValue == null ? '' : queryValue).trim();
  const requestedTopK = clampTopK(topKValue);
  const mode = (modeValue === 'none' || modeValue === 'vector' || modeValue === 'hybrid' || modeValue === 'bm25')
    ? modeValue : 'bm25';
  if (!query) {
    return { query, mode, requestedTopK, results: [], vectorAvailable: null, vectorModel: null, note: 'query 为空，未执行检索' };
  }
  if (mode === 'none') {
    return { query, mode, requestedTopK, results: [], vectorAvailable: null, vectorModel: null, note: '按请求跳过检索，作为 no-retrieval 对照组' };
  }
  if (mode === 'bm25') {
    return { query, mode, requestedTopK, results: asKnowledgeHits(bm25.search(query, requestedTopK)), vectorAvailable: null, vectorModel: null, note: 'BM25：零依赖、可解释的关键词检索' };
  }

  const opts = options();
  const vector = await vectorHits(query, requestedTopK, opts);
  if (!vector.available) {
    if (mode === 'hybrid') {
      return {
        query, mode, requestedTopK,
        results: asKnowledgeHits(bm25.search(query, requestedTopK)),
        vectorAvailable: false, vectorModel: opts.model || null, fallbackMode: 'bm25',
        note: '向量端点不可用，hybrid 已明确降级为 BM25；未伪造向量结果'
      };
    }
    return {
      query, mode, requestedTopK, results: [], vectorAvailable: false, vectorModel: opts.model || null,
      note: '向量端点不可用；请启动 Ollama 并准备 embedding 模型后重试'
    };
  }
  if (mode === 'vector') {
    return {
      query, mode, requestedTopK, results: asKnowledgeHits(vector.hits),
      vectorAvailable: true, vectorModel: opts.model || null, note: '向量：使用真实 embedding 的余弦相似度'
    };
  }
  const lexical = bm25.search(query, requestedTopK);
  const fused = rrfFuse([lexical, vector.hits], { topK: requestedTopK });
  return {
    query, mode, requestedTopK, results: asKnowledgeHits(fused),
    vectorAvailable: true, vectorModel: opts.model || null, note: 'hybrid：BM25 + 向量的 RRF 融合'
  };
}

export function retrievalCorpusSize(): number {
  return docs.length;
}

export function resetRetrievalCache(): void {
  vectorCache = null;
}
