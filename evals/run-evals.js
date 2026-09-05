'use strict';

// ============================================================
//  规则层评测：golden case 回归基线
//  - 无外部依赖，CI 可跑（npm run eval）
//  - 每个 case 是「输入 → 期望行为」的黄金样本：
//    matchJd 期望命中/缺失的技能与分数区间
//    audit   期望分数区间与问题类型
//    rewrite 期望删除的套话 / 保留的量化 / 动词开头
//    domain  期望方向识别
//  结果写 evals/report.json，任一失败 exit 1
// ============================================================

const fs = require('fs');
const path = require('path');
const engine = require('../dist/main/resume-engine');

const cases = require('./cases.json');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ✅ ' + name);
  } else {
    fail++;
    failures.push({ case: name, detail: detail || '' });
    console.log('  ❌ ' + name + (detail ? '  | ' + detail : ''));
  }
}

console.log('== matchJd：JD 精准匹配 ==');
(cases.matchJd || []).forEach((c) => {
  let r;
  try {
    r = engine.matchJd(c.resume, c.jd);
  } catch (err) {
    check(c.name, false, '异常 ' + err.message);
    return;
  }
  const hit = r.hit.map((h) => h.label);
  const miss = r.missing.map((m) => m.label);
  const okHit = (c.expectHit || []).every((l) => hit.includes(l));
  const okMiss = (c.expectMiss || []).every((l) => miss.includes(l));
  const lo = (c.scoreRange || [0, 100])[0];
  const hi = (c.scoreRange || [0, 100])[1];
  check(c.name, okHit && okMiss && r.score >= lo && r.score <= hi,
    'score=' + r.score + ' hit=[' + hit.join(',') + '] miss=[' + miss.join(',') + ']');
});

console.log('== audit：去 AI 味体检 ==');
(cases.audit || []).forEach((c) => {
  const r = engine.auditAiFlavor(c.text);
  const types = new Set(r.issues.map((i) => i.type));
  const lo = (c.scoreRange || [0, 100])[0];
  const hi = (c.scoreRange || [0, 100])[1];
  const okTypes = (c.expectTypes || []).every((t) => types.has(t));
  check(c.name, r.score >= lo && r.score <= hi && okTypes,
    'score=' + r.score + ' issues=[' + Array.from(types).join(',') + ']');
});

console.log('== rewrite：条目改写 ==');
(cases.rewrite || []).forEach((c) => {
  const out = engine.rewriteBullet(c.input, c.domain, 0);
  const okNot = (c.expectNotInclude || []).every((w) => !out.includes(w));
  const okIn = (c.expectInclude || []).every((w) => out.includes(w));
  const okStart = !c.expectStartsWith || out.startsWith(c.expectStartsWith);
  check(c.name, okNot && okIn && okStart, '输出=' + out);
});

console.log('== domain：方向识别 ==');
(cases.domain || []).forEach((c) => {
  const got = engine.detectDomain(c.text);
  check(c.name, got === c.expect, '得到 ' + got);
});

const total = pass + fail;
const report = {
  timestamp: new Date().toISOString(),
  suite: 'rule-layer',
  total,
  passed: pass,
  failed: fail,
  failures
};
const reportFile = path.join(__dirname, 'report.json');
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf-8');

console.log('');
console.log('规则层评测：' + pass + '/' + total + ' 通过' + (fail ? '，' + fail + ' 失败' : ''));
console.log('报告已写入 ' + reportFile);
process.exitCode = fail ? 1 : 0;
