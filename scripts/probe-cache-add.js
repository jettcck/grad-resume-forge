'use strict';

// ============================================================
//  探针：file:// 源下 Cache API 存大文件（65MB 分片）行不行
//  cache.add / cache.put / 配额估算 —— 定位 web-llm 下载失败的真因
//  运行：npx electron scripts/probe-cache-add.js --no-sandbox
// ============================================================
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PROBE_HTML = path.join(ROOT, 'src', 'renderer', 'probe-cacheadd-tmp.html');

const indexHtml = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf-8');
const CSP = (indexHtml.match(/Content-Security-Policy[^>]*content="([^"]+)"/) || [])[1];

const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
</head><body>
<script>
(async () => {
  const out = (k, v) => console.log('[cacheadd] ' + k + ' :: ' + v);
  const shard = 'https://hf-mirror.com/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/main/params_shard_0.bin';

  // 0) 配额
  try {
    const est = await navigator.storage.estimate();
    out('quota', 'usage=' + (est.usage/1048576).toFixed(1) + 'MB quota=' + ((est.quota||0)/1048576).toFixed(0) + 'MB');
  } catch (e) { out('quota', 'ERR ' + (e && e.message)); }

  // 1) cache.add（web-llm 的路径：全量 GET + 入缓存）
  try {
    const t0 = performance.now();
    const c = await caches.open('grf-add-probe');
    await c.add(shard);
    const hit = await c.match(shard);
    out('cache-add', hit ? 'OK ' + ((performance.now()-t0)/1000).toFixed(1) + 's' : 'added no match');
    await c.delete(shard);
  } catch (e) { out('cache-add', 'ERR ' + (e && e.message)); }

  // 2) cache.put（手动 fetch 后存——web-llm 的另一条路径）
  try {
    const t0 = performance.now();
    const r = await fetch(shard);
    const c2 = await caches.open('grf-put-probe');
    await c2.put(shard, r);
    const hit2 = await c2.match(shard);
    out('cache-put', hit2 ? 'OK ' + ((performance.now()-t0)/1000).toFixed(1) + 's size=' + (hit2.headers.get('content-length')||'?') : 'put no match');
    await c2.delete(shard);
  } catch (e) { out('cache-put', 'ERR ' + (e && e.message)); }

  out('done', 'cache-add probe complete');
})();
</script>
</body></html>`;

app.whenReady().then(async () => {
  fs.writeFileSync(PROBE_HTML, html);
  const win = new BrowserWindow({
    width: 900, height: 700, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  win.webContents.on('console-message', (_e, _lvl, msg) => {
    if (String(msg).includes('[cacheadd]')) console.log(msg);
  });
  await win.loadFile(PROBE_HTML);
  setTimeout(() => {
    try { fs.unlinkSync(PROBE_HTML); } catch (_) { /* 忽略 */ }
    app.exit(0);
  }, 300000);
});
