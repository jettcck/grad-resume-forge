'use strict';

// ============================================================
//  探针：file:// 源下 WebLLM 各缓存后端可用性
//  Cache API 在不透明源（file://）上 add() 报网络错误；
//  本探针实测 Cache / IndexedDB / OPFS 哪个能用。
//  运行：npx electron scripts/probe-storage.js --no-sandbox
// ============================================================
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PROBE_HTML = path.join(ROOT, 'src', 'renderer', 'probe-storage-tmp.html');

// CSP 取自真实 index.html
const indexHtml = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf-8');
const CSP = (indexHtml.match(/Content-Security-Policy[^>]*content="([^"]+)"/) || [])[1];

const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
</head><body>
<script>
(async () => {
  const out = (k, v) => console.log('[storage] ' + k + ' :: ' + v);
  out('origin', location.origin || '(opaque)');
  out('isSecureContext', window.isSecureContext);

  // 1) Cache API
  try {
    const c = await caches.open('grf-probe');
    out('cache-open', 'OK');
    try {
      await c.add('https://hf-mirror.com/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/main/mlc-chat-config.json');
      const hit = await c.match('https://hf-mirror.com/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/main/mlc-chat-config.json');
      out('cache-add', hit ? 'OK（跨域 URL 可入缓存）' : 'added but no match');
      await c.delete('https://hf-mirror.com/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/main/mlc-chat-config.json');
    } catch (e) { out('cache-add', 'ERR ' + (e && e.message)); }
  } catch (e) { out('cache-open', 'ERR ' + (e && e.message)); }

  // 2) IndexedDB
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('grf-probe', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(new Uint8Array([1,2,3,4]).buffer, 'probe.bin');
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    const got = await new Promise((res, rej) => {
      const tx = db.transaction('files', 'readonly');
      const q = tx.objectStore('files').get('probe.bin');
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
    out('indexeddb', (got && got.byteLength === 4) ? 'OK（ArrayBuffer 可存取）' : 'ERR roundtrip mismatch');
    indexedDB.deleteDatabase('grf-probe');
  } catch (e) { out('indexeddb', 'ERR ' + (e && e.message)); }

  // 3) OPFS
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('probe.bin', { create: true });
    const w = await fh.createWritable();
    await w.write(new Uint8Array([1,2,3,4]));
    await w.close();
    const f = await fh.getFile();
    out('opfs', (f.size === 4) ? 'OK（可读写文件）' : 'ERR size=' + f.size);
    await root.removeEntry('probe.bin');
  } catch (e) { out('opfs', 'ERR ' + (e && e.message)); }

  // 4) 直连 fetch（带跳转，验证 CSP 通了）
  try {
    const r = await fetch('https://hf-mirror.com/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/main/tokenizer.json', { headers: { Range: 'bytes=0-99' } });
    out('fetch-redirect', r.status + ' final=' + new URL(r.url).host);
    try { if (r.body) await r.body.cancel(); } catch (_) {} // eslint-disable-line no-empty
  } catch (e) { out('fetch-redirect', 'ERR ' + (e && e.message)); }

  out('done', 'storage probe complete');
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
    if (String(msg).includes('[storage]')) console.log(msg);
  });
  await win.loadFile(PROBE_HTML);
  setTimeout(() => {
    try { fs.unlinkSync(PROBE_HTML); } catch (_) { /* 忽略 */ }
    app.exit(0);
  }, 30000);
});
