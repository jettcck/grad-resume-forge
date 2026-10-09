'use strict';

// ============================================================
//  地图瓦片代理回归测试
//
//  这是本轮唯一新增的「能主动联网」的组件，所以重点不是「能不能取到瓦片」，
//  而是**不能取到什么**：
//    - 不能取 http://（明文）
//    - 不能取内网 / 回环 / 链路本地（含云元数据 169.254.169.254）
//    - 不能靠 302 跳转绕过上面两条（每一跳都要重新校验）
//    - 不能把非图片内容当瓦片塞给渲染层
//    - 不能无限缓存/无限体积
//  为了不依赖真实网络，全部用注入的 fetchImpl 跑。
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require(path.join(__dirname, 'dist/main/tile-proxy'));

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

// ---------- 1) 内网/回环拦截 ----------
const BLOCKED = ['localhost', '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.254',
  '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1',
  '::ffff:127.0.0.1', 'foo.local', 'x.internal', ''];
BLOCKED.forEach((h) => assert(T.isBlockedHost(h) === true, '拦截内网/保留主机：' + (h || '(空)')));
const ALLOWED = ['tile.openstreetmap.org', 'webrd01.is.autonavi.com', 'a.tile.example.com', '8.8.8.8', '1.1.1.1'];
ALLOWED.forEach((h) => assert(T.isBlockedHost(h) === false, '放行公网主机：' + h));
assert(T.isBlockedHost('172.15.0.1') === false && T.isBlockedHost('172.32.0.1') === false, '172.16/12 边界外不误拦');

// ---------- 2) 模板校验 ----------
assert(T.validateTemplate('https://tile.openstreetmap.org/{z}/{x}/{y}.png') === null, '合法 https 模板通过');
assert(/https/.test(T.validateTemplate('http://tile.openstreetmap.org/{z}/{x}/{y}.png')), '拒绝 http 模板');
assert(/内网|本机/.test(T.validateTemplate('https://127.0.0.1/{z}/{x}/{y}.png')), '拒绝指向本机的模板');
assert(/内网|本机/.test(T.validateTemplate('https://192.168.1.10/tiles/{z}/{x}/{y}.png')), '拒绝指向内网的模板');
assert(/缺少占位符/.test(T.validateTemplate('https://tile.example.com/{z}/{x}.png')), '缺 {y} 占位符被拒');
assert(/缺少占位符/.test(T.validateTemplate('这不是网址')), '缺占位符时先报缺占位符（检查顺序明确，不误导）');
assert(/合法/.test(T.validateTemplate('随便一段带占位符但不是网址{z}{x}{y}')), '带占位符但不是合法 URL 时被拒');
assert(T.validateTemplate('https://t.example.com/t?z={z}&x={x}&y={y}&key=abc') === null, '带查询参数的模板可用（自建服务常见）');

// ---------- 3) 瓦片坐标范围 ----------
assert(T.validateTileCoords(0, 0, 0) === null, 'z=0 的 (0,0) 合法');
assert(T.validateTileCoords(2, 3, 3) === null, 'z=2 的 (3,3) 合法（上界）');
assert(/超范围/.test(T.validateTileCoords(2, 4, 0)), 'z=2 时 x=4 越界被拒');
assert(/超范围/.test(T.validateTileCoords(-1, 0, 0)), '负的 z 被拒');
assert(/整数/.test(T.validateTileCoords(1.5, 0, 0)), '非整数被拒');
assert(/缩放级别/.test(T.validateTileCoords(19, 0, 0, 18)), '超过该源 maxZoom 被拒');
assert(/整数/.test(T.validateTileCoords('a', 0, 0)), '字符串坐标被拒（IPC 来的东西不能信）');

// ---------- 4) URL 组装 ----------
const amap = T.BUILTIN_TILE_SOURCES.find((s) => s.id === 'amap');
const osm = T.BUILTIN_TILE_SOURCES.find((s) => s.id === 'osm');
const u1 = T.buildTileUrl(osm, 10, 843, 388);
assert(u1 === 'https://tile.openstreetmap.org/10/843/388.png', 'OSM 模板替换正确（实得 ' + u1 + '）');
const u2 = T.buildTileUrl(amap, 12, 3400, 1600);
assert(/\{z\}|\{x\}|\{y\}|\{s\}/.test(u2) === false && u2.indexOf('z=12') > 0 && u2.indexOf('x=3400') > 0, '高德模板全部占位符都被替换（实得 ' + u2.slice(0, 80) + '…）');
assert(/webrd0[1-4]\./.test(u2), '高德子域被替换成 1–4 之一');

// ---------- 5) 抓取行为（注入 fetch）----------
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-tiles-'));
const mkResp = (opts) => ({
  ok: opts.ok !== false,
  status: opts.status || 200,
  headers: { get: (k) => (opts.headers || {})[k.toLowerCase()] || null },
  arrayBuffer: async () => opts.body || PNG
});

function countingFetch(resp) {
  const calls = [];
  const impl = async (url) => { calls.push(url); return typeof resp === 'function' ? resp(url, calls.length) : resp; };
  impl.calls = calls;
  return impl;
}

(async () => {
  // 正常取回 + 落缓存
  const f1 = countingFetch(mkResp({ headers: { 'content-type': 'image/png' } }));
  const r1 = await T.fetchTile({ source: osm, z: 10, x: 843, y: 388, cacheDir, fetchImpl: f1 });
  assert(r1.ok && r1.dataUrl.indexOf('data:image/png;base64,') === 0 && r1.cached === false, '首次请求成功并返回 data: URL');
  assert(f1.calls.length === 1, '首次请求只发一次网络请求');

  // 第二次命中缓存，不再联网
  const f2 = countingFetch(mkResp({ headers: { 'content-type': 'image/png' } }));
  const r2 = await T.fetchTile({ source: osm, z: 10, x: 843, y: 388, cacheDir, fetchImpl: f2 });
  assert(r2.ok && r2.cached === true && f2.calls.length === 0, '同一瓦片第二次直接命中磁盘缓存（0 次网络请求）');
  assert(T.tileCacheStats(cacheDir).files === 1, '缓存里确实落了 1 个文件');

  // 非图片内容
  const f3 = countingFetch(mkResp({ headers: { 'content-type': 'text/html' } }));
  const r3 = await T.fetchTile({ source: osm, z: 11, x: 1, y: 1, cacheDir, fetchImpl: f3 });
  assert(r3.ok === false && /不是图片/.test(r3.error), '非图片内容被拒（防止把登录页/JSON 当瓦片）');

  // 超大瓦片
  const f4 = countingFetch(mkResp({ headers: { 'content-type': 'image/png' }, body: Buffer.alloc(T.MAX_TILE_BYTES + 1, 1) }));
  const r4 = await T.fetchTile({ source: osm, z: 11, x: 2, y: 2, cacheDir, fetchImpl: f4 });
  assert(r4.ok === false && /过大/.test(r4.error), '超过体积上限的瓦片被拒');

  // HTTP 状态码
  const f5 = countingFetch(mkResp({ ok: false, status: 429, headers: {} }));
  const r5 = await T.fetchTile({ source: osm, z: 11, x: 3, y: 3, cacheDir, fetchImpl: f5 });
  assert(r5.ok === false && /429/.test(r5.error), '上游限流时如实报错（不静默返回空白图）');

  // 跳转到内网：必须拦下（这是本项目最该守住的一条）
  const f6 = countingFetch(mkResp({ status: 302, ok: false, headers: { location: 'https://169.254.169.254/latest/meta-data/' } }));
  const r6 = await T.fetchTile({ source: osm, z: 11, x: 4, y: 4, cacheDir, fetchImpl: f6 });
  assert(r6.ok === false && /内网|本机/.test(r6.error), '302 跳到云元数据地址被拦下（实得：' + r6.error + '）');

  // 跳转到 http：也必须拦下
  const f7 = countingFetch(mkResp({ status: 301, ok: false, headers: { location: 'http://tile.openstreetmap.org/11/5/5.png' } }));
  const r7 = await T.fetchTile({ source: osm, z: 11, x: 5, y: 5, cacheDir, fetchImpl: f7 });
  assert(r7.ok === false && /https/.test(r7.error), '302/301 降到 http 被拦下（实得：' + r7.error + '）');

  // 正常的同域跳转应当放行
  const f8 = countingFetch((url, n) => (n === 1
    ? mkResp({ status: 302, ok: false, headers: { location: 'https://tile.openstreetmap.org/11/6/6.png' } })
    : mkResp({ headers: { 'content-type': 'image/png' } })));
  const r8 = await T.fetchTile({ source: osm, z: 11, x: 6, y: 6, cacheDir, fetchImpl: f8 });
  assert(r8.ok === true && f8.calls.length === 2, '正常的 https 同域跳转可以跟随（2 次请求）');

  // 跳转次数上限
  const f9 = countingFetch(mkResp({ status: 302, ok: false, headers: { location: 'https://tile.openstreetmap.org/loop.png' } }));
  const r9 = await T.fetchTile({ source: osm, z: 11, x: 7, y: 7, cacheDir, fetchImpl: f9 });
  assert(r9.ok === false && /跳转次数/.test(r9.error), '无限跳转被打断（实得：' + r9.error + '）');

  // 超时
  const hang = async (url, init) => new Promise((_res, rej) => {
    init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
  });
  const r10 = await T.fetchTile({ source: osm, z: 11, x: 8, y: 8, cacheDir, fetchImpl: hang, timeoutMs: 60 });
  assert(r10.ok === false && /超时/.test(r10.error), '上游不响应时按时超时（实得：' + r10.error + '）');

  // 自定义模板也要过同一套校验
  const bad = T.validateTemplate('https://10.0.0.1/{z}/{x}/{y}.png');
  assert(bad !== null, '自定义模板指向内网直接不给保存');

  // 清缓存
  const before = T.tileCacheStats(cacheDir).files;
  const cleared = T.clearTileCache(cacheDir);
  assert(cleared === before && T.tileCacheStats(cacheDir).files === 0, '清空瓦片缓存可用（清掉 ' + cleared + ' 个）');

  try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
  console.log('\n地图瓦片代理自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
})();
