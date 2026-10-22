'use strict';
// ============================================================
//  渲染层 UI 回归：el() children 容错 + renderCodeView 静态规范
//
//  背景（真实事故）：renderCodeView 里 el('span', {}, (q.tags||[]).join(' · '))
//  给 el() 传了裸字符串，而 el() 只接受数组 → TypeError →
//  整个 renderCodeView 崩掉 → 编程题页面点进去全黑。
//  该 bug 从编程题上线第一天（commit 823f4b2）就存在，
//  因为所有测试都只覆盖数据层，没人真实渲染过 UI。
//
//  两层防护：
//   1) el() 本身加容错（vm 里加载真 ui.js 验证）
//   2) 静态扫描 app.js：el() 第三参数不允许裸字符串（防新代码再踩）
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

setTimeout(() => {
  console.error('⏰ 看门狗超时：测试疑似悬挂，强制退出（exit 1）');
  process.exit(1);
}, 30000).unref();

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

const RENDERER = path.join(__dirname, 'src', 'renderer');

// ---- 最小 DOM 桩 ----
function makeNode(tag) {
  return {
    tagName: tag, children: [], className: '', innerHTML: '', textContent: '',
    setAttribute() {}, addEventListener() {},
    appendChild(c) { this.children.push(c); return c; }
  };
}
const sandbox = {
  console,
  document: {
    createElement: makeNode,
    createTextNode: (t) => ({ text: t }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
  },
  window: {},
  location: { search: '' },
  navigator: { userAgent: 'test' }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

// 加载真 ui.js（IIFE，挂 window.el）
const uiSrc = fs.readFileSync(path.join(RENDERER, 'ui.js'), 'utf8');
vm.runInContext(uiSrc, sandbox);

assert(typeof sandbox.window.UI === 'object' && typeof sandbox.window.UI.el === 'function',
  'ui.js 加载后 window.UI.el 可用');
const el = sandbox.window.UI.el;

// 1) 容错：裸字符串 children 不抛错，且真的渲染出文本
let node = null;
try {
  node = el('span', {}, '限时 1000ms');
  assert(true, 'el(tag, attrs, 裸字符串) 不再抛 TypeError');
} catch (e) {
  assert(false, 'el(tag, attrs, 裸字符串) 不再抛 TypeError（实际抛出：' + e.message + '）');
}
assert(node && node.children.length === 1 && node.children[0].text === '限时 1000ms',
  '裸字符串 children 被渲染成文本节点');

// 2) 数组写法照旧工作
node = el('div', { class: 'x' }, ['a', null, 'b']);
assert(node.children.length === 2 && node.children[0].text === 'a' && node.children[1].text === 'b',
  '数组 children 行为不变（null 跳过）');

// 3) 单个节点也接受
const inner = el('b', {}, ['粗体']);
node = el('div', {}, inner);
assert(node.children.length === 1 && node.children[0].tagName === 'b',
  '单个节点 children 被接受');

// 4) undefined / null 不抛错
node = el('div', {}, undefined);
assert(node.children.length === 0, 'undefined children 不抛错');
node = el('div', {}, null);
assert(node.children.length === 0, 'null children 不抛错');

// ---- 5) 静态扫描：app.js 里 el() 第三参数不允许「字符串类」表达式 ----
// 当年出事的写法：el('span', {}, (q.tags || []).join(' · ')) —— join 出字符串
// 合法：数组字面量 [..]、变量、X.map(..)（都是数组）
// 违规：字符串字面量 'x'、"x"、`x`，字符串拼接 a + b，.join(..)，String(..)，(cond ? 'a' : 'b')
// 注意 [^[\s(]：第一个字符不允许 [ 、空白、( —— 否则 \s* 回溯会让空格通过，误报一片
const appSrc = fs.readFileSync(path.join(RENDERER, 'app.js'), 'utf8');
const bad = [];
appSrc.split('\n').forEach((line, i) => {
  const m = line.match(/el\(\s*(['"][^'"]+['"])\s*,\s*\{[^{}]*\}\s*,\s*([^[\s(].*?)\)\s*[,;]?\s*$/);
  if (!m) return;
  const third = m[2].trim();
  const isStringy = /^['"`]/.test(third)            // 字符串字面量开头
    || /\s\+\s/.test(third)                          // 字符串拼接
    || /\.join\(/.test(third)                        // join 结果是字符串
    || /^String\(/.test(third)                       // String() 转字符串
    || /\?\s*['"][^'"]*['"]\s*:\s*['"]/.test(third); // cond ? 'a' : 'b'
  if (isStringy) bad.push((i + 1) + ': ' + line.trim().slice(0, 100));
});
assert(bad.length === 0, 'app.js 无 el() 字符串类 children 调用（违规：' + (bad.join(' ; ') || '无') + '）');

// ---- 6) renderCodeView 关键行必须是数组写法（事故行的直接守护）----
assert(/el\('span', \{\}, \['★'\.repeat\(q\.difficulty\)\]\)/.test(appSrc),
  'code-meta-row 难度星标是数组写法');
assert(/el\('span', \{\}, \[\(q\.tags \|\| \[\]\)\.join\(' · '\)\]\)/.test(appSrc),
  'code-meta-row 标签是数组写法（事故行）');
assert(/el\('span', \{\}, \['限时 ' \+ q\.timeLimitMs \+ 'ms'\]\)/.test(appSrc),
  'code-meta-row 限时是数组写法');
assert(/el\('span', \{\}, \['内存 ' \+ q\.memoryLimitMb \+ 'MB'\]\)/.test(appSrc),
  'code-meta-row 内存是数组写法');

console.log('\n渲染层 UI 回归自测完成: ' + pass + ' passed, ' + failCnt + ' failed | exitCode = ' + (process.exitCode || 0));
