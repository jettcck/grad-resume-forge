'use strict';

// ============================================================
//  笔试中心核心逻辑自测
//  覆盖：题库完整性 / 标签提取 / 组卷比例与可复现 / 四种题型评分 /
//        错题归档口径 / 薄弱项排序 / 下一轮练习
// ============================================================
const { EXAM_BANK, QUESTION_MAP, allTags, allDomains, getQuestion } = require('./dist/main/exam-bank');
const core = require('./dist/main/exam-core');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

// ---------------- 1) 题库完整性 ----------------
assert(EXAM_BANK.length >= 60, '题库规模 ≥60 题（实得 ' + EXAM_BANK.length + '）');

const ids = EXAM_BANK.map((q) => q.id);
assert(new Set(ids).size === ids.length, '题目 id 唯一');
assert(EXAM_BANK.every((q) => q.stem && q.explanation && q.tags.length > 0),
  '每题都有题干、解析、至少一个知识点标签');
assert(EXAM_BANK.every((q) => [1, 2, 3, 4, 5].includes(q.difficulty)), '难度都在 1-5');
assert(EXAM_BANK.every((q) => q.version >= 1), '每题带 version');

const types = new Set(EXAM_BANK.map((q) => q.type));
assert(['single', 'multiple', 'judge', 'fill'].every((t) => types.has(t)),
  '四种题型都有题（single/multiple/judge/fill）');
assert(!EXAM_BANK.some((q) => q.type === 'sql' || q.type === 'code'),
  '第一阶段不含 SQL / 编程题');

// 单选与多选的答案必须落在选项里，否则永远答不对
const badSingle = EXAM_BANK.filter((q) => q.type === 'single' && (!q.options || !q.options.includes(q.answer)));
assert(badSingle.length === 0, '单选题答案都在选项内（异常：' + (badSingle.map((q) => q.id).join(',') || '无') + '）');
const badMulti = EXAM_BANK.filter((q) => q.type === 'multiple'
  && (!Array.isArray(q.answer) || !q.options || q.answer.some((a) => !q.options.includes(a))));
assert(badMulti.length === 0, '多选题答案为选项子集（异常：' + (badMulti.map((q) => q.id).join(',') || '无') + '）');
const badJudge = EXAM_BANK.filter((q) => q.type === 'judge'
  && (JSON.stringify(q.options) !== JSON.stringify(['正确', '错误']) || !['正确', '错误'].includes(q.answer)));
assert(badJudge.length === 0, '判断题选项固定为 正确/错误 且答案合法');
let dupOptions = 0;
EXAM_BANK.forEach((q) => {
  if (q.options && new Set(q.options).size !== q.options.length) dupOptions++;
});
assert(dupOptions === 0, '选项文本无重复（重复会让「集合一致」判定失真）');

// ---------------- 2) 标签提取 ----------------
const jd = '岗位职责：负责后端服务开发。要求熟悉 Java、Spring Boot、MySQL，了解 Redis 与 TCP 网络编程。';
const tags = core.extractTags(jd);
assert(tags.includes('java') && tags.includes('spring') && tags.includes('mysql'), 'JD 文本识别出 java/spring/mysql');
assert(tags.includes('redis') && tags.includes('network'), 'JD 文本识别出 redis/network');
assert(core.extractTags('').length === 0, '空文本不产出标签');
assert(core.extractTags('负责前台接待与文件整理').includes('java') === false, '无关文本不误报 java');

// ---------------- 3) 组卷 ----------------
const built = core.buildPaper({ jdText: jd, targetRole: '后端开发工程师', count: 20, seed: 42 });
assert(built.questionIds.length === 20, '组卷题量准确（实得 ' + built.questionIds.length + '）');
assert(new Set(built.questionIds).size === 20, '同一份卷子无重复题');
assert(built.questionIds.every((id) => QUESTION_MAP.has(id)), '卷内题目都能在题库中找到');
assert(built.domain === 'backend', '按 JD 判定方向为 backend（实得 ' + built.domain + '）');
const comp = built.composition;
assert(comp.jd + comp.domain + comp.general === 20, '三段题数相加等于总题量');
assert(comp.jd >= 10, '岗位知识点题占约 60%（实得 ' + comp.jd + '）');
assert(comp.general >= 1, '通用能力题占约 10%（实得 ' + comp.general + '）');

const built2 = core.buildPaper({ jdText: jd, targetRole: '后端开发工程师', count: 20, seed: 42 });
assert(JSON.stringify(built.questionIds) === JSON.stringify(built2.questionIds), '相同 seed 组卷结果可复现');

const built3 = core.buildPaper({ jdText: jd, count: 20, seed: 7 });
assert(JSON.stringify(built.questionIds) !== JSON.stringify(built3.questionIds), '不同 seed 得到不同卷子');

// 无 JD 也能组卷（全部方向 / 通用兜底）
const noJd = core.buildPaper({ count: 10, seed: 1 });
assert(noJd.questionIds.length === 10, '无 JD 时仍能组出完整卷子');
const smallBank = core.buildPaper({ jdText: jd, count: 50, seed: 3 });
assert(smallBank.questionIds.length <= EXAM_BANK.length, '题量超过题库时不会重复出题');

// ---------------- 4) 四种题型评分 ----------------
const single = EXAM_BANK.find((q) => q.type === 'single');
assert(core.isCorrect(single, single.answer), '单选：选中正确答案判对');
assert(!core.isCorrect(single, single.options.find((o) => o !== single.answer)), '单选：选错判错');
assert(!core.isCorrect(single, null), '单选：未作答判错');

const multi = EXAM_BANK.find((q) => q.type === 'multiple');
assert(core.isCorrect(multi, multi.answer.slice().reverse()), '多选：顺序不同但集合一致判对');
assert(!core.isCorrect(multi, multi.answer.slice(0, multi.answer.length - 1)), '多选：少选判错');
assert(!core.isCorrect(multi, multi.answer.concat([multi.options.find((o) => !multi.answer.includes(o))])),
  '多选：多选一个判错');

const judge = EXAM_BANK.find((q) => q.type === 'judge');
assert(core.isCorrect(judge, judge.answer), '判断：正确选项判对');
assert(!core.isCorrect(judge, judge.answer === '正确' ? '错误' : '正确'), '判断：反向判错');

const fill = EXAM_BANK.find((q) => q.type === 'fill');
const fillAnswer = Array.isArray(fill.answer) ? fill.answer[0] : fill.answer;
assert(core.isCorrect(fill, fillAnswer), '填空：标准答案判对');
assert(core.isCorrect(fill, '  ' + fillAnswer.toUpperCase() + '  '), '填空：忽略大小写与首尾空格');
assert(core.isCorrect(fill, fillAnswer.replace(/-/g, '－')), '填空：全角字符归一化后仍判对');
assert(!core.isCorrect(fill, '完全不相干的答案'), '填空：错误答案判错');
assert(!core.isCorrect(fill, ''), '填空：空字符串判错');

// ---------------- 5) 交卷评分 ----------------
const paperIds = [single.id, multi.id, judge.id, fill.id];
const allRight = {
  [single.id]: single.answer,
  [multi.id]: multi.answer,
  [judge.id]: judge.answer,
  [fill.id]: fillAnswer
};
const g1 = core.gradePaper(paperIds, allRight);
assert(g1.score === 100, '全对得 100 分（实得 ' + g1.score + '）');
assert(g1.correctCount === 4 && g1.totalCount === 4, '正确数/总数统计正确');
assert(g1.wrongIds.length === 0, '全对时错题为空');

// 一题答错、一题空着
const mixed = Object.assign({}, allRight);
mixed[single.id] = single.options.find((o) => o !== single.answer);
delete mixed[fill.id];
const g2 = core.gradePaper(paperIds, mixed);
assert(g2.score === 50, '四题对两题得 50 分（实得 ' + g2.score + '）');
assert(g2.wrongIds.includes(single.id), '答错的题进错题列表');
assert(!g2.wrongIds.includes(fill.id), '未作答的题不进错题本（只算错，不算错题）');
assert(g2.details.length === 4 && g2.details.every((d) => typeof d.correct === 'boolean'), '逐题结果完整');

// 知识点统计
const stat = g2.tagStats[single.tags[0]];
assert(!!stat && stat.total >= 1, '按知识点累计作答数');
assert(Object.values(g2.tagStats).every((s) => s.correct <= s.total), '知识点正确数不超过总数');

// ---------------- 6) 薄弱项 ----------------
const weak = core.weakTagsFromStats([
  { java: { correct: 1, total: 4 }, sql: { correct: 3, total: 3 } },
  { java: { correct: 0, total: 2 }, redis: { correct: 1, total: 2 } }
]);
assert(weak[0].tag === 'java', '薄弱项按正确率升序（java 最低）');
assert(weak.find((x) => x.tag === 'sql').rate === 1, '正确率计算正确');
assert(weak.find((x) => x.tag === 'java').total === 6, '同一知识点多次作答会合并统计');

// ---------------- 7) 下一轮练习 ----------------
const wrongs = [
  { questionId: single.id, errorCount: 3, lastWrongAt: Date.now(), mastered: false },
  { questionId: multi.id, errorCount: 1, lastWrongAt: Date.now() - 1000, mastered: false },
  { questionId: judge.id, errorCount: 5, lastWrongAt: Date.now(), mastered: true }
];
const review = core.buildReviewPaper(wrongs, 6, 99);
assert(review.includes(single.id), '下一轮包含未掌握的错题');
assert(!review.includes(judge.id), '已掌握的错题不再出现');
assert(new Set(review).size === review.length, '下一轮练习无重复题');
assert(review.length === 6, '下一轮练习题量正确（实得 ' + review.length + '）');

// ---------------- 8) 试卷校验 ----------------
assert(core.validatePaperInput({ questionIds: [] }) !== null, '空试卷被拒绝');
assert(core.validatePaperInput({ questionIds: ['not-exist'] }) !== null, '不存在的题目被拒绝');
assert(core.validatePaperInput({ questionIds: [single.id], durationSec: 30 }) !== null, '限时过短被拒绝');
assert(core.validatePaperInput({ questionIds: [single.id], durationSec: 1800 }) === null, '合法试卷通过校验');

// ---------------- 9) 索引与元信息 ----------------
assert(allDomains().length >= 4, '至少覆盖 4 个方向（实得 ' + allDomains().join('/') + '）');
assert(allTags().length >= 20, '知识点标签数量充足（实得 ' + allTags().length + '）');
assert(getQuestion(single.id) === single, 'getQuestion 按 id 命中');
assert(getQuestion('不存在') === null, 'getQuestion 未命中返回 null');

// ---------------- 10) 非技术方向题库（第六步扩充） ----------------
assert(EXAM_BANK.length >= 150, '题库规模 ≥150 题（实得 ' + EXAM_BANK.length + '）');

const NON_TECH = ['product', 'operation', 'finance', 'hr', 'admin', 'english', 'aptitude'];
NON_TECH.forEach((d) => {
  const n = EXAM_BANK.filter((q) => q.domain === d).length;
  assert(n >= 6, d + ' 方向题量 ≥6（实得 ' + n + '）');
});
assert(allDomains().length >= 10, '至少覆盖 10 个方向（实得 ' + allDomains().length + '）');

// 指定方向组卷：JD 份额应转给方向题，而不是从全库乱抽
const pmPaper = core.buildPaper({ domain: 'product', count: 10, seed: 5 });
const pmHits = pmPaper.questionIds.filter((id) => QUESTION_MAP.get(id).domain === 'product').length;
assert(pmHits >= 7, '指定产品方向时 ≥70% 题目来自该方向（实得 ' + pmHits + '/10）');
const enPaper = core.buildPaper({ domain: 'english', count: 10, seed: 6 });
const enHits = enPaper.questionIds.filter((id) => QUESTION_MAP.get(id).domain === 'english').length;
assert(enHits >= 7, '指定英语方向时 ≥70% 题目来自该方向（实得 ' + enHits + '/10）');

// 非技术 JD 的标签提取
const finTags = core.extractTags('财务专员：负责总账、报表编制、税务申报，熟悉增值税与资产负债率分析。');
assert(finTags.includes('财务'), '财务 JD 识别出「财务」标签');
assert(finTags.includes('报表') || finTags.includes('税务'), '财务 JD 识别出报表/税务标签');

const hrTags = core.extractTags('人力资源专员：负责招聘、绩效、员工关系与培训。');
assert(hrTags.includes('招聘') && hrTags.includes('绩效'), 'HR JD 识别出招聘/绩效标签');

const pmTags = core.extractTags('产品经理：负责需求分析与优先级排序，撰写 PRD，做 A/B 测试。');
assert(pmTags.includes('产品'), '产品 JD 识别出「产品」标签');

console.log('\n笔试中心自测完成: ' + pass + ' passed, ' + failCnt + ' failed | exitCode = ' + (process.exitCode || 0));
