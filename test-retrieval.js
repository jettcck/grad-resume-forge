'use strict';

// ============================================================
//  检索层自测（纯函数，不依赖 Ollama / 网络）
//
//  覆盖：中文 bigram 分词、BM25 排序与边界、余弦相似度、RRF 融合。
//  embedding 调用与端到端 recall 评测在 evals/retrieval-eval.js（需外部模型）。
// ============================================================
const path = require('path');
const r = require(path.join(__dirname, 'packages', 'retrieval', 'dist', 'index.js'));

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

// ---------------- 1) 分词 ----------------
const t1 = r.tokenize('高并发系统');
assert(t1.includes('高并') && t1.includes('并发'), '中文按 bigram 切分（高并 / 并发）');
assert(!t1.includes('高并发'), '不会输出整词（没有词典）');

const t2 = r.tokenize('Node.js 和 C++');
assert(t2.includes('node.js'), '英文带点的技术栈整体保留（node.js）');
assert(t2.includes('c++'), '英文带符号的技术栈整体保留（c++）');

const t3 = r.tokenize('Redis 持久化 RDB');
assert(t3.includes('redis') && t3.includes('rdb'), '英文转小写');
assert(t3.includes('持久') && t3.includes('久化'), '中英混排时中文部分仍切 bigram');

assert(r.tokenize('').length === 0, '空串分词返回空数组');
assert(r.tokenize('   ').length === 0, '纯空白分词返回空数组');
assert(r.tokenize('中').join(',') === '中', '单字块保留单字（不产生空 bigram）');

// ---------------- 2) BM25 ----------------
const docs = [
  { id: 'd1', text: 'MySQL 索引失效的常见情况有哪些' },
  { id: 'd2', text: 'Redis 持久化 RDB 与 AOF 的区别' },
  { id: 'd3', text: 'TCP 三次握手的过程' },
  { id: 'd4', text: '财务报表中的现金流量表分为哪三类活动' }
];
const idx = new r.Bm25Index(docs);

const h1 = idx.search('索引为什么失效', 3);
assert(h1.length > 0 && h1[0].id === 'd1', 'BM25 能把最相关文档排第一（索引失效）');
assert(h1[0].rank === 1, '返回结果带 1-based rank');

const h2 = idx.search('redis 持久化', 3);
assert(h2[0].id === 'd2', 'BM25 英文关键词命中（redis 持久化）');

assert(idx.search('', 3).length === 0, '空 query 返回空结果（不抛错）');
assert(idx.search('完全不相关的词汇组合xyz', 3).length === 0, '无任何词项命中时返回空（不返回随机文档）');

const h3 = idx.search('索引 握手 现金流', 2);
assert(h3.length === 2 && h3[0].rank === 1 && h3[1].rank === 2, 'topK 生效且 rank 连续');

// 语料顺序不影响结果（打分是全局的）
const idxRev = new r.Bm25Index([...docs].reverse());
assert(idxRev.search('索引为什么失效', 3)[0].id === 'd1', '文档顺序不影响 top-1');

// 所有分数必须为正且降序
const scores = idx.search('索引 持久化 握手', 4).map((x) => x.score);
assert(scores.every((s) => s >= 0), '分数非负');
assert(scores.every((s, i) => i === 0 || s <= scores[i - 1]), '分数按降序返回');

// ---------------- 3) 余弦 ----------------
assert(Math.abs(r.cosine([1, 0], [1, 0]) - 1) < 1e-9, '相同向量余弦为 1');
assert(Math.abs(r.cosine([1, 0], [0, 1])) < 1e-9, '正交向量余弦为 0');
assert(r.cosine([0, 0], [1, 1]) === 0, '零向量返回 0（不产生 NaN）');
assert(Math.abs(r.cosine([1, 2, 3], [2, 4, 6]) - 1) < 1e-9, '同方向不同长度余弦为 1');

const vecs = new Map([
  ['a', [1, 0, 0]],
  ['b', [0.9, 0.1, 0]],
  ['c', [0, 0, 1]]
]);
const vh = r.cosineTopK([1, 0, 0], vecs, 2);
assert(vh.length === 2 && vh[0].id === 'a' && vh[1].id === 'b', '余弦 topK 排序正确');

// ---------------- 4) RRF ----------------
const listA = [{ id: 'x', score: 0, rank: 1 }, { id: 'y', score: 0, rank: 2 }];
const listB = [{ id: 'y', score: 0, rank: 1 }, { id: 'x', score: 0, rank: 2 }];
const fused = r.rrfFuse([listA, listB], { k: 60, topK: 2 });
assert(fused.length === 2, 'RRF 融合输出 topK 条');
assert(fused.every((h) => h.score > 0), '融合分数为正');

const listC = [{ id: 'x', score: 0, rank: 1 }];
const listD = [{ id: 'x', score: 0, rank: 1 }, { id: 'z', score: 0, rank: 2 }];
const fused2 = r.rrfFuse([listC, listD], { k: 60, topK: 2 });
assert(fused2[0].id === 'x', '两路都排第一的文档融合后仍第一');
assert(fused2[1].id === 'z', '只在一路出现但排名靠前的文档仍被保留');

const empty = r.rrfFuse([[], []], { topK: 3 });
assert(empty.length === 0, '两路都空时融合返回空');

// ---------------- 5) 端到端（无模型）：BM25 在真实题库上能召回 ----------------
const { EXAM_BANK } = require(path.join(__dirname, 'dist', 'main', 'exam-bank.js'));
const realDocs = EXAM_BANK.map((q) => ({
  id: q.id,
  text: [q.stem, (q.options || []).join(' '), q.explanation || '', (q.tags || []).join(' ')].join(' ')
}));
const realIdx = new r.Bm25Index(realDocs);
const realHit = realIdx.search('快速排序的平均时间复杂度是多少', 3);
assert(realHit.length > 0 && realHit[0].id === 'algo-ds-04', '真实题库上关键词查询命中（快排复杂度）');
const realHit2 = realIdx.search('资产负债率的计算公式', 3);
assert(realHit2.length > 0 && realHit2[0].id === 'fin-03', '真实题库上关键词查询命中（资产负债率）');

console.log('\n检索层自测完成: ' + pass + ' passed, ' + failCnt + ' failed | exitCode = ' + (process.exitCode || 0));
