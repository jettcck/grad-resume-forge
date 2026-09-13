'use strict';

// ============================================================
//  UI 接线审计（静态）：找出「看起来有、实际没接上」的东西
//    1. 渲染层点击后引用的函数不存在        → 点了没反应
//    2. preload 暴露但渲染层从不调用        → 半成品接口 / 忘了接线
//    3. 主进程注册但 preload 从不使用       → 死 IPC
//    4. 定义了却没人引用的函数              → 未完成 / 死代码
//    5. 渲染层调用的 preload 方法没有对应实现
//  运行：node scripts/audit-ui.js
// ============================================================
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const app = R('src/renderer/app.js');
const preload = R('src/main/preload.ts');
const main = R('src/main/main.ts');
const mock = R('scripts/screenshot.js');

const line = (s) => console.log(s);

// ---------- 1) 点击引用不存在的函数 ----------
const KEYWORDS = new Set(['async', 'await', 'function', 'return', 'if', 'else', 'for', 'while', 'new', 'typeof', 'void', 'this']);
const defined = new Set();
// 允许缩进：函数内的局部 helper（如 renderResumePage 里的 pickMode）也是合法定义
[...app.matchAll(/^\s*(?:async\s+)?function\s+(\w+)/gm)].forEach((m) => defined.add(m[1]));
[...app.matchAll(/^\s*(?:const|let|var)\s+(\w+)\s*=/gm)].forEach((m) => defined.add(m[1]));
[...app.matchAll(/^\s*(\w+):\s*(?:async\s*)?(?:function\b|\()/gm)].forEach((m) => defined.add(m[1])); // 对象方法
[...app.matchAll(/^\s*(\w+)\s*\([^)]*\)\s*\{/gm)].forEach((m) => defined.add(m[1])); // 方法简写

const calledInHandlers = new Set();
// 只认「直接调用」：前面不能是 .（排除 obj.apply(...) 这种成员调用）
const callRe = /(?:onclick:\s*|addEventListener\('click',\s*)(?:\(\s*\)\s*=>\s*)?(?:async\s+)?(?!\.)([A-Za-z_$][\w$]*)\s*\(/g;
[...app.matchAll(callRe)].forEach((m) => calledInHandlers.add(m[1]));
const builtins = new Set(['alert', 'confirm', 'console', 'window', 'document', 'print', 'String', 'Number', 'JSON', 'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'clearTimeout', 'call', 'then', 'catch']);
const brokenHandlers = [...calledInHandlers].filter((n) => !defined.has(n) && !builtins.has(n) && !KEYWORDS.has(n));
line('== 1) 按钮/点击处理引用的函数 ==');
line(brokenHandlers.length === 0
  ? '  OK  引用的 ' + calledInHandlers.size + ' 个函数全部有定义'
  : '  ❌ 引用了不存在的函数: ' + brokenHandlers.join(', '));

// ---------- 2) preload 暴露面 vs 渲染层实际使用 ----------
const exposed = new Map(); // 'ns.method' -> channel
const nsBlocks = [...preload.matchAll(/^  (\w+):\s*\{$/gm)].map((m) => m[1]);
nsBlocks.forEach((ns) => {
  const start = preload.indexOf('  ' + ns + ': {');
  const rest = preload.slice(start + 1);
  const nextIdx = rest.search(/\n  \w+: \{/);
  const block = nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
  [...block.matchAll(/^\s{4}(\w+):\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*ipcRenderer\.(invoke|send)\('([^']+)'/gm)]
    .forEach((m) => exposed.set(ns + '.' + m[1], m[4] + ' [' + m[3] + ']'));
});
// 事件订阅（on/off）单独统计，不算「未使用」的 invoke 接口
const eventApi = new Set();
[...preload.matchAll(/^\s{4}(on\w*|off\w*):\s*\(/gm)].forEach((m) => eventApi.add(m[1]));

const usedByRenderer = new Set([...app.matchAll(/window\.api\.(\w+)\.(\w+)/g)].map((m) => m[1] + '.' + m[2]));
const unusedApi = [...exposed.keys()].filter((k) => !usedByRenderer.has(k) && !eventApi.has(k.split('.')[1]));
line('== 2) preload 暴露 ' + exposed.size + ' 个方法，渲染层用了 ' + usedByRenderer.size + ' 个 ==');
line(unusedApi.length === 0 ? '  OK  没有「暴露了却没人用」的接口'
  : '  ⚠ 暴露但渲染层未使用: ' + unusedApi.map((k) => k + ' → ' + exposed.get(k)).join(', '));

// preload 有、但主进程没注册
const mainHandles = new Set([...main.matchAll(/ipcMain\.(?:handle|on)\('([^']+)'/g)].map((m) => m[1]));
const missingHandler = [...exposed.entries()].filter(([, ch]) => !mainHandles.has(ch.replace(/ \[.*\]$/, '')));
line(missingHandler.length === 0 ? '  OK  preload 的 channel 全部有主进程 handler'
  : '  ❌ 没有 handler: ' + missingHandler.map(([k, ch]) => k + ' → ' + ch).join(', '));

// ---------- 3) 主进程注册但 preload 不用（死 IPC）----------
const preloadChannels = new Set([...preload.matchAll(/ipcRenderer\.(?:invoke|send|on)\('([^']+)'/g)].map((m) => m[1]));
const deadIpc = [...mainHandles].filter((ch) => !preloadChannels.has(ch) && !/^updater:event$/.test(ch));
line('== 3) 主进程注册 ' + mainHandles.size + ' 个 channel ==');
line(deadIpc.length === 0 ? '  OK  没有死 IPC'
  : '  ⚠ 注册了但 preload 不用的 channel: ' + deadIpc.join(', '));

// ---------- 4) 截图 mock 是否覆盖渲染层用到的 channel ----------
// 只对 invoke 型要求 mock 覆盖：send 型（fire-and-forget）没有 handler 也不会报错，
// 但 invoke 型缺 mock 会直接弹 "No handler registered" —— 那正是 applications 那次事故的形态。
const mockHandles = new Set([...mock.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]));
[...mock.matchAll(/\bh\('([^']+)'/g)].forEach((m) => mockHandles.add(m[1]));
const mockOns = new Set([...mock.matchAll(/ipcMain\.on\('([^']+)'/g)].map((m) => m[1]));
const mockMissing = [];
[...usedByRenderer].forEach((c) => {
  const info = exposed.get(c);
  if (!info) return;
  const ch = info.replace(/ \[.*\]$/, '');
  if (/\[invoke\]/.test(info) && !mockHandles.has(ch)) mockMissing.push(c + ' → ' + ch);
  if (/\[send\]/.test(info) && !mockOns.has(ch) && !mockHandles.has(ch)) mockMissing.push(c + ' → ' + ch + '（send 型，mock 用 on 接）');
});
line('== 4) 截图 mock 覆盖 ==');
line(mockMissing.length === 0 ? '  OK  渲染层用到的 channel mock 都覆盖了'
  : '  ❌ mock 缺: ' + mockMissing.join(', '));

// ---------- 5) 定义了但没人引用的函数（可能是没做完的功能）----------
// 排除 onXXX 这类属性名（onmousedown/onchange），它们不是函数
const neverUsed = [...defined].filter((n) => {
  if (/^on[a-z]/.test(n)) return false;
  const uses = (app.match(new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\b', 'g')) || []).length;
  return uses <= 1;
});
line('== 5) 定义后似乎从未被引用的函数 ==');
line(neverUsed.length === 0 ? '  OK  没有孤儿函数' : '  ⚠ ' + neverUsed.join(', '));

line('');
line('审计结束（⚠ 需人工判断是否真问题，❌ 是明确缺陷）');
