'use strict';

// P2：检索工具接入 Agent 的自测。只验证真实 Agent 工具与三种对照模式，
// vector 模式不启动 Ollama 时必须明确返回不可用，不能伪造结果。
const path = require('path');
const agent = require('./dist/main/agent');
const retrieval = require('./dist/main/retrieval');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

(async () => {
  const names = agent.TOOLS.map((t) => t.name);
  assert(names.includes('retrieve_knowledge'), '通用工具注册表包含 retrieve_knowledge');
  const spec = agent.TOOLS.find((t) => t.name === 'retrieve_knowledge');
  assert(spec && spec.inputSchema.properties.query.type === 'string', '检索工具声明 query 字段');
  assert(spec && spec.inputSchema.properties.topK.type === 'number', '检索工具声明 topK 字段');

  const ctx = {
    profile: { summary: '后端开发', projects: [], internships: [] },
    jd: 'Java 后端', items: [], accepted: new Map(), rejected: [], attempts: new Map()
  };
  const tools = agent.buildAgentTools(ctx);
  const rt = tools.find((t) => t.name === 'retrieve_knowledge');
  assert(!!rt, 'Agentic 工具集包含 retrieve_knowledge');

  const none = await rt.run({ query: 'Redis 持久化如何工作', topK: 3, mode: 'none' });
  assert(none.mode === 'none' && none.results.length === 0, 'none 对照组不执行检索');
  assert(/no-retrieval/.test(none.note), 'none 对照组说明可追溯');

  const bm25 = await rt.run({ query: 'Redis 的数据是怎么保存到磁盘上的', topK: 3, mode: 'bm25' });
  assert(bm25.mode === 'bm25' && bm25.results.length > 0, 'BM25 模式返回结果');
  assert(bm25.results[0].id === 'be-redis-02', 'BM25 对 Redis 持久化查询命中正确题目');
  assert(bm25.results.every((h, i) => h.rank === i + 1 && h.text), 'BM25 结果包含连续 rank 与可读文本');

  process.env.AGENT_RETRIEVAL_ENDPOINT = 'http://127.0.0.1:1';
  retrieval.resetRetrievalCache();
  const vector = await rt.run({ query: '热点数据失效导致数据库压力暴增', topK: 3, mode: 'vector' });
  assert(vector.mode === 'vector' && vector.vectorAvailable === false && vector.results.length === 0,
    '向量不可用时返回明确状态且不伪造结果');
  const hybrid = await rt.run({ query: 'Redis 持久化', topK: 3, mode: 'hybrid' });
  assert(hybrid.mode === 'hybrid' && hybrid.fallbackMode === 'bm25' && hybrid.vectorAvailable === false,
    'hybrid 向量不可用时明确降级 BM25');
  assert(hybrid.results.length > 0, 'hybrid 降级仍保留 BM25 结果');

  console.log('\nAgent 检索接入自测完成: ' + pass + ' passed, ' + failCnt + ' failed');
})().catch((e) => {
  console.error('❌ 测试异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
