'use strict';

// ============================================================
//  契约自测：渲染层 ↔ preload ↔ 主进程 handler ↔ 截图 mock 是否对得上
//
//  为什么需要它：投递看板的 applications:save / applications:delete 曾经
//  「preload 暴露了、主进程没注册」——真实应用里存投递直接报
//  No handler registered，看板实际只读；而 store 测试直接调函数、
//  截图 mock 又把它注册了，两条测试路径都绕过了这个缺口，谁也没发现。
//  这一层静态契约检查就是用来堵这类漏洞的。
// ============================================================
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

const appSrc = R('src/renderer/app.js');
const preloadSrc = R('src/main/preload.ts');
const mainSrc = R('src/main/main.ts');
const mockSrc = R('scripts/screenshot.js');
const iconsSrc = R('src/renderer/icons.js');
const htmlSrc = R('src/renderer/index.html');

// ---------- 1) preload 暴露面 ----------
const nsBlocks = [...preloadSrc.matchAll(/^  (\w+):\s*\{$/gm)].map((m) => m[1]);
const exposed = new Set();
nsBlocks.forEach((ns) => {
  const start = preloadSrc.indexOf('  ' + ns + ': {');
  const rest = preloadSrc.slice(start + 1);
  const nextIdx = rest.search(/\n  \w+: \{/);
  const block = nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
  [...block.matchAll(/^\s{4}(\w+):/gm)].forEach((m) => exposed.add(ns + '.' + m[1]));
});
assert(exposed.size > 30, 'preload 暴露 ' + exposed.size + ' 个方法');

// ---------- 2) 渲染层调用的接口都必须在 preload 里 ----------
const calls = new Set([...appSrc.matchAll(/window\.api\.(\w+)\.(\w+)\(/g)].map((m) => m[1] + '.' + m[2]));
const missingExpose = [...calls].filter((c) => !exposed.has(c));
assert(missingExpose.length === 0,
  '渲染层调用的接口都已暴露（缺：' + (missingExpose.join(', ') || '无') + '）');

// ---------- 3) preload 用的每个 channel 都必须在 main 注册 ----------
// 这是本次真正抓到 bug 的那一条
const preChannels = new Set([...preloadSrc.matchAll(/ipcRenderer\.(?:invoke|send)\('([^']+)'/g)].map((m) => m[1]));
const mainHandles = new Set([...mainSrc.matchAll(/ipcMain\.(?:handle|on)\('([^']+)'/g)].map((m) => m[1]));
const missingHandler = [...preChannels].filter((ch) => !mainHandles.has(ch));
assert(missingHandler.length === 0,
  'preload 用到的 ' + preChannels.size + ' 个 channel 全部已在主进程注册（缺：' + (missingHandler.join(', ') || '无') + '）');

// ---------- 4) 截图 mock 必须覆盖渲染层会用到的 channel ----------
// 否则 UI 测试会对「未注册的接口」视而不见（快照卡与 applications 两次都栽在这里）
const mockChannels = new Set([...mockSrc.matchAll(/\bh\('([^']+)'/g)].map((m) => m[1]));
const chanByApi = {};
[...preloadSrc.matchAll(/(\w+):\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\('([^']+)'/g)].forEach((m) => {
  chanByApi[m[1]] = m[2];
});
const mockMissing = [];
[...calls].forEach((c) => {
  const ch = chanByApi[c.split('.')[1]];
  if (ch && !mockChannels.has(ch)) mockMissing.push(c + ' → ' + ch);
});
assert(mockMissing.length === 0,
  '截图 mock 覆盖渲染层用到的 channel（缺：' + (mockMissing.join(', ') || '无') + '）');

// ---------- 5) 图标名必须存在 ----------
const pathsBlock = iconsSrc.slice(iconsSrc.indexOf('const PATHS'));
const iconNames = new Set([...pathsBlock.matchAll(/^\s{2}(\w+):\s*'/gm)].map((m) => m[1]));
const usedIcons = new Set([
  ...[...appSrc.matchAll(/ico\('(\w+)'/g)].map((m) => m[1]),
  ...[...appSrc.matchAll(/Icons\.icon\('(\w+)'/g)].map((m) => m[1])
]);
const missingIcons = [...usedIcons].filter((n) => !iconNames.has(n));
assert(missingIcons.length === 0,
  '渲染层用到的 ' + usedIcons.size + ' 个图标全部存在（缺：' + (missingIcons.join(', ') || '无') + '）');

// ---------- 6) 顶层重复声明（向后追加代码最容易撞车）----------
const decls = {};
[...appSrc.matchAll(/^(?:function|const|let)\s+(\w+)/gm)].forEach((m) => {
  decls[m[1]] = (decls[m[1]] || 0) + 1;
});
const dups = Object.keys(decls).filter((k) => decls[k] > 1);
assert(dups.length === 0, 'app.js 无顶层重复声明（重复：' + (dups.join(', ') || '无') + '）');

// ---------- 7) 查询的 DOM id 必须存在（HTML 静态 或 JS 动态创建）----------
const idsInHtml = new Set([...htmlSrc.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const idsCreated = new Set([...appSrc.matchAll(/id:\s*'([\w-]+)'/g)].map((m) => m[1]));
const idsQueried = new Set([...appSrc.matchAll(/getElementById\('([\w-]+)'\)/g)].map((m) => m[1]));
const missingIds = [...idsQueried].filter((id) => !idsInHtml.has(id) && !idsCreated.has(id));
assert(missingIds.length === 0, '查询的 ' + idsQueried.size + ' 个 id 都存在（缺：' + (missingIds.join(', ') || '无') + '）');

// ---------- 8) 四个路由容器齐全（新增路由最容易漏 index.html 那一半）----------
['profile', 'resume', 'apps', 'interview'].forEach((r) => {
  assert(idsInHtml.has('route-' + r) && new RegExp('data-route="' + r + '"').test(htmlSrc),
    '路由 ' + r + ' 的容器与导航项都在 index.html');
});

console.log('\n契约自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
