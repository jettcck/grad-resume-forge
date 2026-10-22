'use strict';

// ============================================================
//  客观题库质量审核
//
//  检查四类问题（上线前自查用）：
//   1) 重复题：题干归一化后完全相同，或题干高度相似 + 选项集相同
//   2) 答案质量：答案为空 / 单选答案不在选项里 / 多选答案有选项外的值 / 判断题选项不是「正确·错误」
//   3) 解析质量：解析过短、纯占位文案（「略」「见教材」）
//   4) 知识点覆盖率：按方向与标签统计题量，标出 <3 题的薄弱标签
//
//  用法：node scripts/audit-exam-bank.js [--json]
//  退出码：0 = 无阻断项；1 = 存在「答案类」硬错误（上线前必须修）
// ============================================================
const path = require('path');
const { EXAM_BANK, BANK_VERSION } = require(path.join(__dirname, '..', 'dist/main/exam-bank.js'));

const asJson = process.argv.includes('--json');

const issues = { answer: [], dup: [], explain: [], coverage: [] };

// ---------- 1) 重复题 ----------
const norm = (s) => String(s == null ? '' : s)
  .replace(/\s+/g, '')
  .replace(/[，。；：、？！,.;:?!'"]/g, '')
  .toLowerCase();

const byStem = new Map();
EXAM_BANK.forEach((q) => {
  const key = norm(q.stem);
  if (!byStem.has(key)) byStem.set(key, []);
  byStem.get(key).push(q);
});
byStem.forEach((list, key) => {
  if (list.length > 1) {
    issues.dup.push({ kind: '题干完全相同', ids: list.map((q) => q.id), stem: list[0].stem.slice(0, 40) });
  }
});

// 题干前缀相似（前 24 字）且选项集合一致，多半是同一题的改写
const byPrefix = new Map();
EXAM_BANK.forEach((q) => {
  const prefix = norm(q.stem).slice(0, 24);
  if (prefix.length < 12) return;
  const opts = (q.options || []).map(norm).sort().join('|');
  const key = prefix + '#' + opts;
  if (!byPrefix.has(key)) byPrefix.set(key, []);
  byPrefix.get(key).push(q);
});
byPrefix.forEach((list) => {
  if (list.length > 1) {
    const ids = list.map((q) => q.id);
    const already = issues.dup.some((d) => d.ids.length === ids.length && d.ids.every((x) => ids.includes(x)));
    if (!already) {
      issues.dup.push({ kind: '题干前缀+选项相同', ids, stem: list[0].stem.slice(0, 40) });
    }
  }
});

// ---------- 2) 答案质量 ----------
EXAM_BANK.forEach((q) => {
  const opts = q.options || [];
  const ans = Array.isArray(q.answer) ? q.answer : [q.answer];
  const push = (msg) => issues.answer.push({ id: q.id, type: q.type, stem: q.stem.slice(0, 36), msg });

  if (!ans.length || ans.every((a) => !String(a || '').trim())) {
    push('答案为空');
    return;
  }
  if (q.type === 'single' || q.type === 'multiple') {
    if (!opts.length) push('选择题没有选项');
    const outside = ans.filter((a) => a && !opts.includes(a));
    if (outside.length) push('答案不在选项里：' + outside.join(' / '));
  }
  if (q.type === 'multiple' && !Array.isArray(q.answer)) {
    push('多选题答案不是数组');
  }
  if (q.type === 'multiple' && new Set(ans).size !== ans.length) {
    push('多选题答案有重复项');
  }
  if (q.type === 'judge') {
    const okOpts = opts.length === 2 && opts.includes('正确') && opts.includes('错误');
    if (!okOpts) push('判断题选项不是「正确/错误」：' + JSON.stringify(opts));
    if (Array.isArray(q.answer)) push('判断题答案不应是数组');
  }
  if (q.type === 'fill') {
    if (!ans.some((a) => String(a || '').trim())) push('填空题答案全为空');
  }
});

// ---------- 3) 解析质量 ----------
const PLACEHOLDER = ['略', '见教材', '略过', '暂无', 'todo', 'TODO', '无'];
EXAM_BANK.forEach((q) => {
  const ex = String(q.explanation || '').trim();
  const push = (msg) => issues.explain.push({ id: q.id, stem: q.stem.slice(0, 36), msg, len: ex.length });
  if (!ex) push('解析为空');
  else if (ex.length < 12) push('解析过短（' + ex.length + ' 字）');
  else if (PLACEHOLDER.includes(ex)) push('解析是占位文案');
  else if (!ex.includes('。') && !ex.includes('，')) push('解析像一句话片段，缺少说明过程');
});

// ---------- 4) 覆盖率 ----------
const byDomain = new Map();
const byTag = new Map();
EXAM_BANK.forEach((q) => {
  byDomain.set(q.domain || 'general', (byDomain.get(q.domain || 'general') || 0) + 1);
  (q.tags || []).forEach((t) => byTag.set(t, (byTag.get(t) || 0) + 1));
});
const domains = [...byDomain.entries()].sort((a, b) => b[1] - a[1]);
const tags = [...byTag.entries()].sort((a, b) => a[1] - b[1]);
const weakTags = tags.filter(([, n]) => n < 3);
issues.coverage = {
  total: EXAM_BANK.length,
  bankVersion: BANK_VERSION,
  domains: domains.map(([d, n]) => ({ domain: d, count: n })),
  tagCount: tags.length,
  weakTags: weakTags.map(([t, n]) => ({ tag: t, count: n }))
};

// ---------- 输出 ----------
if (asJson) {
  console.log(JSON.stringify(issues, null, 2));
} else {
  console.log('题库审核 · v' + BANK_VERSION + ' · 共 ' + EXAM_BANK.length + ' 题\n');

  console.log('【1】重复题：' + issues.dup.length + ' 组');
  issues.dup.forEach((d) => console.log('  - ' + d.kind + '：' + d.ids.join(', ') + '  「' + d.stem + '…」'));

  console.log('\n【2】答案问题：' + issues.answer.length + ' 条' + (issues.answer.length ? '（硬错误，必须修）' : ''));
  issues.answer.forEach((a) => console.log('  - [' + a.id + '] ' + a.msg + '  「' + a.stem + '…」'));

  console.log('\n【3】解析问题：' + issues.explain.length + ' 条');
  issues.explain.forEach((e) => console.log('  - [' + e.id + '] ' + e.msg + '  「' + e.stem + '…」'));

  console.log('\n【4】覆盖率');
  console.log('  方向分布：' + domains.map(([d, n]) => d + ' ' + n).join(' · '));
  console.log('  知识点 ' + tags.length + ' 个；题量 <3 的薄弱标签 ' + weakTags.length + ' 个');
  if (weakTags.length) console.log('  ' + weakTags.map(([t, n]) => t + '(' + n + ')').join(' · '));
}

// 答案类问题算硬错误（用排除法反推答案的正确性无法自动保证，但「答案不在选项里」这类一定是错的）
process.exitCode = issues.answer.length ? 1 : 0;
