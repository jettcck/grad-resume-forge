// 核心引擎自测（不依赖 Electron）
const engine = require('./dist/main/resume-engine');

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ PASS:', msg);
}

// 1) 改写：弱动词 -> 强动词，去套话
const r1 = engine.rewriteBullet('负责赋能业务，使用优秀的方法论完成了一些优化', 'backend', 0);
console.log('  改写结果:', r1);
assert(!r1.includes('赋能') && !r1.includes('方法论') && !r1.includes('优秀的'), '删除套话/空洞形容词');
assert(r1.startsWith('主导'), '弱动词「负责」被替换为「主导」');

// 2) 量化识别
assert(engine.hasMetric('把 P99 从 800ms 降到 120ms') === true, '识别含量化数据的条目');
assert(engine.hasMetric('参与了系统的开发工作') === false, '识别无量化数据的条目');

// 3) 体检评分：套话多 -> 低分
const bad = engine.auditAiFlavor('本人致力于赋能业务，具备扎实的方法论，熟练掌握并精通各种技术，积极主动认真负责');
console.log('  差文本得分:', bad.score, bad.level);
assert(bad.score < 60, '重 AI 味文本得低分');
assert(bad.issues.length > 0, '差文本能列出问题点');

// 4) 体检评分：真人化短句 -> 高分
const good = engine.auditAiFlavor('实现订单缓存，QPS 提升 3 倍\n设计短链算法，日均处理 50 万次请求');
console.log('  好文本得分:', good.score, good.level);
assert(good.score >= 80, '干净文本得高分');

// 5) 端到端生成
const gen = engine.generate({
  name: '李雷', phone: '13800000000', email: 'lilei@x.com', github: 'github.com/lilei',
  targetRole: '后端开发', skills: 'Java, Go, MySQL, Redis, 数据结构',
  education: [{ school: '华中科技大学', major: '计算机科学与技术', period: '2021-2025', gpa: '3.8/4.0' }],
  projects: [{ name: '分布式短链', tech: 'Go/Redis', description: '负责设计短链算法，QPS 提升 5 倍\n使用缓存优化查询，P99 降到 80ms' }],
  internships: [{ name: '字节跳动', role: '后端实习', period: '2024', tech: 'Java', description: '参与订单系统开发，支撑日活 100 万' }]
}, {});
console.log('  生成简历 domain:', gen.resume.domain, '| 项目条目:', gen.resume.projects[0].bullets);
assert(gen.resume.basics.name === '李雷', '基本信息正确');
assert(gen.resume.projects[0].bullets.length === 2, '项目描述被拆分为条目');
assert(gen.resume.skills.length === 5, '技能去重解析正确');
assert(typeof gen.audit.score === 'number', '生成结果附带体检分数');
assert(Array.isArray(gen.tips), '生成结果附带优化建议');

// 6) 领域识别词边界：html 含 "ml"、javascript 含 "java"，不应误判方向
assert(engine.detectDomain('前端开发工程师，熟悉 html css javascript react vue') === 'frontend', 'html/javascript 不再误判为 algorithm');
assert(engine.detectDomain('算法工程师，pytorch 深度学习 nlp') === 'algorithm', '算法方向识别正确');
assert(engine.detectDomain('数据开发，spark hadoop 数仓 etl') === 'data', '数据方向识别正确');
assert(engine.detectDomain('后端开发，spring mysql 分布式') === 'backend', '后端方向识别正确');

// 6b) 大模型 / Agent 方向：新热门岗位归入 llm，且优先于 algorithm
assert(engine.detectDomain('大模型 Agent 工程师') === 'llm', '「大模型 Agent」归入 llm 方向');
assert(engine.detectDomain('Agent 开发工程师') === 'llm', 'Agent 岗归入 llm 方向');
assert(engine.detectDomain('RAG 工程师') === 'llm', 'RAG 岗归入 llm 方向');
assert(engine.detectDomain('提示词工程师') === 'llm', '提示词岗归入 llm 方向');
assert(engine.detectDomain('LLM 应用开发工程师') === 'llm', 'LLM 应用岗归入 llm 方向');
assert(engine.detectDomain('算法工程师（机器学习）') === 'algorithm', '传统算法岗仍归 algorithm（不被 llm 抢走）');

// 6c) llm 技能词库：Agent 项目经历能命中方向核心技能
const mjLlm = engine.matchJob('用 python 实现 llm agent 的 function calling 工具调用，含 rag 检索、prompt 设计、流式输出、评测与 ollama 部署', 'llm', 'Agent 工程师');
assert(mjLlm.hit.some((h) => h.label === 'agent'), 'agent/工具调用的技能命中');
assert(mjLlm.hit.some((h) => h.label === 'rag'), 'rag 技能命中');
assert(mjLlm.hit.some((h) => h.label === 'python'), 'python 技能命中');
assert(mjLlm.hitCount >= 6, 'llm 方向命中数充足（实际 ' + mjLlm.hitCount + '/' + mjLlm.total + '）');

// 7) 岗位匹配词边界：子串不应误命中技能
const mj1 = engine.matchJob('熟悉 javascript、json 与 vue3', 'frontend', '前端开发');
assert(mj1.hit.some((h) => h.label === 'javascript'), 'javascript 正确命中 JS 技能');
assert(mj1.hit.some((h) => h.label === 'vue'), 'vue3 正确命中 vue 技能（允许带版本号）');
const mj2 = engine.matchJob('研究 algorithm 与数据结构', 'backend', '后端开发');
assert(!mj2.hit.some((h) => h.label === 'go'), 'algorithm 不再误命中 go');
const mj3 = engine.matchJob('熟悉 javascript json', 'general', '通用');
assert(!mj3.hit.some((h) => h.label === 'python'), 'javascript 不再误命中 python/java/c++ 组');
const mj4 = engine.matchJob('熟练使用 mysql 与 hive', 'data', '数据开发');
assert(mj4.hit.some((h) => h.label === 'sql'), 'mysql 计入 sql 技能');
const mj5 = engine.matchJob('服务端 golang redis', 'backend', '后端开发');
assert(mj5.hit.some((h) => h.label === 'go'), 'golang 正确命中 go 技能');

// 8) 量化识别增强：k / 亿 也算量化
assert(engine.hasMetric('薪资 15k') === true, '识别 15k 为量化数据');
assert(engine.hasMetric('服务了 2 亿用户') === true, '识别 2 亿为量化数据');

// 9) JD 精准匹配：按 JD 实际提到的技能逐项比对
const jdText = [
  '岗位：Java 后端开发工程师',
  '职责：负责微服务系统的设计与开发',
  '要求：',
  '1. 熟悉 Java / Spring Boot，了解 JVM 原理',
  '2. 熟悉 MySQL、Redis，有消息队列（Kafka）使用经验',
  '3. 熟悉 Docker 与 K8s，了解 Linux',
  '4. 加分项：有分布式系统实践经验'
].join('\n');
const resumeObj = {
  summary: '后端方向应届生',
  skills: ['Java', 'Spring', 'MySQL', 'Redis', '数据结构'],
  projects: [{ name: '分布式短链服务', tech: 'Go/Redis', bullets: ['主导短链算法设计，QPS 提升 5 倍'] }],
  internships: []
};
const jd = engine.matchJd(resumeObj, jdText);
console.log('  JD 匹配:', jd.score + '%', jd.level, '| 命中:', jd.hit.map(h => h.label).join(','), '| 缺失:', jd.missing.map(m => m.label).join(','));
assert(jd.domain === 'backend', 'JD 方向识别为后端');
assert(jd.hit.some((h) => h.label === 'java'), 'JD 中 java 命中');
assert(jd.hit.some((h) => h.label === 'mysql') && jd.hit.some((h) => h.label === 'redis'), 'JD 中 mysql/redis 命中');
assert(jd.missing.some((m) => m.label === 'docker'), '简历缺失 docker 被标出');
assert(jd.hit.some((h) => h.label === '分布式'), '简历的「分布式短链」命中分布式技能');
assert(jd.score >= 40 && jd.score <= 100, 'JD 匹配分数在合理区间');
assert(jd.missing.length + jd.hit.length === jd.jdSkillCount, '命中 + 缺失 = JD 技能总数');

// 空简历 vs 同一 JD：分数应显著更低
const jdEmpty = engine.matchJd({ skills: [], projects: [], internships: [], summary: '' }, jdText);
assert(jdEmpty.score < jd.score, '空简历匹配分更低');
assert(jdEmpty.missing.length === jdEmpty.jdSkillCount, '空简历全部 JD 技能进入缺失');

// JD 过短
let shortErr = null;
try { engine.matchJd(resumeObj, '   '); } catch (e) { shortErr = e; }
assert(shortErr && /职位描述/.test(shortErr.message), '空 JD 报错');

console.log('\n引擎自测完成，最终 exitCode =', process.exitCode || 0);
