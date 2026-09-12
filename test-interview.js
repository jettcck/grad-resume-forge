'use strict';

// ============================================================
//  面试准备自测（全本地、零模型）
//  重点守两条：① 绝不编造用户没写过的内容（数字/经历）
//             ② 题库必须覆盖全部方向，且每题有考察点与框架
// ============================================================
const { prepareInterview, buildSelfIntro } = require('./dist/main/interview');
const {
  GENERAL_QUESTIONS, DOMAIN_QUESTIONS, OPEN_QUESTION_TEMPLATES, QUESTIONS_TO_ASK
} = require('./dist/main/interview-bank');
const { ROLE_SKILLS } = require('./dist/main/lexicon');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

const TECH = {
  name: '王锦楠', targetRole: '大模型 Agent 工程师',
  skills: 'Python, LangChain, RAG, 向量数据库',
  education: [{ school: '成都理工大学工程技术学院', major: '计算机科学与技术', degree: '本科', gpa: '3.8' }],
  internships: [],
  projects: [{
    name: '简历锻造炉', role: '独立开发', tech: 'Electron / LLM',
    description: '设计规则+LLM 混合改写引擎，校验门拒收坏结果\n建 222 项自动化断言作 CI 门禁'
  }]
};

const FINANCE = {
  name: '王雨晴', targetRole: '财务专员',
  skills: 'Excel（数据透视）, 用友 U8, CPA（已过 3 科）',
  education: [{ school: '西南财经大学', major: '会计学', degree: '本科', gpa: '3.6' }],
  internships: [{ name: '天健会计师事务所', role: '审计实习生', tech: 'Excel', description: '参与 2 家制造业公司年审，独立完成货币资金底稿\n盘点现金与存货，盘点差异率 0.1%' }],
  projects: []
};

// ---------- 1) 题库结构完整性 ----------
assert(GENERAL_QUESTIONS.length >= 10, '通用题 ≥ 10（实际 ' + GENERAL_QUESTIONS.length + '）');
const domains = Object.keys(ROLE_SKILLS);
const missingDomain = domains.filter((d) => !DOMAIN_QUESTIONS[d] || !DOMAIN_QUESTIONS[d].length);
assert(missingDomain.length === 0, '每个方向都有专属题（缺：' + (missingDomain.join(',') || '无') + '）');
const allQ = [...GENERAL_QUESTIONS, ...domains.flatMap((d) => DOMAIN_QUESTIONS[d] || [])];
assert(allQ.every((q) => q.q && q.focus && Array.isArray(q.frame) && q.frame.length >= 3),
  '每道题都有问题 + 考察点 + ≥3 步回答框架（共 ' + allQ.length + ' 题）');
assert(allQ.filter((q) => q.pitfall).length >= allQ.length * 0.8, '≥80% 的题给了「常见坑」');
assert(OPEN_QUESTION_TEMPLATES.length >= 5, '网申开放题模板 ≥ 5（实际 ' + OPEN_QUESTION_TEMPLATES.length + '）');
assert(OPEN_QUESTION_TEMPLATES.every((t) => t.title && t.frame.length >= 3 && t.starter),
  '每个开放题模板有框架与起手句');
assert(QUESTIONS_TO_ASK.length >= 5, '反问清单 ≥ 5 条');

// ---------- 2) 自我介绍：不得编造档案里没有的内容 ----------
const r = prepareInterview(TECH, {});
assert(r.domain === 'llm', '方向识别为 llm（实际 ' + r.domain + '）');
assert(r.intro30.text.length > 60, '30 秒版有实质内容（' + r.intro30.text.length + ' 字）');
assert(r.intro60.text.length >= r.intro30.text.length, '60 秒版不短于 30 秒版');

// 只出现档案里有的数字（防编造）
const numsOf = (s) => (String(s).match(/\d+(\.\d+)?/g) || []);
const allowed = new Set([
  ...numsOf(TECH.education[0].gpa), '222',
  ...numsOf(TECH.projects[0].description)
]);
const introNums = numsOf(r.intro60.text).filter((n) => n !== '30' && n !== '60');
assert(introNums.every((n) => allowed.has(n)),
  '自我介绍里的数字全部来自档案（实际出现：' + introNums.join(',') + '）');

assert(r.intro60.text.includes('王锦楠'), '自我介绍含姓名');
assert(/成都理工大学|计算机科学与技术/.test(r.intro60.text), '自我介绍含学校或专业');
assert(r.intro60.text.includes('简历锻造炉'), '自我介绍用到档案里的项目名');
assert(r.intro60.sources.length >= 1, '给出来材来源供用户核对');

// 档案为空时不能崩，也不能编造
const empty = buildSelfIntro({ name: '', skills: '', projects: [], internships: [] }, {});
assert(typeof empty.text === 'string' && empty.text.length >= 0, '空档案不崩（返回可读文本）');
assert(!/222|3\.8/.test(empty.text), '空档案不会凭空冒出数字');

// 非技术方向同样可用（全专业通用）
const rf = prepareInterview(FINANCE, {});
assert(rf.domain === 'finance', '财务方向识别正确（' + rf.domain + '）');
assert(rf.intro30.text.includes('天健会计师事务所'), '财务自我介绍用到了实习公司');
assert(rf.intro30.text.includes('盘点差异率 0.1%'), '财务自我介绍保留了量化数据');
assert(!/编制盘点/.test(rf.intro30.text), '「盘点」不再被错误加上「编制」前缀（动词库已补）');

// ---------- 3) 素材指向：讲经历的题要自动挂上用户自己的素材 ----------
const materialQs = r.general.filter((q) => q.material);
assert(materialQs.length >= 3, '通用题里有 ≥3 道自动指向了自己的素材（实际 ' + materialQs.length + '）');
assert(materialQs.every((q) => q.useOwnStory), '只有「讲自己经历」类的问题才会挂素材');
assert(materialQs[0].material.includes('简历锻造炉'), '素材指向的是档案里最相关的那条经历');

// ---------- 4) 零门槛：全程不涉及任何模型 ----------
const src = require('fs').readFileSync(require('path').join(__dirname, 'src', 'main', 'interview.ts'), 'utf8');
assert(!/llm-client|createLlmClient|llm\.chat|fetch\(/.test(src),
  '面试模块不依赖任何模型或网络（纯本地计算）');
const bankSrc = require('fs').readFileSync(require('path').join(__dirname, 'src', 'main', 'interview-bank.ts'), 'utf8');
assert(!/llm-client|createLlmClient|fetch\(/.test(bankSrc), '题库是纯数据，不依赖模型或网络');

console.log('\n面试准备自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
