'use strict';

// ============================================================
//  笔试中心：状态机 / 幂等 / 数据隔离自测
//  覆盖：重复交卷不重复统计、终态不可回退、孤立草稿拒绝、
//        学习计划按岗位拆分、试卷快照与真实组卷构成、未作答分类
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-exam-'));
process.env.GRF_TEST_DIR = tmp;
const store = require('./dist/main/store');
const auth = require('./dist/main/auth');
const core = require('./dist/main/exam-core');
const { EXAM_BANK, getQuestion, BANK_VERSION } = require('./dist/main/exam-bank');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

store.init(tmp);
const user = auth.register({ email: 'exam@test.local', password: 'pass123456', name: '笔试测试' });
const uid = user.id;

const ids = EXAM_BANK.slice(0, 4).map((q) => q.id);
const paper = store.saveExamPaper(uid, {
  title: '测试卷',
  jobId: 'job_x',
  jobCompany: '赞同科技',
  jobPosition: '大模型算法工程师',
  questionIds: ids,
  durationSec: 1800,
  passScore: 60,
  domain: 'backend',
  bankVersion: BANK_VERSION,
  composition: { jd: 3, domain: 1, general: 0 },
  snapshots: {
    [ids[0]]: { type: 'single', stem: '快照题干', options: ['A', 'B'], answer: 'A', explanation: '解析', tags: ['java'], version: 1 }
  }
});

// ---------------- 1) 试卷快照与构成 ----------------
assert(paper.jobCompany === '赞同科技' && paper.jobPosition === '大模型算法工程师', '试卷保存岗位快照');
assert(paper.bankVersion === BANK_VERSION, '试卷记录题库版本');
assert(paper.composition && paper.composition.jd === 3, '试卷记录真实组卷构成');
assert(paper.snapshots && paper.snapshots[ids[0]].stem === '快照题干', '试卷保存题目内容快照');

// ---------------- 2) 草稿生命周期 ----------------
const att = store.saveExamAttempt(uid, { paperId: paper.id, answers: {}, status: 'draft', totalCount: ids.length });
assert(att.status === 'draft' && att.id, '新建草稿');

const saved = store.saveExamAttempt(uid, { id: att.id, answers: { [ids[0]]: 'A' }, status: 'draft' });
assert(saved.answers[ids[0]] === 'A', '草稿可保存作答');

// 不存在的 id 不能被写成孤立草稿
let threw = false;
try { store.saveExamAttempt(uid, { id: 'att_not_exist', answers: {} }); } catch (_) { threw = true; }
assert(threw, '不存在的 attemptId 被拒绝（不产生孤立草稿）');

// ---------------- 3) 交卷后终态 ----------------
const submitted = store.saveExamAttempt(uid, {
  id: att.id, answers: { [ids[0]]: 'A' }, score: 75, correctCount: 3,
  totalCount: 4, durationSec: 600, status: 'submitted', tagStats: { java: { correct: 1, total: 1 } }
});
assert(submitted.status === 'submitted' && submitted.score === 75, '交卷写入成绩');

// 已交卷不能再回草稿（否则时间/答案会被改写，统计失真）
threw = false;
try { store.saveExamAttempt(uid, { id: att.id, answers: {}, status: 'draft' }); } catch (_) { threw = true; }
assert(threw, '已交卷不能回退为草稿');

// 重复交卷：幂等返回原记录，分数不被覆盖
const again = store.saveExamAttempt(uid, {
  id: att.id, answers: {}, score: 100, status: 'submitted'
});
assert(again.score === 75, '重复交卷不覆盖第一次成绩（实得 ' + again.score + '）');
assert(again.correctCount === 3, '重复交卷不覆盖正确数');

// 已交卷不能再改答案
threw = false;
try { store.saveExamAttempt(uid, { id: att.id, answers: { [ids[0]]: 'B' } }); } catch (_) { threw = true; }
assert(threw, '已交卷不能再修改答案');

// 放弃态同样不可写
const att2 = store.saveExamAttempt(uid, { paperId: paper.id, answers: {}, status: 'draft' });
store.saveExamAttempt(uid, { id: att2.id, status: 'abandoned' });
threw = false;
try { store.saveExamAttempt(uid, { id: att2.id, answers: {}, status: 'draft' }); } catch (_) { threw = true; }
assert(threw, '已放弃的作答不能回退');

// ---------------- 4) 学习计划按岗位拆分 ----------------
store.saveStudyPlan(uid, { jobId: 'job_a', targetRole: '后端', completedCount: 20, weakTags: ['java'] });
store.saveStudyPlan(uid, { jobId: 'job_b', targetRole: '算法', completedCount: 10, weakTags: ['sql'] });
store.saveStudyPlan(uid, { completedCount: 5, weakTags: ['logic'] });

const planA = store.getStudyPlan(uid, 'job_a');
const planB = store.getStudyPlan(uid, 'job_b');
const planGeneral = store.getStudyPlan(uid);
assert(planA.completedCount === 20 && planA.targetRole === '后端', '岗位 A 的计划独立保存');
assert(planB.completedCount === 10 && planB.targetRole === '算法', '岗位 B 的计划不被 A 覆盖');
assert(planGeneral.completedCount === 5, '通用计划与岗位计划互不影响');
assert(store.listStudyPlans(uid).length === 3, '三个计划并存（实得 ' + store.listStudyPlans(uid).length + '）');

// 再考一次 job_a：只累加自己的进度
store.saveStudyPlan(uid, { jobId: 'job_a', completedCount: 20 + 20, weakTags: ['java', 'spring'] });
assert(store.getStudyPlan(uid, 'job_a').completedCount === 40, '同一岗位进度累加正确');
assert(store.getStudyPlan(uid, 'job_b').completedCount === 10, '累加不影响其它岗位');

// ---------------- 5) 未作答 vs 答错 ----------------
const q0 = getQuestion(ids[0]);
const q1 = getQuestion(ids[1]);
const graded = core.gradePaper([q0.id, q1.id], {
  // q0 故意答错（选一个非答案项），q1 留空
  [q0.id]: q0.type === 'multiple' ? ['不存在的选项'] : (q0.options || []).find((o) => o !== q0.answer) || 'x'
});
const d0 = graded.details.find((d) => d.questionId === q0.id);
const d1 = graded.details.find((d) => d.questionId === q1.id);
assert(d0.reason === 'wrong', '答错标记为 wrong');
assert(d1.reason === 'unanswered', '留空标记为 unanswered');
assert(graded.wrongIds.includes(q0.id), '答错的进错题池');
assert(!graded.wrongIds.includes(q1.id), '未作答不进错题池');

// ---------------- 6) 试卷校验 ----------------
assert(core.validatePaperInput({ questionIds: ids, durationSec: 1800 }) === null, '合法试卷通过校验');
assert(core.validatePaperInput({ questionIds: ids, durationSec: 30 }) !== null, '时长过短被拒绝');
assert(core.validatePaperInput({ questionIds: ['bad_id'] }) !== null, '不存在的题目被拒绝');
assert(core.validatePaperInput({ questionIds: new Array(60).fill(ids[0]) }) !== null, '超过 50 题被拒绝');

// ---------------- 8) 知识点趋势 ----------------
assert(core.buildTagTrends([]).length === 0, '无作答记录时趋势为空');
assert(core.buildTagTrends([
  { status: 'submitted', tagStats: { java: { correct: 1, total: 3 } }, submittedAt: 1 }
]).length === 0, '样本不足 2 次的知识点不进入趋势');

const trendAttempts = [
  { status: 'submitted', tagStats: { java: { correct: 1, total: 4 }, sql: { correct: 3, total: 4 } }, submittedAt: 1000 },
  { status: 'submitted', tagStats: { java: { correct: 3, total: 4 }, sql: { correct: 4, total: 4 } }, submittedAt: 2000 },
  { status: 'submitted', tagStats: { java: { correct: 4, total: 5 } }, submittedAt: 3000 },
  { status: 'draft', tagStats: { java: { correct: 0, total: 9 } }, submittedAt: 4000 }
];
const trends = core.buildTagTrends(trendAttempts, 3);
assert(trends.length === 2, '只返回有足够样本的知识点（实得 ' + trends.length + '）');
assert(trends[0].tag === 'java', '最薄弱的知识点排第一位（java）');
assert(trends[0].points.length === 3, '趋势点按已交卷次数生成（实得 ' + trends[0].points.length + '）');
assert(Math.abs(trends[0].points[0] - 0.25) < 1e-9 && Math.abs(trends[0].points[2] - 0.8) < 1e-9,
  '趋势点按时间顺序递增（0.25 → 0.8）');
assert(trends.every((t) => t.rate >= 0 && t.rate <= 1), '正确率在 0-1 之间');
assert(core.buildTagTrends(trendAttempts, 1).length === 1, 'topN 生效');

// ---------------- 9) 用户隔离 ----------------
const user2 = auth.register({ email: 'exam2@test.local', password: 'pass123456', name: '用户二' });
assert(store.listExamPapers(user2.id).length === 0, '试卷按用户隔离');
assert(store.listExamAttempts(user2.id).length === 0, '作答按用户隔离');
assert(store.getStudyPlan(user2.id) === null, '学习计划按用户隔离');

console.log('\n笔试状态机自测完成: ' + pass + ' passed, ' + failCnt + ' failed | exitCode = ' + (process.exitCode || 0));

// ---------------- 10) 编程题草稿 + 提交记录 ----------------
store.saveCodeDraft(uid, 'code-a-plus-b', 'javascript', 'console.log(1)');
store.saveCodeDraft(uid, 'code-a-plus-b', 'javascript', 'console.log(2)');
store.saveCodeDraft(uid, 'code-a-plus-b', 'cpp', 'int main(){}');
assert(store.getCodeDraft(uid, 'code-a-plus-b', 'javascript').code === 'console.log(2)',
  '草稿按「题目+语言」覆盖更新');
assert(store.getCodeDraft(uid, 'code-a-plus-b', 'cpp').code === 'int main(){}',
  '同一题不同语言草稿互不覆盖');
assert(store.getCodeDraft(uid, 'code-a-plus-b', 'python') === null, '没存过的语言返回 null');

store.saveCodeDraft(uid, 'code-a-plus-b', 'javascript', '');
assert(store.getCodeDraft(uid, 'code-a-plus-b', 'javascript').code === '',
  '空代码也保存（用户清空编辑器要记住）');

store.addCodeSubmission(uid, { questionId: 'code-a-plus-b', lang: 'cpp', verdict: 'AC', passed: 5, total: 5, timeMs: 12 });
store.addCodeSubmission(uid, { questionId: 'code-a-plus-b', lang: 'cpp', verdict: 'WA', passed: 3, total: 5, timeMs: 40 });
store.addCodeSubmission(uid, { questionId: 'code-reverse-string', lang: 'javascript', verdict: 'AC', passed: 4, total: 4, timeMs: 8 });

const subs = store.listCodeSubmissions(uid);
assert(subs.length === 3, '提交记录按用户保存（实得 ' + subs.length + '）');
assert(subs[0].createdAt >= subs[2].createdAt, '提交记录倒序返回（最新在前）');
assert(store.listCodeSubmissions(uid, 'code-a-plus-b').length === 2, '可按题目过滤提交记录');
assert(store.listCodeSubmissions(uid, 'code-a-plus-b').some((s) => s.verdict === 'AC'),
  'AC 记录可被侧栏勾选识别');

const sub1 = store.addCodeSubmission(uid, { questionId: 'code-x', lang: 'python', verdict: 'AC' });
assert(!!sub1.id && !!sub1.createdAt, '提交记录自动补 id 和时间');
assert(store.listCodeSubmissions(user2.id).length === 0, '提交记录按用户隔离');
assert(store.getCodeDraft(user2.id, 'code-a-plus-b', 'javascript') === null, '草稿按用户隔离');

// 重启不丢：重新走一遍 load
const dbPath = path.join(tmp, 'grad-resume-data', 'db.json');
assert(fs.existsSync(dbPath), 'db.json 已生成');
const reloaded = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
assert(!!reloaded.codeDrafts && !!reloaded.codeDrafts[uid] && !!reloaded.codeSubmissions,
  '草稿与提交记录已落盘到 db.json');
console.log('✅ PASS: 草稿与提交记录落盘');
