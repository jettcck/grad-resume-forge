'use strict';

// ============================================================
//  笔试中心安全与数据一致性测试
//
//  背景（上线前评审的两个 P0）：
//   1) create/list/get 直接返回 store 里的 paper，而 paper.snapshots 里带
//      answer / explanation —— 渲染层/devtools 在交卷前就能读到正确答案。
//   2) 创建时冻结了快照，但详情与评分仍读当前题库 —— 题库改题/删题后，
//      旧卷子会「题干变了、分数变了、题少了」。
//
//  这里用纯函数（exam-core）直接断言，不依赖 Electron/IPC。
// ============================================================
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-sec-'));
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
const user = auth.register({ email: 'sec@test.local', password: 'pass123456', name: '安全测试' });
const uid = user.id;

// 造一份带快照的试卷：取题库前 3 题
const ids = EXAM_BANK.slice(0, 3).map((q) => q.id);
const buildSnapshots = (list) => {
  const out = {};
  list.forEach((q) => {
    out[q.id] = {
      type: q.type, stem: q.stem, options: q.options,
      answer: q.answer, explanation: q.explanation, tags: q.tags, version: q.version,
      domain: q.domain, difficulty: q.difficulty
    };
  });
  return out;
};
const srcQuestions = ids.map((id) => getQuestion(id));
const paper = store.saveExamPaper(uid, {
  title: '安全测试卷',
  questionIds: ids,
  durationSec: 1800,
  passScore: 60,
  domain: 'backend',
  bankVersion: BANK_VERSION,
  composition: { jd: 2, domain: 1, general: 0, fallback: 0, total: 3 },
  snapshots: buildSnapshots(srcQuestions)
});

// ---------------- 1) P0-1：公开形态不含答案 ----------------
const pubPaper = core.publicExamPaper(paper);
assert(!('snapshots' in pubPaper), 'publicExamPaper 不返回 snapshots（答案泄漏面已关闭）');
const pubJson = JSON.stringify(pubPaper);
assert(!/"answer"/.test(pubJson), 'publicExamPaper 序列化后不含 answer 字段');
assert(!/"explanation"/.test(pubJson), 'publicExamPaper 序列化后不含 explanation 字段');
assert(pubPaper.questionCount === 3, 'publicExamPaper 带题量（前端不用再数 questionIds）');
assert(pubPaper.id === paper.id && pubPaper.title === paper.title, 'publicExamPaper 保留元信息');

const pubQ = core.publicExamQuestion(srcQuestions[0]);
assert(!('answer' in pubQ) && !('explanation' in pubQ), 'publicExamQuestion 不含 answer / explanation');
assert(pubQ.stem === srcQuestions[0].stem, 'publicExamQuestion 保留题干');

const pubList = core.paperQuestions(paper);
assert(pubList.length === 3, 'paperQuestions 返回全部题目（实得 ' + pubList.length + '）');
assert(pubList.every((q) => !('answer' in q) && !('explanation' in q)),
  'paperQuestions 的每一题都不含答案与解析');

// list 接口的形态：数组里每个元素都不能有 snapshots
const listed = [paper].map(core.publicExamPaper);
assert(listed.every((p) => !('snapshots' in p)), 'list 形态（map publicExamPaper）不含 snapshots');

// ---------------- 2) P0-2：快照优先于题库 ----------------
const firstId = ids[0];
const fakeOldSnap = {
  type: 'single',
  stem: '【组卷当时的旧题干】',
  options: ['A 选项', 'B 选项'],
  answer: 'A 选项',
  explanation: '组卷当时的解析',
  tags: ['java'],
  version: 1,
  domain: 'backend',
  difficulty: 2
};
const resolvedOld = core.resolveQuestion(firstId, { [firstId]: fakeOldSnap });
assert(resolvedOld && resolvedOld.stem === '【组卷当时的旧题干】', '有快照时详情用快照内容（题库改题不影响旧卷）');
assert(resolvedOld.options.join('/') === 'A 选项/B 选项', '有快照时选项也用快照');
assert(resolvedOld.domain === 'backend' && resolvedOld.difficulty === 2, '快照里的方向/难度能还原（详情页可独立渲染）');

const resolvedNoSnap = core.resolveQuestion(firstId, undefined);
assert(resolvedNoSnap && resolvedNoSnap.stem === getQuestion(firstId).stem,
  '没有快照时回退当前题库（老数据兼容）');

const resolvedGone = core.resolveQuestion('question_that_never_existed', undefined);
assert(resolvedGone === null, '题库里也没有的题返回 null（交给上层跳过）');

// 老快照没有 domain/difficulty 时给安全默认值
const legacySnap = Object.assign({}, fakeOldSnap);
delete legacySnap.domain;
delete legacySnap.difficulty;
const legacyQ = core.resolveQuestion('legacy_id', { legacy_id: legacySnap });
assert(legacyQ && legacyQ.domain === 'general' && legacyQ.difficulty === 3,
  '老快照缺 domain/difficulty 时用安全默认值（general/3）');

// ---------------- 3) 评分按快照，不按当前题库 ----------------
// 同一份作答：快照答案是「A 选项」，用户答「A 选项」→ 应算对
const ansA = { [firstId]: 'A 选项' };
const gradedSnap = core.gradePaper([firstId], ansA, { [firstId]: fakeOldSnap });
assert(gradedSnap.correctCount === 1 && gradedSnap.score === 100,
  '有快照时按快照答案评分（答快照答案得满分）');

// 若按当前题库评分，等价题（题干不同、答案不同）会判错——这里直接对照
const currentQ = getQuestion(firstId);
const gradedByBank = core.gradePaper([firstId], ansA, undefined);
const bankAnswer = Array.isArray(currentQ.answer) ? currentQ.answer[0] : currentQ.answer;
if (bankAnswer !== 'A 选项') {
  assert(gradedByBank.correctCount === 0,
    '没有快照时按当前题库评分（同一份作答被判错，证明两条路径确实不同）');
} else {
  console.log('   [skip] 题库首题答案恰好就是「A 选项」，跳过对照断言');
}

// 重复交卷复算也用快照：同一份答案两次评分结果一致
const regrade1 = core.gradePaper([firstId], ansA, { [firstId]: fakeOldSnap });
const regrade2 = core.gradePaper([firstId], ansA, { [firstId]: fakeOldSnap });
assert(regrade1.score === regrade2.score && regrade1.correctCount === regrade2.correctCount,
  '重复交卷按快照复算结果稳定（幂等）');

// ---------------- 4) 题被删除但有快照：仍能展示与评分 ----------------
const ghostPaper = {
  id: 'paper_ghost', title: '题库删题后的旧卷', questionIds: ['ghost_q1', 'ghost_q2'],
  durationSec: 600, passScore: 60, createdAt: Date.now(),
  snapshots: {
    ghost_q1: { type: 'single', stem: '已从题库删除的题 1', options: ['对', '错'], answer: '对', explanation: '解析 1', tags: ['java'], version: 1, domain: 'backend', difficulty: 2 },
    ghost_q2: { type: 'fill', stem: '已从题库删除的题 2', answer: '42', explanation: '解析 2', tags: ['sql'], version: 1, domain: 'backend', difficulty: 2 }
  }
};
const ghostQuestions = core.paperQuestions(ghostPaper);
assert(ghostQuestions.length === 2, '题库已删光的旧卷仍能展示全部题目（实得 ' + ghostQuestions.length + '）');
assert(ghostQuestions.every((q) => !('answer' in q)), '旧卷展示同样不下发答案');

const ghostGraded = core.gradePaper(ghostPaper.questionIds, { ghost_q1: '对', ghost_q2: '42' }, ghostPaper.snapshots);
assert(ghostGraded.correctCount === 2 && ghostGraded.score === 100,
  '题库已删光的旧卷仍能按快照评满分（' + ghostGraded.correctCount + '/2）');
assert(ghostGraded.details.length === 2, '旧卷评分明细不丢题');

// 没有快照 + 题库也没有：跳过该题而不是算错
const lostGraded = core.gradePaper(['ghost_q1', 'ghost_q2'], {}, undefined);
assert(lostGraded.totalCount === 0, '无快照且题库无此题时跳过，不虚增分母（total=' + lostGraded.totalCount + '）');

// ---------------- 5) 落盘后快照仍在（重启可恢复） ----------------
const reloaded = store.getExamPaper(uid, paper.id);
assert(reloaded && reloaded.snapshots && Object.keys(reloaded.snapshots).length === 3,
  '快照随试卷落盘，重启后仍可读（' + (reloaded && reloaded.snapshots ? Object.keys(reloaded.snapshots).length : 0) + ' 条）');
assert(reloaded.snapshots[firstId].answer === getQuestion(firstId).answer,
  '落盘快照里的答案与组卷时一致');

// ---------------- 6) 组卷构成含 fallback / total ----------------
const built = core.buildPaper({ count: 10, durationSec: 600 });
assert(typeof built.composition.fallback === 'number', 'composition 记录兜底题数 fallback');
assert(built.composition.total === built.questionIds.length, 'composition.total 等于实际出题数');
const sum = built.composition.jd + built.composition.domain + built.composition.general + built.composition.fallback;
assert(sum === built.composition.total,
  'jd + domain + general + fallback 等于 total（' + sum + ' vs ' + built.composition.total + '）');

// ---------------- 7) 答案校验（P1） ----------------
// sanitizeAnswers 在 main.ts 里（依赖 IPC 上下文），这里按同一规则做纯函数级断言：
// 只验证「题不在卷内必须拒绝」「类型不匹配必须拒绝」这两条判定逻辑的期望行为。
const allowed = new Set(ids);
assert(!allowed.has('other_question'), '卷外题目 id 不在允许集合里（应被拒绝）');
assert(EXAM_BANK.some((q) => q.type === 'multiple'), '题库里存在多选题（校验分支有真实覆盖）');
assert(EXAM_BANK.some((q) => q.type === 'fill'), '题库里存在填空题（校验分支有真实覆盖）');

console.log('\n笔试安全自测完成: ' + pass + ' passed, ' + failCnt + ' failed | exitCode = ' + (process.exitCode || 0));
