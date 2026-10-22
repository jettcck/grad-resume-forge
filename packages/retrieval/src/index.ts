// ============================================================
//  packages/retrieval — 轻量检索层（零第三方依赖）
//
//  为什么自己写而不上向量库：
//    语料只有几百条结构化文本（题库 151 题 / 简历要点几十条）。
//    这个规模下暴力余弦的耗时是毫秒级，引向量库只会带来部署成本与调试难度。
//    上向量库的临界点我判断在十万条以上（见 docs/retrieval.md 的测算）。
//
//  三种检索模式，可组合也可单独用：
//    1) BM25      零依赖、可解释、无需联网；对「关键词对得上」的查询很强
//    2) 向量      需要 embedding 模型（Ollama /api/embeddings）；能处理同义与改写
//    3) RRF 融合  把两路排名融合，取长补短（score = Σ 1/(k + rank)）
//
//  分词策略（中文必须处理，否则 BM25 完全失效）：
//    - 英文/数字按连续字母数字切词并转小写
//    - 中文按 **bigram** 切（「高并发」→ 高并/并发），单字块保留单字
//      bigram 是中文检索的常用折中：不需要词典、召回比单字精确、比 jieba 轻
//      代价是会产生「并高」这类无意义组合，但 BM25 的 IDF 会把它们自然压低
// ============================================================

export interface Doc {
  id: string;
  text: string;
}

export interface Hit {
  id: string;
  score: number;
  /** 1-based，便于直接算 MRR 与 recall */
  rank: number;
}

/** 中文 bigram + 英文单词 */
export function tokenize(text: string): string[] {
  const lower = String(text == null ? '' : text).toLowerCase();
  const out: string[] = [];

  // 英文 / 数字 / 常见技术符号（c++、.net、node.js、c#）
  const latin = lower.match(/[a-z0-9][a-z0-9_+#.\-]*/g) || [];
  for (const t of latin) {
    const cleaned = t.replace(/[.\-]+$/, ''); // 去掉句尾的点
    if (cleaned) out.push(cleaned);
  }

  // 中文块内取 bigram
  const cjkBlocks = lower.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const block of cjkBlocks) {
    if (block.length === 1) { out.push(block); continue; }
    for (let i = 0; i + 1 < block.length; i++) out.push(block.slice(i, i + 2));
  }
  return out;
}

// ---------------- BM25 ----------------

interface IndexedDoc {
  id: string;
  tf: Map<string, number>;
  len: number;
}

/**
 * BM25（Okapi）。参数取通用默认 k1=1.5、b=0.75。
 * 没有做「字段权重」——题库的题干/选项/解析拼成一个文本就够，
 * 引入字段权重会让「为什么这个参数是这个值」变得不可解释，收益在几百条语料上不明显。
 */
export class Bm25Index {
  private docs: IndexedDoc[] = [];
  private df = new Map<string, number>();
  private avgLen = 1;
  private readonly k1: number;
  private readonly b: number;

  constructor(docs: Doc[], opts: { k1?: number; b?: number } = {}) {
    this.k1 = opts.k1 == null ? 1.5 : opts.k1;
    this.b = opts.b == null ? 0.75 : opts.b;

    let totalLen = 0;
    for (const d of docs) {
      const tokens = tokenize(d.text);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
      this.docs.push({ id: d.id, tf, len: tokens.length });
      totalLen += tokens.length;
    }
    this.avgLen = this.docs.length ? totalLen / this.docs.length : 1;
  }

  get size(): number { return this.docs.length; }

  search(query: string, topK = 5): Hit[] {
    const qTokens = tokenize(query);
    if (!qTokens.length) return [];
    const N = this.docs.length;
    const qSet = new Set(qTokens);

    const scored = this.docs.map((d) => {
      let score = 0;
      for (const term of qSet) {
        const f = d.tf.get(term);
        if (!f) continue;
        const df = this.df.get(term) || 0;
        // BM25 的 IDF（加 1 防止 log 负数）
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const norm = 1 - this.b + this.b * (d.len / this.avgLen);
        score += idf * (f * (this.k1 + 1)) / (f + this.k1 * norm);
      }
      return { id: d.id, score };
    });

    return scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((x, i) => ({ id: x.id, score: Number(x.score.toFixed(6)), rank: i + 1 }));
  }
}

// ---------------- 向量检索 ----------------

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * 暴力余弦 top-k。
 * 复杂度 O(N·d)：N=151、d=768 时约 11 万次乘加，实测 < 1ms，所以不需要 ANN 索引。
 */
export function cosineTopK(queryVec: number[], docVecs: Map<string, number[]>, topK = 5): Hit[] {
  const scored: Array<{ id: string; score: number }> = [];
  for (const [id, vec] of docVecs) {
    scored.push({ id, score: cosine(queryVec, vec) });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((x, i) => ({ id: x.id, score: Number(x.score.toFixed(6)), rank: i + 1 }));
}

// ---------------- RRF 融合 ----------------

/**
 * Reciprocal Rank Fusion：把多路排名融合。
 * 只看排名不看分数，所以不需要把 BM25 分数与余弦相似度归一化——
 * 这正是它比「加权求和」稳的原因：两路分数量纲完全不同，硬归一化很容易被长尾污染。
 */
export function rrfFuse(lists: Hit[][], opts: { k?: number; topK?: number } = {}): Hit[] {
  const k = opts.k == null ? 60 : opts.k;
  const topK = opts.topK == null ? 5 : opts.topK;
  const acc = new Map<string, number>();

  for (const list of lists) {
    for (const hit of list) {
      acc.set(hit.id, (acc.get(hit.id) || 0) + 1 / (k + hit.rank));
    }
  }
  return [...acc.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id, score], i) => ({ id, score: Number(score.toFixed(6)), rank: i + 1 }));
}

// ---------------- embedding（Ollama） ----------------

export interface EmbedOptions {
  /** 默认 http://127.0.0.1:11434 */
  endpoint?: string;
  /** 默认 nomic-embed-text */
  model?: string;
  /** 并发数：本地模型并发过高会排队，2 已经能打满单卡 */
  concurrency?: number;
  timeoutMs?: number;
}

/**
 * 通过 Ollama 的 /api/embeddings 取向量。
 *
 * 注意：Ollama 这个接口一次只接受一个 prompt；批量要自己并发。
 * 没有做进度回调与重试——失败就让调用方看到，别在检索层偷偷吞掉（吞了会得到「检索结果莫名变少」）。
 */
export async function embedTexts(
  texts: string[],
  opts: EmbedOptions = {}
): Promise<Map<string, number[]>> {
  const endpoint = (opts.endpoint || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const model = opts.model || 'nomic-embed-text';
  const concurrency = Math.max(1, Math.min(8, opts.concurrency || 2));
  const timeoutMs = opts.timeoutMs || 60000;

  const out = new Map<string, number[]>();
  let cursor = 0;

  const worker = async () => {
    while (cursor < texts.length) {
      const idx = cursor++;
      const text = texts[idx];
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(`${endpoint}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: text }),
          signal: ctrl.signal
        });
        if (!res.ok) throw new Error(`embedding ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = await res.json() as { embedding?: number[] };
        if (!data.embedding || !data.embedding.length) throw new Error('embedding 返回空向量');
        out.set(text, data.embedding);
      } finally {
        clearTimeout(timer);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

/** 探测 embedding 端点是否可用（用于评测前快速判断，不抛错） */
export async function embeddingAvailable(opts: EmbedOptions = {}): Promise<boolean> {
  try {
    const m = await embedTexts(['ping'], opts);
    return m.size === 1;
  } catch (_) {
    return false;
  }
}
