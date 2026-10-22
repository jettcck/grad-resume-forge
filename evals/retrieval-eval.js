'use strict';

// ============================================================
//  检索层评测：BM25 / 向量 / RRF 融合 三路对比
//
//  语料：客观题库 151 题（题干 + 选项 + 解析 + 标签）
//  查询：evals/retrieval-cases.json 里 20 条人工标注的 query
//        8 条 keyword（关键词直白命中）+ 12 条 semantic（需要同义理解）
//
//  指标：
//    hit@k   top-k 里是否命中任一期望题（对「找相关材料」这类任务比 precision 更贴切）
//    MRR     第一个命中项的排名倒数均值（衡量「排得够不够前」）
//
//  用法：
//    node evals/retrieval-eval.js                  # BM25 + 向量 + 融合
//    node evals/retrieval-eval.js --no-vector      # 只跑 BM25（无需 Ollama）
//    node evals/retrieval-eval.js --endpoint http://127.0.0.1:11434
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const retrieval = require(path.join(ROOT, 'packages', 'retrieval', 'dist', 'index.js'));
const { EXAM_BANK } = require(path.join(ROOT, 'dist', 'main', 'exam-bank.js'));

const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'retrieval-cases.json'), 'utf8'));
const CACHE_FILE = path.join(__dirname, '.emb-cache.json');

const argvOf = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const argEndpoint = argvOf('--endpoint', '');
// embedding 模型可切换：不同模型对中文短文本的区分度差别很大，
// 评测必须说清「哪个模型跑出来的数」，否则数字没有可比性。
const argModel = argvOf('--model', 'nomic-embed-text');
const skipVector = process.argv.includes('--no-vector');

const TOP_K = 5;

// ---------------- 语料 ----------------
// 把题干、选项、解析、标签拼成一个可检索文本。
// 标签权重没有单独放大：bigram 已能从标签里命中，额外加权会让调参空间变大而收益不可测。
const docs = EXAM_BANK.map((q) => ({
  id: q.id,
  text: [q.stem, (q.options || []).join(' '), q.explanation || '', (q.tags || []).join(' ')].join(' ').trim()
}));
const docById = new Map(docs.map((d) => [d.id, d]));

// ---------------- 指标 ----------------
function scoreList(hits, expect) {
  const set = new Set(expect);
  const rank = hits.findIndex((h) => set.has(h.id));
  return {
    hit1: rank === 0 ? 1 : 0,
    hit3: rank >= 0 && rank < 3 ? 1 : 0,
    hit5: rank >= 0 && rank < 5 ? 1 : 0,
    rr: rank >= 0 ? 1 / (rank + 1) : 0
  };
}

function summarize(rows) {
  const n = rows.length || 1;
  return {
    n: rows.length,
    hit1: rows.reduce((s, r) => s + r.hit1, 0) / n,
    hit3: rows.reduce((s, r) => s + r.hit3, 0) / n,
    hit5: rows.reduce((s, r) => s + r.hit5, 0) / n,
    mrr: rows.reduce((s, r) => s + r.rr, 0) / n
  };
}

const pct = (x) => (x * 100).toFixed(1) + '%';

function printBlock(title, results) {
  const keyword = summarize(results.filter((r) => r.type === 'keyword'));
  const semantic = summarize(results.filter((r) => r.type === 'semantic'));
  const all = summarize(results);
  console.log('\n' + title);
  console.log('  全部 ' + all.n + ' 条 : hit@1 ' + pct(all.hit1) + ' | hit@3 ' + pct(all.hit3) + ' | hit@5 ' + pct(all.hit5) + ' | MRR ' + all.mrr.toFixed(3));
  console.log('  keyword ' + keyword.n + ' 条 : hit@1 ' + pct(keyword.hit1) + ' | hit@3 ' + pct(keyword.hit3) + ' | hit@5 ' + pct(keyword.hit5) + ' | MRR ' + keyword.mrr.toFixed(3));
  console.log('  semantic ' + semantic.n + ' 条 : hit@1 ' + pct(semantic.hit1) + ' | hit@3 ' + pct(semantic.hit3) + ' | hit@5 ' + pct(semantic.hit5) + ' | MRR ' + semantic.mrr.toFixed(3));
  return { all, keyword, semantic };
}

async function main() {
  console.log('=== 检索评测 · 语料 ' + docs.length + ' 条 · 查询 ' + CASES.cases.length + ' 条 ===');

  // ---------- 1) BM25 ----------
  const t0 = Date.now();
  const bm25 = new retrieval.Bm25Index(docs);
  const buildMs = Date.now() - t0;

  const times = [];
  const bm25Results = CASES.cases.map((c) => {
    const t = Date.now();
    const hits = bm25.search(c.query, TOP_K);
    times.push(Date.now() - t);
    return Object.assign({ id: c.id, type: c.type, hits: hits.map((h) => h.id) }, scoreList(hits, c.expect));
  });
  const avgMs = times.reduce((a, b) => a + b, 0) / (times.length || 1);
  const bm25Summary = printBlock('【BM25】建索引 ' + buildMs + 'ms · 单查询均值 ' + avgMs.toFixed(2) + 'ms', bm25Results);

  // ---------- 2) 向量 ----------
  let vecSummary = null;
  let hybridSummary = null;

  if (skipVector) {
    console.log('\n【向量】已跳过（--no-vector）');
  } else {
    const endpoint = argEndpoint || 'http://127.0.0.1:11434';
    const opts = { endpoint, model: argModel, concurrency: 2, timeoutMs: 120000 };
    const ok = await retrieval.embeddingAvailable(opts);
    if (!ok) {
      console.log('\n【向量】跳过：' + endpoint + ' 上没有可用的 embedding 模型（需 ollama pull nomic-embed-text）');
      console.log('       这不影响 BM25 的结论，但也不能假装向量跑过了。');
    } else {
      // 缓存：语料向量只算一次，避免每次评测都重跑 151 次 embedding
      // 缓存按模型分文件：不同模型的向量维度不同，混用会直接算出错误的相似度
      const cacheFile = CACHE_FILE.replace('.json', '-' + argModel.replace(/[^a-z0-9.-]/gi, '_') + '.json');
      let cache = {};
      if (fs.existsSync(cacheFile)) {
        try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (_) { cache = {}; }
      }
      const need = docs.filter((d) => !cache[d.text]);
      const tEmbed = Date.now();
      if (need.length) {
        const fresh = await retrieval.embedTexts(need.map((d) => d.text), opts);
        for (const [text, vec] of fresh) cache[text] = vec;
        fs.writeFileSync(cacheFile, JSON.stringify(cache));
      }
      const docVecs = new Map(docs.map((d) => [d.id, cache[d.text]]));
      const embedMs = Date.now() - tEmbed;
      console.log('\n【向量 · ' + argModel + '】embedding 语料 ' + docs.length + ' 条（新增 ' + need.length + '，耗时 ' + embedMs + 'ms）');

      const qVecs = await retrieval.embedTexts(CASES.cases.map((c) => c.query), opts);
      const vecTimes = [];
      const vecResults = CASES.cases.map((c) => {
        const t = Date.now();
        const hits = retrieval.cosineTopK(qVecs.get(c.query), docVecs, TOP_K);
        vecTimes.push(Date.now() - t);
        return Object.assign({ id: c.id, type: c.type, hits: hits.map((h) => h.id) }, scoreList(hits, c.expect));
      });
      const vecAvg = vecTimes.reduce((a, b) => a + b, 0) / (vecTimes.length || 1);
      // 查询向量本身的耗时不算进「单查询」，否则会把 embedding 往返算进检索延迟
      vecSummary = printBlock('【向量 · ' + argModel + '】单查询均值（不含查询 embedding）' + vecAvg.toFixed(2) + 'ms', vecResults);

      // ---------- 3) RRF 融合 ----------
      const hybResults = CASES.cases.map((c, i) => {
        const hits = retrieval.rrfFuse([bm25Results[i].hits.map((id, j) => ({ id, score: 0, rank: j + 1 })),
          vecResults[i].hits.map((id, j) => ({ id, score: 0, rank: j + 1 }))], { k: 60, topK: TOP_K });
        return Object.assign({ id: c.id, type: c.type, hits: hits.map((h) => h.id) }, scoreList(hits, c.expect));
      });
      hybridSummary = printBlock('【RRF 融合】k=60', hybResults);
    }
  }

  // ---------- 失败样本 ----------
  const shown = bm25Results.filter((r) => !r.hit5).slice(0, 6);
  if (shown.length) {
    console.log('\n【BM25 未命中示例】（用于说明它为什么需要语义层补）');
    shown.forEach((r) => {
      const c = CASES.cases.find((x) => x.id === r.id);
      console.log('  ' + r.id + ' 「' + c.query.slice(0, 30) + '…」 期望 ' + c.expect.join(',') + ' 实得 ' + (r.hits.slice(0, 3).join(',') || '无'));
    });
  }

  // ---------- 结论 ----------
  console.log('\n=== 结论 ===');
  if (vecSummary && hybridSummary) {
    const d1 = hybridSummary.all.hit3 - bm25Summary.all.hit3;
    const d2 = hybridSummary.all.mrr - bm25Summary.all.mrr;
    console.log('RRF 融合相对纯 BM25：hit@3 ' + (d1 >= 0 ? '+' : '') + (d1 * 100).toFixed(1) + 'pt，MRR ' + (d2 >= 0 ? '+' : '') + d2.toFixed(3));
    if (bm25Summary.semantic.hit3 > bm25Summary.keyword.hit3) {
      console.log('注意：BM25 在 semantic 组上不比 keyword 组差，说明这 12 条「语义」query 的用词仍然落在题库词汇里，');
      console.log('      真正的同义改写（如「挡住」vs「防止」）才是向量层的价值区间，需要更刁钻的 query 才能拉开差距。');
    }
  } else {
    console.log('只跑了 BM25。向量层的数字必须实测得出，不能用估算代替。');
  }
  console.log('');
}

main().catch((err) => {
  console.error('FAILED: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
