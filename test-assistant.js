'use strict';

// 小助手检索引擎自测：命中/方向加权/兜底/热门问题
const { askAssistant, hotQuestions } = require('./dist/main/assistant');
const { KNOWLEDGE } = require('./dist/main/assistant-knowledge');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

// 1) 知识库规模与结构
assert(KNOWLEDGE.length >= 28, '知识库 ≥ 28 条（实际 ' + KNOWLEDGE.length + '）');
assert(KNOWLEDGE.every((k) => k.keywords.length && k.answer.length && k.question.length), '每条知识含关键词/问题/答案');
assert(KNOWLEDGE.every((k) => !k.action || (k.action.label && k.action.route)), '操作按钮结构完整');
assert(KNOWLEDGE.filter((k) => k.domains[0] === 'all').length >= 18, '通用知识 ≥ 18 条');
assert(KNOWLEDGE.some((k) => k.domains.includes('finance')), '财务方向知识存在');
assert(KNOWLEDGE.some((k) => k.domains.includes('education')), '教育方向知识存在');

// 2) 核心问答命中
const cases = [
  ['没有实习经历怎么办', /实习|项目|竞赛/],
  ['简历写几页', /一页|两页/],
  ['自我评价怎么写', /认真负责|事实/],
  ['怎么量化', /数字|比例/],
  ['秋招什么时候开始', /秋招|7-8 月|提前批/],
  ['期望薪资怎么答', /区间|不主动/],
  ['照片要不要放', /正装|证件照/],
  ['gpa 低要不要写', /3\.5|不写|单科/]
];
cases.forEach(([q, re]) => {
  const r = askAssistant(q, null);
  assert(r.matched && re.test(r.answer), '命中「' + q + '」');
});

// 3) 方向加权：财务语境下问证书 → 命中财务知识
const fin = askAssistant('哪些证书值得考', 'finance');
assert(fin.matched && /CPA|初级会计/.test(fin.answer), '财务方向加权：证书问题命中财务知识');
// 技术语境下同一问题不应命中财务条目
const tech = askAssistant('哪些证书值得考', 'backend');
assert(!/CPA/.test(tech.answer), '技术方向问证书不误入财务知识');

// 4) App 使用问题
const usage = askAssistant('AI 优化怎么用', null);
assert(usage.matched && /Agent 深度优化|JD/.test(usage.answer), 'App 使用问题命中');
const usage2 = askAssistant('不想装 ollama 也不想填 api', null);
assert(usage2.matched && /应用内模型|500MB|WebGPU/.test(usage2.answer), '免安装问题命中（应用内模型知识）');

// 5) 兜底：无关问题不硬编答案，给操作引导
const fb = askAssistant('今天天气怎么样', null);
assert(fb.matched === false, '无关问题走兜底（不硬编答案）');
assert(!!fb.action && !!fb.action.route, '兜底含操作引导');

// 6) 空输入引导
const empty = askAssistant('', null);
assert(empty.matched === false && empty.answer.length > 0, '空输入给引导文案');
assert(empty.alternatives.length >= 3, '空输入附推荐问题');

// 7) 热门问题
const hot = hotQuestions();
assert(Array.isArray(hot) && hot.length >= 5, '热门问题 ≥ 5 条');
assert(hot.every((q) => askAssistant(q, null).matched), '每条热门问题都能命中知识库');

// 8) 候选推荐（「你是不是想问」）——有近似知识时给出；单一强命中时可为空（非缺陷）
const alt = askAssistant('经历怎么写', null);
assert(alt.matched, '「经历怎么写」命中知识');
const alt2 = askAssistant('简历', null);
assert(alt2.alternatives === undefined || Array.isArray(alt2.alternatives), '候选字段结构合法');

console.log('\n小助手自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
