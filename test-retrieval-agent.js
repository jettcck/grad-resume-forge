'use strict';

// P2：检索工具接入 Agent 的自测。只验证真实 Agent 工具与三种对照模式，
// vector 模式不启动 Ollama 时必须明确返回不可用，不能伪造结果。
const path = require('path');
const agent = require('./dist/main/agent');
const retrieval = require('./dist/main/retrieval');
const evidenceLib = require('./dist/main/resume-evidence');

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

  // 语料外问题：题库里没有答案时不应硬凑结果塞给 Agent。
  // 依据 evals/retrieval-eval.js 的扫描：minScore=5 把语料外误召回从 75%（6/8）压到 37.5%（3/8），
  // 域内 hit@3 仅从 85.2% 降到 83.3%。这里断言「至少压掉一半」，阈值再调也要守住这条线。
  const oodQueries = [
    '红烧肉怎么做才不腻',
    '明天上海到杭州的高铁几点发车',
    '如何办理护照延期',
    '钢琴考级需要准备哪些曲目',
    '猫粮哪个牌子好',
    '世界杯决赛什么时候开始',
    '阳台种番茄要注意什么',
    '手机电池不耐用怎么修'
  ];
  let suppressed = 0;
  for (const q of oodQueries) {
    const r = await rt.run({ query: q, topK: 3, mode: 'bm25' });
    if (r.results.length === 0) suppressed++;
  }
  assert(suppressed >= 4, '语料外问题至少压掉一半（实测 ' + suppressed + '/8，阈值前为 2/8）');
  const stillOnTopic = await rt.run({ query: 'MySQL 索引在什么情况下会失效', topK: 3, mode: 'bm25' });
  assert(stillOnTopic.results.length > 0 && stillOnTopic.results[0].id === 'db-mysql-02',
    '阈值没有误伤正常查询');

  // 核心业务：用户经历检索、出处核验和无证据拒收，而非只查题库知识。
  const profile = {
    name: '演示姓名', phone: '13800000000', email: 'demo@example.com',
    summary: '应届后端开发', skills: 'Java、Docker',
    projects: [
      { name: '订单系统', tech: 'Java、MySQL', description: ['负责订单查询开发，服务 3 万用户', '优化查询，响应从 800ms 降至 120ms'] },
      { name: '缓存系统', tech: 'Redis、Docker', description: '构建缓存，命中率 95%' }
    ],
    internships: [{ name: '数据实习', tech: 'Python', description: '使用 Python 处理 2 万行数据' }]
  };
  const jd = 'Java MySQL Redis Docker 后端开发';
  const corpus = evidenceLib.profileSources(profile);
  assert(corpus.some((s) => s.id === 'p0-b1' && s.text.includes('800ms')), '数组描述按引擎行切分进入来源索引');
  assert(!corpus.some((s) => /name$|phone|email/.test(s.path) && !s.path.startsWith('projects') && !s.path.startsWith('internships')),
    '经历语料不索引姓名与联系方式');
  assert(corpus.every((s) => /^[0-9a-f]{64}$/.test(s.digest)), '每条来源带真实 SHA-256 原文摘要');
  const noneEvidence = evidenceLib.createProfileEvidence(profile, jd, 'none');
  const retrievedEvidence = evidenceLib.createProfileEvidence(profile, jd, 'bm25', 10);
  assert(noneEvidence.retrieved.length === 0, '无检索组没有额外来源');
  assert(retrievedEvidence.retrieved.some((s) => s.id === 'p0-tech'), 'BM25 命中当前项目技术栈字段');
  assert(evidenceLib.createProfileEvidence({ projects: [{ description: '设计海报' }] }, 'Docker').retrieved.length === 0,
    '没有用户经历依据的技能查询返回空来源');
  const items = agent.buildTaskItems(profile);
  const valid = { id: 'p0-b0', text: '使用 Java 开发订单查询，服务 3 万用户' };
  const noRetrieval = agent.validateRewrites(items, [valid], profile, jd, noneEvidence);
  assert(noRetrieval.rejected.length === 1 && /缺少本条经历证据/.test(noRetrieval.rejected[0].reason),
    '无检索组不能补写原条目未提及的项目技术');
  const grounded = agent.validateRewrites(items, [valid], profile, jd, retrievedEvidence);
  assert(grounded.accepted.length === 1, '同项目检索来源支持 Java 表述');
  const rewrite = grounded.accepted[0];
  assert(rewrite.evidence.some((s) => s.sourceId === 'p0-b0') && rewrite.evidence.some((s) => s.sourceId === 'p0-tech'),
    '接受项同时引用目标原文和支持新增技能的技术栈');
  assert(!rewrite.evidence.some((s) => s.sourceId.startsWith('p1-') || s.sourceId === 'skills'),
    '引用不混入其他项目和个人技能');
  const fabricatedSkill = agent.validateRewrites(items, [{ id: 'p0-b0', text: '用 Docker 部署订单查询，服务 3 万用户' }], profile, jd, retrievedEvidence);
  assert(fabricatedSkill.rejected.length === 1 && /本条经历证据/.test(fabricatedSkill.rejected[0].reason),
    '个人技能和另一个项目已有 Docker，也不能当成本项目使用 Docker 的证据');
  const fabricatedMetric = agent.validateRewrites(items, [{ id: 'p0-b0', text: '开发订单查询，服务 3 万用户，QPS 达到 1000' }], profile, jd, retrievedEvidence);
  assert(fabricatedMetric.rejected.length === 1 && /新增数字缺少经历证据/.test(fabricatedMetric.rejected[0].reason),
    '原文数字保留也不放行凭空新增的 QPS');
  const borrowedMetric = agent.validateRewrites(items, [{ id: 'p0-b0', text: '开发订单查询，服务 3 万用户，命中率 95%' }], profile, jd, retrievedEvidence);
  assert(borrowedMetric.rejected.length === 1, '其他项目的 95% 不能移植到订单项目');
  const fakeCitation = agent.validateRewrites(items, [{ id: 'p0-b0', text: '用 Docker 部署订单查询，服务 3 万用户',
    evidence: [{ sourceId: 'be-docker-01', quote: 'Docker 部署订单' }] }], profile, jd, retrievedEvidence);
  assert(fakeCitation.accepted.length === 0, '模型自己生成的题库引用不能冒充用户经历来源');
  const applied = agent.applyRewritesToProfile(profile, [rewrite]);
  assert(applied.projects[0].description.startsWith(valid.text), '带有效来源的候选可应用到目标原文');
  assert(applied.projects[1].description === profile.projects[1].description, '应用不触碰其他项目');
  let staleError = '';
  try { agent.applyRewritesToProfile({ ...profile, projects: [{ ...profile.projects[0], tech: 'Go' }, profile.projects[1]] }, [rewrite]); }
  catch (e) { staleError = e.message; }
  assert(/原始经历已变化/.test(staleError), '来源字段变化后旧候选不能应用');
  let forgedError = '';
  try { agent.applyRewritesToProfile(profile, [{ ...rewrite, evidence: [{ ...rewrite.evidence[0], digest: 'fake' }] }]); }
  catch (e) { forgedError = e.message; }
  assert(/原始经历已变化/.test(forgedError), '伪造来源摘要不能通过应用核验');

  for (const refs of [undefined, null, []]) {
    let missingError = '';
    try { agent.applyRewritesToProfile(profile, [{ ...rewrite, evidence: refs }]); }
    catch (e) { missingError = e.message; }
    assert(/缺少经历来源/.test(missingError), '来源被删除、置空或设为空数组时拒绝应用：' + JSON.stringify(refs));
  }
  const changed = JSON.parse(JSON.stringify(profile));
  changed.projects[0].description = '开发订单查询，服务 5 万用户';
  const beforeMissingApply = JSON.stringify(changed);
  let bypassError = '';
  try { const { evidence: _refs, ...candidate } = rewrite; agent.applyRewritesToProfile(changed, [candidate]); }
  catch (e) { bypassError = e.message; }
  assert(/缺少经历来源/.test(bypassError) && JSON.stringify(changed) === beforeMissingApply,
    '移除过期候选来源仍被拒收，当前档案保持原文');
  const store = require('./packages/agent-core/dist/index').createMemoryRunStore();
  let prompt = '';
  const pipeline = await agent.runAgent(profile, jd, { maxRounds: 1, runStore: store, runId: 'evidence-pipeline',
    llm: { chat: async (messages) => { prompt = messages[1].content; return JSON.stringify({ rewrites: [valid] }); } } });
  assert(pipeline.ok && pipeline.accepted[0].evidence.length >= 2, '真实流水线接入经历检索与来源校验');
  assert(prompt.includes('PROFILE_EVIDENCE') && prompt.includes('p0-tech'), '模型输入确实包含检索来源');
  assert(pipeline.steps.some((s) => s.tool === 'retrieve_profile_evidence'), '流水线实时轨迹记录经历检索步骤');
  const record = store.get('evidence-pipeline');
  assert(record.result.evidenceSources[0].sources.some((s) => s.sourceId === 'p0-tech'), '运行记录保留引用位置与摘要供复盘');
  assert(!JSON.stringify(record).includes(valid.text) && !JSON.stringify(record).includes('demo@example.com'), '运行记录不保存改写正文与联系方式');
  const toolCtx = { profile, jd, items, accepted: new Map(), rejected: [], attempts: new Map(),
    evidence: noneEvidence };
  const evidenceTool = agent.buildAgentTools(toolCtx).find((t) => t.name === 'retrieve_profile_evidence');
  assert(!!evidenceTool && evidenceTool.inputSchema.required.includes('query'), '自主 Agent 注册经历检索工具与 query 契约');
  const toolNone = evidenceTool.run({ query: 'Java MySQL', mode: 'bm25' });
  assert(toolNone.mode === 'none' && toolNone.results.length === 0, '无检索实验模式不能被模型调用重新开启');
  let step = 0;
  const scripted = [
    { name: 'analyze_jd', args: {} },
    { name: 'retrieve_profile_evidence', args: { query: 'Java MySQL', topK: 3 } },
    { name: 'rewrite_bullets', args: { rewrites: [valid] } },
    { name: 'submit_result', args: {} }
  ];
  const agentic = await agent.agenticLoop(profile, jd, { maxSteps: 5,
    llm: { chat: async () => ({ content: '', toolCalls: [scripted[Math.min(step++, 3)]], rawToolCalls: [] }) } });
  assert(agentic.ok && agentic.accepted[0].evidence.some((s) => s.sourceId === 'p0-tech'), '真实自主 Agent 工具链返回可核对的经历来源');
  assert(agentic.steps.some((s) => s.tool === 'retrieve_profile_evidence' && s.ok), '自主工具轨迹记录成功检索');

  const cacheProfile = { skills: 'Java', projects: [{ name: '订单缓存', tech: 'Java、Redis',
    description: '开发缓存模块，响应从 800ms 降至 120ms' }], internships: [] };
  const sameRewrite = { name: 'rewrite_bullets', args: { rewrites: [
    { id: 'p0-b0', text: '使用 Redis 开发缓存模块，响应从 800ms 降至 120ms' }
  ] } };
  const retryScript = [
    { name: 'analyze_jd', args: {} }, sameRewrite,
    { name: 'retrieve_profile_evidence', args: { query: 'Redis' } }, sameRewrite,
    { name: 'audit_text', args: {} }, { name: 'submit_result', args: {} }
  ];
  let retryStep = 0;
  const repaired = await agent.agenticLoop(cacheProfile, '后端开发实习', { maxSteps: 8,
    llm: { chat: async () => ({ content: '', toolCalls: [retryScript[Math.min(retryStep++, retryScript.length - 1)]], rawToolCalls: [] }) } });
  assert(repaired.rejected.some((r) => /缺少本条经历证据/.test(r.reason)), '补检索前同一 Redis 候选确实被拒收');
  assert(repaired.ok && repaired.accepted.length === 1 && repaired.accepted[0].evidence.some((s) => s.sourceId === 'p0-tech'),
    '补齐检索证据后，相同候选重新校验并被接受');
  assert(repaired.run.trace.filter((t) => t.tool === 'rewrite_bullets').length === 2 &&
    repaired.run.trace.filter((t) => t.tool === 'rewrite_bullets').every((t) => !t.outputSummary.startsWith('幂等命中')),
    '两次改写提交均执行校验，不复用旧拒收缓存');
  const plain = agent.validateRewrites(items, [{ id: 'summary', text: '后端方向应届生，有可量化的项目经历' }], profile, jd, retrievedEvidence);
  assert(plain.accepted.length === 1, '可量化的项目经历不被误判为使用 vLLM');

  console.log('\nAgent 检索接入自测完成: ' + pass + ' passed, ' + failCnt + ' failed');
})().catch((e) => {
  console.error('❌ 测试异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
