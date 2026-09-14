'use strict';

// ============================================================
//  输入校验自测
//  动机：IPC 参数只靠 TypeScript 类型是纸糊的（运行时不存在类型），
//  异常大的文本会让数据文件膨胀、界面卡顿、模型请求超限。
//  运行：node test-validate.js
// ============================================================
const path = require('path');
const { LIMITS, assertSize, assertPlainObject, sizeOf } = require(path.join(__dirname, 'dist/main/validate'));

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// ---------- 体积 ----------
assert(sizeOf('abc') === 3, '字符串按 UTF-8 字节计');
assert(sizeOf('中文') === 6, '中文按 3 字节计（不是按字符数）');
assert(sizeOf({ a: 1 }) === 7, '对象按序列化后字节计');
assert(sizeOf(null) === 0 && sizeOf(undefined) === 0, '空值算 0 字节');

assert(throws(() => assertSize('x'.repeat(100), 200, '字段')) === null, '未超限时放行');
const e1 = throws(() => assertSize('x'.repeat(300), 200, '职位描述'));
assert(!!e1 && /职位描述过大/.test(e1.message) && /上限/.test(e1.message), '超限时报错并说明是哪个字段（' + (e1 && e1.message) + '）');

const bigProfile = { projects: [{ description: 'x'.repeat(LIMITS.profileJson) }] };
const e2 = throws(() => assertSize(bigProfile, LIMITS.profileJson, '档案'));
assert(!!e2, '超大的档案被拒（避免数据文件无限膨胀）');

// 循环引用：序列化失败必须当作「超大」拒掉，而不是让 IPC 直接崩
const cyclic = {}; cyclic.self = cyclic;
assert(sizeOf(cyclic) === Number.MAX_SAFE_INTEGER, '无法序列化的对象被当作超大');
assert(!!throws(() => assertSize(cyclic, LIMITS.profileJson, '档案')), '循环引用同样被拒');

// ---------- 形状 ----------
assert(throws(() => assertPlainObject({ name: 'x' }, '档案')) === null, '普通对象放行');
assert(!!throws(() => assertPlainObject(['a'], '档案')), '数组冒充对象被拒');
assert(!!throws(() => assertPlainObject('字符串', '档案')), '字符串冒充对象被拒');
assert(!!throws(() => assertPlainObject(null, '档案')), 'null 被拒');

// ---------- 上限值本身要合理 ----------
assert(LIMITS.jdText >= 4 * 1024 && LIMITS.jdText <= 64 * 1024, 'JD 上限在合理区间（' + Math.round(LIMITS.jdText / 1024) + 'KB）');
assert(LIMITS.profileJson >= LIMITS.jdText, '档案上限不低于 JD 上限（一份档案本来就更大）');
assert(LIMITS.importFile >= 1024 * 1024, '导入文件上限至少 1MB（正常 PDF 简历几百 KB）');

console.log('\n输入校验自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
