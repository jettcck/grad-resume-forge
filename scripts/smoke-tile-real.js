'use strict';

// ============================================================
//  瓦片代理真实网络冒烟（需要联网；不依赖真实平台、不需要登录）
//
//  背景：用户实机反馈「地图乌漆嘛黑」。根因是腾讯瓦片服务把 content-type
//  标成 application/octet-stream（内容是合法 JPEG），tile-proxy 只认 header，
//  把真瓦片全拒。修复改为按字节魔数判定格式，并补回高德内置源。
//
//  本脚本用 Electron 的网络栈（与打包版应用同一条路径）直接打 fetchTile：
//    - 每个内置源各取一块真实瓦片，打印 http 结果 / 嗅探出的 mime / 字节数
//    - 断言腾讯源不再被「不是图片」拒掉（修复的核心回归）
//    - 顺带验证磁盘缓存命中后 mime 依旧正确
//
//  用法：electron scripts/smoke-tile-real.js --no-sandbox --disable-gpu
// ============================================================

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const T = require(path.join(__dirname, '..', 'dist', 'main', 'tile-proxy.js'));

const log = (...a) => console.log('[tile-smoke]', ...a);
let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; log('✅ PASS:', msg); }
  else { failCnt++; log('❌ FAIL:', msg); process.exitCode = 1; }
}

app.commandLine.appendSwitch('enable-unsafe-swiftshader');

app.whenReady().then(async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-tile-real-'));
  log('内置源: ' + T.BUILTIN_TILE_SOURCES.map((s) => s.id).join(', '));

  for (const src of T.BUILTIN_TILE_SOURCES) {
    // 北京天安门附近 z=12 的一块瓦片（各源坐标系不同无所谓，这里只验证取回与判定）
    const r = await T.fetchTile({ source: src, z: 12, x: 3394, y: 1553, cacheDir, timeoutMs: 15000 });
    if (r.ok) {
      const mime = String(r.dataUrl).slice(5, String(r.dataUrl).indexOf(';'));
      log(src.id + ' => ok bytes=' + r.bytes + ' mime=' + mime + ' cached=' + r.cached);
      assert(r.bytes > 500 && r.bytes <= T.MAX_TILE_BYTES, src.id + ' 取回真实瓦片（' + r.bytes + ' 字节）');
      assert(/^data:image\/(png|jpeg|webp|gif|bmp);base64,/.test(r.dataUrl),
        src.id + ' data URL 的 mime 是嗅探出的图片格式（' + mime + '）');
    } else {
      log(src.id + ' => FAILED: ' + r.error);
      assert(false, src.id + ' 取瓦片失败：' + r.error + '（网络不通时如实失败，不算回归）');
    }
  }

  // 腾讯源专项回归：它的 content-type 是 octet-stream，老实现在这一步就全拒了
  const tencent = T.BUILTIN_TILE_SOURCES.find((s) => s.id === 'tencent');
  const again = await T.fetchTile({ source: tencent, z: 12, x: 3394, y: 1553, cacheDir, timeoutMs: 15000 });
  assert(again.ok && again.cached === true, '同一块瓦片第二次命中磁盘缓存（不再联网）');
  assert(String(again.dataUrl).indexOf('data:image/jpeg;base64,') === 0,
    '腾讯 octet-stream 瓦片走完整链路后仍是 image/jpeg（修复前这里是「返回内容不是图片」）');

  try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
  log('完成: ' + pass + ' passed, ' + failCnt + ' failed');
  app.exit(failCnt === 0 ? 0 : 1);
});
