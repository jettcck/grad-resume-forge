'use strict';

// P2 对比：同一查询分别走 no-retrieval / BM25 / vector。
// vector 只在真实 embedding 端点可用时计入结果；不可用时明确输出 skipped。
const retrieval = require('../dist/main/retrieval');

const query = process.argv.slice(2).join(' ') || '热点数据突然失效，瞬时大量请求全都打到数据库上，有什么办法挡住';
const topK = 3;

async function main() {
  console.log('=== Agent 检索对比 ===');
  console.log('query:', query);
  for (const mode of ['none', 'bm25', 'vector']) {
    const r = await retrieval.retrieveKnowledge(query, topK, mode);
    console.log('\n[' + mode + ']');
    console.log('  vectorAvailable:', r.vectorAvailable);
    console.log('  note:', r.note);
    if (!r.results.length) {
      console.log('  results: []');
      continue;
    }
    r.results.forEach((x) => console.log('  ' + x.rank + '. ' + x.id + ' score=' + x.score + ' ' + x.text.slice(0, 80)));
  }
}

main().catch((err) => {
  console.error('FAILED:', err && err.stack ? err.stack : err);
  process.exit(1);
});
