'use strict';

// ============================================================
//  检索层评测 v2：BM25 / 向量 / RRF 三路对比
//
//  相比 v1 补的四件事：
//    1) 查询集从 20 条扩到 62 条，分 5 类（keyword / paraphrase /
//       colloquial / multi_hop / out_of_domain），并带分级相关度（grade 2/1）；
//    2) 指标补齐 Recall@5、MRR@10、nDCG@5，不再只有一个 hit@3；
//    3) 每个指标给 bootstrap 95% 置信区间 —— 20 条样本算出来的 80%
//       和 62 条样本算出来的 80% 不是一回事，不标区间的比例数字容易被过度解读；
//    4) 语料外问题单独统计「误召回率」，这是 RAG 最容易被忽略的失败模式。
//
//  产出：benchmarks/retrieval-report.json（含逐 query 结果与配置快照）。
//
//  用法：
//    node evals/retrieval-eval.js                 # BM25 + 向量 + 融合
//    node evals/retrieval-eval.js --no-vector     # 只跑 BM25（无需 Ollama）
//    node evals/retrieval-eval.js --cases evals/retrieval-cases-v2.json
//    node evals/retrieval-eval.js --topk 5 --bootstrap 1000
// ============================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const retrieval = require(path.join(ROOT, 'packages', 'retrieval', 'dist', 'index.js'));
const { EXAM_BANK, BANK_VERSION } = require(path.join(ROOT, 'dist', 'main', 'exam-bank.js'));

const argvOf = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const argEndpoint = argvOf('--endpoint', 'http://127.0.0.1:11434');
const argModel = argvOf('--model', 'nomic-embed-text');
const casesFile = argvOf('--cases', path.join(__dirname, 'retrieval-cases-v2.json'));
const TOP_K = Number(argvOf('--topk', '5'));
const BOOTSTRAP = Number(argvOf('--bootstrap', '1000'));
const MRR_CUTOFF = 10;
const skipVector = process.argv.includes('--no-vector');
const SELF_CHECK = process.argv.includes('--self-check');

const CASES_DOC = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
const CASES = CASES_DOC.cases;

// ---------------- 语料 ----------------
// 与 v1 保持同一拼装口径（题干 + 选项 + 解析 + 标签），否则两版数字不可比。
const DOC_FIELDS = ['stem', 'options', 'explanation', 'tags'];
const docs = EXAM_BANK.map((q) => ({
  id: q.id,
  text: [q.stem, (q.options || []).join(' '), q.explanation || '', (q.tags || []).join(' ')].join(' ').trim()
}));
const docIds = new Set(docs.map((d) => d.id));

// 标注错误必须在跑分之前暴露：期望 id 不存在时，指标会静默变成 0，
// 看起来像「检索器不行」，实际是标注写错了。
function validateCases() {
  const problems = [];
  const seen = new Set();
  for (const c of CASES) {
    if (seen.has(c.id)) problems.push('用例 id 重复：' + c.id);
    seen.add(c.id);
    if (!Array.isArray(c.relevance)) {
      problems.push(c.id + ' 缺少 relevance 数组');
      continue;
    }
    if (c.type === 'out_of_domain' && c.relevance.length) {
      problems.push(c.id + ' 标为 out_of_domain 但给了相关文档');
    }
    if (c.type !== 'out_of_domain' && !c.relevance.length) {
      problems.push(c.id + ' 不是 out_of_domain 却没有相关文档');
    }
    for (const r of c.relevance) {
      if (!docIds.has(r.id)) problems.push(c.id + ' 引用了语料里不存在的文档：' + r.id);
      if (![1, 2].includes(r.grade)) problems.push(c.id + ' 的 grade 只能是 1 或 2：' + JSON.stringify(r));
    }
  }
  return problems;
}

// ---------------- 指标 ----------------
const gain = (grade) => Math.pow(2, grade) - 1;
const discount = (rank) => Math.log2(rank + 1);

function evaluate(hits, relevance) {
  const grades = new Map(relevance.map((r) => [r.id, r.grade]));
  const ranked = hits.map((h) => h.id);
  const firstIdx = ranked.findIndex((id) => grades.has(id));
  const dcg = ranked
    .slice(0, TOP_K)
    .reduce((sum, id, i) => sum + (grades.has(id) ? gain(grades.get(id)) / discount(i + 1) : 0), 0);
  const ideal = relevance
    .map((r) => r.grade)
    .sort((a, b) => b - a)
    .slice(0, TOP_K)
    .reduce((sum, g, i) => sum + gain(g) / discount(i + 1), 0);
  const relevantInTopK = ranked.slice(0, TOP_K).filter((id) => grades.has(id)).length;

  return {
    hit1: ranked.slice(0, 1).some((id) => grades.has(id)) ? 1 : 0,
    hit3: ranked.slice(0, 3).some((id) => grades.has(id)) ? 1 : 0,
    hit5: ranked.slice(0, 5).some((id) => grades.has(id)) ? 1 : 0,
    recall5: relevance.length ? relevantInTopK / relevance.length : 0,
    rr: firstIdx >= 0 && firstIdx < MRR_CUTOFF ? 1 / (firstIdx + 1) : 0,
    ndcg5: ideal > 0 ? dcg / ideal : 0
  };
}

function mean(rows, key) {
  if (!rows.length) return 0;
  return rows.reduce((s, r) => s + r[key], 0) / rows.length;
}

function summarize(rows) {
  return {
    n: rows.length,
    hit1: mean(rows, 'hit1'),
    hit3: mean(rows, 'hit3'),
    hit5: mean(rows, 'hit5'),
    recall5: mean(rows, 'recall5'),
    mrr: mean(rows, 'rr'),
    ndcg5: mean(rows, 'ndcg5')
  };
}

// ---------------- bootstrap 置信区间 ----------------
// 用固定种子的伪随机数：同一条命令跑两次必须给出同一组区间，
// 否则「区间变了」会被误读成「系统变了」。
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bootstrapCI(rows, key, iterations = BOOTSTRAP, seed = 20261028) {
  if (rows.length < 2 || iterations <= 0) return null;
  const rand = mulberry32(seed);
  const values = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < rows.length; j++) {
      sum += rows[Math.floor(rand() * rows.length)][key];
    }
    values.push(sum / rows.length);
  }
  values.sort((a, b) => a - b);
  const pick = (p) => values[Math.min(values.length - 1, Math.max(0, Math.floor(p * (values.length - 1))))];
  return { low: pick(0.025), high: pick(0.975), iterations };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

const pct = (x) => (x * 100).toFixed(1) + '%';

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function gitMeta() {
  try {
    const commit = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    const ignored = ['benchmarks/retrieval-report.json', 'benchmarks/baseline.json', 'evals/.emb-cache'];
    const dirty = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter(Boolean)
      .filter((line) => {
        const f = line.replace(/^[A-Z?!]{1,2}\s+/, '').replace(/\\/g, '/');
        return !ignored.some((p) => f.startsWith(p));
      });
    return { commit, commitShort: commit.slice(0, 7), dirty: dirty.length > 0, dirtyFiles: dirty.slice(0, 10) };
  } catch (_) {
    return { commit: null, commitShort: null, dirty: null, dirtyFiles: [] };
  }
}

// ---------------- 三种模式 ----------------
// 统一成一个函数签名，便于后面用同一段代码算指标、算区间、落报告。
function runMode(name, searchFn) {
  const rows = [];
  const latencies = [];
  let oodFalsePositive = 0;
  let oodTotal = 0;
  let oodTopScoreSum = 0;

  for (const c of CASES) {
    const t0 = process.hrtime.bigint();
    let hits = [];
    let error = null;
    try {
      hits = searchFn(c);
    } catch (e) {
      error = e.message;
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    latencies.push(ms);

    const ids = hits.map((h) => h.id);
    if (c.type === 'out_of_domain') {
      oodTotal++;
      if (ids.length > 0) oodFalsePositive++;
      oodTopScoreSum += ids.length ? hits[0].score : 0;
      rows.push({ id: c.id, type: c.type, query: c.query, hits: ids, error, oodHit: ids.length > 0 });
    } else {
      rows.push(Object.assign({ id: c.id, type: c.type, query: c.query, hits: ids, error }, evaluate(hits, c.relevance)));
    }
  }

  const inDomain = rows.filter((r) => r.type !== 'out_of_domain');
  const byType = {};
  for (const type of ['keyword', 'paraphrase', 'colloquial', 'multi_hop']) {
    const subset = inDomain.filter((r) => r.type === type);
    if (subset.length) byType[type] = summarize(subset);
  }
  const sortedLat = latencies.slice().sort((a, b) => a - b);

  return {
    mode: name,
    overall: summarize(inDomain),
    byType,
    ood: {
      n: oodTotal,
      falsePositive: oodFalsePositive,
      falsePositiveRate: oodTotal ? oodFalsePositive / oodTotal : 0,
      avgTopScore: oodTotal ? Number((oodTopScoreSum / oodTotal).toFixed(6)) : 0
    },
    latencyMs: {
      p50: Number(percentile(sortedLat, 0.5).toFixed(3)),
      p95: Number(percentile(sortedLat, 0.95).toFixed(3)),
      max: Number(Math.max(0, ...latencies).toFixed(3))
    },
    ci: {
      hit3: bootstrapCI(inDomain, 'hit3'),
      ndcg5: bootstrapCI(inDomain, 'ndcg5'),
      mrr: bootstrapCI(inDomain, 'rr')
    },
    rows
  };
}

function printMode(result) {
  const o = result.overall;
  console.log('\n【' + result.mode + '】' + o.n + ' 条有标注的 query');
  console.log('  hit@1 ' + pct(o.hit1) + ' | hit@3 ' + pct(o.hit3) + ' | hit@5 ' + pct(o.hit5));
  console.log('  Recall@5 ' + pct(o.recall5) + ' | MRR@10 ' + o.mrr.toFixed(3) + ' | nDCG@5 ' + o.ndcg5.toFixed(3));
  if (result.ci.hit3) {
    console.log('  hit@3 95%CI [' + pct(result.ci.hit3.low) + ', ' + pct(result.ci.hit3.high) + ']' +
      ' | nDCG@5 95%CI [' + result.ci.ndcg5.low.toFixed(3) + ', ' + result.ci.ndcg5.high.toFixed(3) + ']');
  }
  for (const [type, s] of Object.entries(result.byType)) {
    console.log('  · ' + type.padEnd(12) + ' n=' + String(s.n).padStart(2) +
      ' hit@3 ' + pct(s.hit3).padStart(6) + ' nDCG@5 ' + s.ndcg5.toFixed(3));
  }
  console.log('  语料外 ' + result.ood.n + ' 条：误召回 ' + result.ood.falsePositive +
    ' 条（' + pct(result.ood.falsePositiveRate) + '），平均 top1 分数 ' + result.ood.avgTopScore);
  console.log('  延迟 p50 ' + result.latencyMs.p50 + 'ms | p95 ' + result.latencyMs.p95 + 'ms');
}

async function main() {
  const problems = validateCases();
  if (problems.length) {
    console.error('❌ 用例集校验失败：');
    problems.forEach((p) => console.error('   - ' + p));
    process.exit(1);
  }

  console.log('=== 检索评测 v' + (CASES_DOC.version || '?') + ' · 语料 ' + docs.length + ' 条 · 查询 ' + CASES.length + ' 条 ===');
  const byTypeCount = {};
  for (const c of CASES) byTypeCount[c.type] = (byTypeCount[c.type] || 0) + 1;
  console.log('  类型分布 ' + Object.entries(byTypeCount).map(([k, v]) => k + '=' + v).join(' / '));
  console.log('  指标 top-' + TOP_K + ' · MRR 截断 ' + MRR_CUTOFF + ' · bootstrap ' + BOOTSTRAP + ' 次');

  const t0 = Date.now();
  const bm25 = new retrieval.Bm25Index(docs);
  const buildMs = Date.now() - t0;
  const bm25Result = runMode('BM25（建索引 ' + buildMs + 'ms）', (c) => bm25.search(c.query, TOP_K));
  printMode(bm25Result);

  // ---------- 阈值扫描：语料外误召回到底能不能压下来 ----------
  // BM25 只要命中任意常用词就返回结果，所以「语料里没有答案」的问题也会被硬凑出几条。
  // 这里扫两种阈值并给出「hit@3 掉多少 / 误召回降多少」的对照，阈值由数据决定而不是拍脑袋。
  const sweep = [];
  const sweepConfigs = [
    ...[0, 0.5, 1, 2, 3, 4, 5, 6].map((v) => ({ kind: 'absolute', minScore: v })),
    ...[0, 0.2, 0.3, 0.4, 0.5].map((v) => ({ kind: 'relative', relativeToTop: v })),
    ...[0.1, 0.15, 0.2, 0.3, 0.4, 0.5].map((v) => ({ kind: 'coverage', minCoverage: v })),
    ...[0.1, 0.15, 0.2].map((v) => ({ kind: 'coverage+score', minCoverage: v, minScore: 5 }))
  ];
  for (const cfg of sweepConfigs) {
    const inDomain = [];
    let oodFp = 0;
    let oodN = 0;
    for (const c of CASES) {
      const hits = bm25.search(c.query, TOP_K, cfg);
      if (c.type === 'out_of_domain') {
        oodN++;
        if (hits.length) oodFp++;
      } else {
        inDomain.push(evaluate(hits, c.relevance));
      }
    }
    sweep.push({
      ...cfg,
      hit3: mean(inDomain, 'hit3'),
      ndcg5: mean(inDomain, 'ndcg5'),
      recall5: mean(inDomain, 'recall5'),
      oodFalsePositiveRate: oodN ? oodFp / oodN : 0
    });
  }

  // 选择规则：在 hit@3 相对基线下降不超过 2pt 的前提下，取误召回最低的配置。
  // 用规则而不是「最小化某个加权和」，是为了让选择过程可复核。
  const baselineHit3 = bm25Result.overall.hit3;
  const eligible = sweep.filter((s) => s.hit3 >= baselineHit3 - 0.02);
  const recommended = eligible.sort((a, b) => a.oodFalsePositiveRate - b.oodFalsePositiveRate || b.hit3 - a.hit3)[0] || null;

  console.log('\n【阈值扫描】语料外误召回 vs 域内 hit@3');
  for (const s of sweep) {
    const value = s.kind === 'absolute' ? 'minScore ' + s.minScore
      : s.kind === 'relative' ? 'top×' + s.relativeToTop
        : s.kind === 'coverage' ? '覆盖率 ' + s.minCoverage
          : '覆盖率 ' + s.minCoverage + '+分≥' + s.minScore;
    const label = value.padEnd(20);
    const mark = recommended === s ? '  ← 建议' : '';
    console.log('  ' + label + ' hit@3 ' + pct(s.hit3).padStart(6) + ' | nDCG@5 ' + s.ndcg5.toFixed(3) +
      ' | 误召回 ' + pct(s.oodFalsePositiveRate).padStart(6) + mark);
  }
  if (recommended) {
    const label = recommended.kind === 'absolute' ? 'minScore=' + recommended.minScore
      : recommended.kind === 'relative' ? 'relativeToTop=' + recommended.relativeToTop
        : recommended.kind === 'coverage' ? 'minCoverage=' + recommended.minCoverage
          : 'minCoverage=' + recommended.minCoverage + '&minScore=' + recommended.minScore;
    console.log('  建议：' + label + '（hit@3 ' + pct(recommended.hit3) + '，误召回 ' + pct(recommended.oodFalsePositiveRate) + '）');
  }

  const results = { bm25: bm25Result };
  let vectorInfo = { attempted: false, available: false, model: argModel, endpoint: argEndpoint };

  if (skipVector) {
    console.log('\n【向量】已跳过（--no-vector）');
  } else {
    const opts = { endpoint: argEndpoint, model: argModel, concurrency: 2, timeoutMs: 120000 };
    const ok = await retrieval.embeddingAvailable(opts);
    vectorInfo.attempted = true;
    vectorInfo.available = !!ok;
    if (!ok) {
      console.log('\n【向量】跳过：' + argEndpoint + ' 上没有可用的 embedding 模型（需 ollama pull ' + argModel + '）');
      console.log('       这不影响 BM25 的结论，但也不能假装向量跑过了。');
    } else {
      // 缓存按模型分文件：不同模型维度不同，混用会算出错误的相似度
      const cacheFile = path.join(__dirname, '.emb-cache-' + argModel.replace(/[^a-z0-9.-]/gi, '_') + '.json');
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
      const embedMs = Date.now() - tEmbed;
      const docVecs = new Map(docs.map((d) => [d.id, cache[d.text]]));
      vectorInfo.embedMs = embedMs;
      vectorInfo.embeddedNow = need.length;

      const qVecs = await retrieval.embedTexts(CASES.map((c) => c.query), opts);
      const vecResult = runMode('向量 · ' + argModel + '（语料 embedding ' + docs.length + ' 条，新增 ' + need.length + '，' + embedMs + 'ms）',
        (c) => retrieval.cosineTopK(qVecs.get(c.query), docVecs, TOP_K));
      // 说明：这里的延迟不含查询 embedding 的往返，只衡量向量检索本身
      printMode(vecResult);
      results.vector = vecResult;

      const bm25ById = new Map(bm25Result.rows.map((r) => [r.id, r.hits]));
      const vecById = new Map(vecResult.rows.map((r) => [r.id, r.hits]));
      const hybResult = runMode('RRF 融合 · k=60', (c) => retrieval.rrfFuse([
        (bm25ById.get(c.id) || []).map((id, j) => ({ id, score: 0, rank: j + 1 })),
        (vecById.get(c.id) || []).map((id, j) => ({ id, score: 0, rank: j + 1 }))
      ], { k: 60, topK: TOP_K }));
      printMode(hybResult);
      results.hybrid = hybResult;
    }
  }

  // ---------- 失败样本 ----------
  const misses = bm25Result.rows.filter((r) => r.type !== 'out_of_domain' && !r.hit5).slice(0, 8);
  if (misses.length) {
    console.log('\n【BM25 未进 top5 的样本】（用来说明它为什么需要语义层补）');
    for (const r of misses) {
      console.log('  ' + r.id + ' [' + r.type + '] 「' + r.query.slice(0, 26) + '…」 实得 ' + (r.hits.slice(0, 3).join(',') || '无'));
    }
  }

  // ---------- 结论 ----------
  console.log('\n=== 结论 ===');
  if (results.hybrid) {
    const dHit = results.hybrid.overall.hit3 - bm25Result.overall.hit3;
    const dNdcg = results.hybrid.overall.ndcg5 - bm25Result.overall.ndcg5;
    console.log('RRF 相对 BM25：hit@3 ' + (dHit >= 0 ? '+' : '') + (dHit * 100).toFixed(1) + 'pt，nDCG@5 ' + (dNdcg >= 0 ? '+' : '') + dNdcg.toFixed(3));
    console.log('注意：区间重叠时不能断言「融合更好」，只能说明「在这批 query 上没有看到退化」。');
  } else if (!skipVector) {
    console.log('向量层未跑（无可用 embedding 模型），因此只有 BM25 的数字可引用。');
  }
  const ci = bm25Result.ci.hit3;
  if (ci) {
    console.log('BM25 hit@3 的 95% 区间宽 ' + ((ci.high - ci.low) * 100).toFixed(1) + 'pt —— ' +
      (CASES.length < 100 ? '样本量仍然偏小，比例数字只能当区间看。' : '样本量已具备基本统计意义。'));
  }

  // ---------- 落报告 ----------
  const git = gitMeta();
  const report = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    suite: 'retrieval-eval',
    corpus: {
      source: 'src/main/exam-bank.ts',
      bankVersion: BANK_VERSION || null,
      docs: docs.length,
      fields: DOC_FIELDS,
      sha256: sha256(docs.map((d) => d.id + '\u0000' + d.text).join('\u0001'))
    },
    caseSet: {
      version: CASES_DOC.version || null,
      path: path.relative(ROOT, casesFile).replace(/\\/g, '/'),
      total: CASES.length,
      byType: byTypeCount,
      sha256: sha256(JSON.stringify(CASES))
    },
    config: { topK: TOP_K, mrrCutoff: MRR_CUTOFF, bootstrap: BOOTSTRAP },
    thresholdSweep: sweep,
    recommendedThreshold: recommended,
    vector: vectorInfo,
    commit: git.commit,
    commitShort: git.commitShort,
    gitDirty: git.dirty,
    reproducible: {
      reproducible: !!(git.commit && CASES.length && docs.length),
      missingFields: [git.commit ? null : 'commit'].filter(Boolean)
    },
    metrics: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, {
      overall: v.overall, byType: v.byType, ood: v.ood, latencyMs: v.latencyMs, ci: v.ci
    }])),
    perQuery: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.rows]))
  };

  const outDir = path.join(ROOT, 'benchmarks');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'retrieval-report.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
  console.log('\n报告已写入 ' + path.relative(ROOT, outFile) + '（含逐 query 命中与配置快照）');

  if (SELF_CHECK) {
    const bad = [];
    if (!report.metrics.bm25) bad.push('缺少 BM25 结果');
    if (report.metrics.bm25 && !(report.metrics.bm25.overall.n > 0)) bad.push('BM25 没有有效样本');
    if (!report.caseSet.sha256) bad.push('缺少用例集哈希');
    console.log(bad.length ? '❌ 自检未通过：' + bad.join('；') : '✅ 自检通过（指标、哈希、报告结构完整）');
    process.exitCode = bad.length ? 1 : 0;
  }
}

main().catch((err) => {
  console.error('FAILED: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
