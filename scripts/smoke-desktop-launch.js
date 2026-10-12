'use strict';
// 启动桌面部署版（真实打包产物）做冒烟：确认能起来、能开出窗口、能读回 DOM。
const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EXE = 'C:/Users/王锦楠/Desktop/grad-resume-forge/简历锻造炉.exe';
const PORT = 9377;
const log = (...a) => console.log('[desktop]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(p) {
  return new Promise((res, rej) => {
    const rq = http.get({ host: '127.0.0.1', port: PORT, path: p }, (rs) => {
      let b = ''; rs.on('data', (c) => { b += c; }); rs.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    });
    rq.on('error', rej); rq.setTimeout(3000, () => rq.destroy(new Error('timeout')));
  });
}

function cdpEval(wsUrl, expr) {
  return new Promise((res, rej) => {
    const u = new URL(wsUrl);
    const key = crypto.randomBytes(16).toString('base64');
    const rq = http.request({
      host: u.hostname, port: u.port, path: u.pathname + (u.search || ''),
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key }
    });
    let done = false;
    const fin = (f, a) => { if (!done) { done = true; f(a); } };
    rq.on('upgrade', (rs, sk) => {
      const send = (o) => {
        const d = Buffer.from(JSON.stringify(o)); const L = d.length;
        let h;
        if (L < 126) h = Buffer.from([0x81, (0x80 | L) & 0xFF]);
        else if (L < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xFE; h.writeUInt16BE(L, 2); }
        else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0xFF; h.writeBigUInt64BE(BigInt(L), 2); }
        const m = Buffer.from([5, 6, 7, 8]); const md = Buffer.alloc(L);
        for (let i = 0; i < L; i += 1) md[i] = d[i] ^ m[i % 4];
        sk.write(Buffer.concat([h, m, md]));
      };
      let buf = Buffer.alloc(0);
      sk.on('data', (c) => {
        buf = Buffer.concat([buf, c]);
        if (buf.length < 2) return;
        let L = buf[1] & 0x7F; let off = 2;
        if (L === 126) { L = buf.readUInt16BE(2); off = 4; }
        else if (L === 127) { L = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + L) return;
        try { const msg = JSON.parse(buf.slice(off, off + L).toString('utf8')); if (msg.id === 1) { sk.end(); fin(res, msg); } } catch (_) {}
      });
      sk.on('error', () => fin(rej, new Error('socket')));
      send({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } });
      setTimeout(() => { try { sk.end(); } catch (_) {} fin(rej, new Error('ws timeout')); }, 8000);
    });
    rq.on('error', (e) => fin(rej, e));
    rq.end();
  });
}

(async () => {
  if (!fs.existsSync(EXE)) { log('FAIL: 找不到可执行文件', EXE); process.exit(1); }
  // Electron 43+ 要求 Chromium 开关放在 `--` 之后，否则会被当成非法参数直接退出
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // 不删掉它，exe 会退化成普通 Node，把参数当脚本路径
  const child = spawn(EXE, ['--', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=' + PORT], {
    cwd: path.dirname(EXE), env, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (d) => log('out>', String(d).trim().slice(0, 160)));
  child.stderr.on('data', (d) => log('err>', String(d).trim().slice(0, 160)));

  let ready = false;
  for (let i = 0; i < 60; i += 1) { try { await httpJson('/json/version'); ready = true; break; } catch (_) { await wait(500); } }
  log('devtools ready =', ready);
  if (!ready) { child.kill(); log('FAIL: 应用没有起来'); process.exit(1); }

  await wait(5000);
  const list = await httpJson('/json/list');
  const page = list.find((t) => t.type === 'page');
  log('window title:', page && page.title);
  if (!page) { child.kill(); log('FAIL: 没有窗口'); process.exit(1); }

  const r = await cdpEval(page.webSocketDebuggerUrl, 'JSON.stringify({t:document.title,ready:document.readyState,len:(document.body?document.body.innerText.length:-1)})');
  const v = r && r.result && r.result.result && r.result.result.value;
  log('DOM:', v);
  const ok = v && /简历锻造炉/.test(v) && /"len":[1-9]/.test(v);
  log(ok ? 'PASS: 桌面部署版启动正常，窗口有内容' : 'FAIL: 窗口内容异常');
  child.kill();
  await wait(800);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('[desktop] fatal:', e && e.message); process.exit(2); });
