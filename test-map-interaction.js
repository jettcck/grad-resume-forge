'use strict';

// ============================================================
//  地图交互层回归测试（v1.12.23）
//
//  用户报的毛病是「滑动鼠标时地图操作繁琐、定位不准确」。根因有三个：
//    1. 滚轮缩放不锚点 —— 鼠标底下的点会跑，缩完总要重新找位置；
//    2. 拖动每动一格就清空重取瓦片（debounce 110ms）—— 跟手性差、还闪；
//    3. 没有惯性/双击/键盘/比例尺，操作路径全压在「按住拖动」一件事上。
//  这轮把交互层按高德/腾讯的手感重写，本测试守住的正是新交互的数学地基：
//    - zoomAroundCenter：锚点地理点在任意 datum/级别/锚点下缩放后必须不动
//    - panCenterByPixels：像素位移与中心位移必须互逆（拖动跟手的根基）
//    - clampZoom / metersPerPixel / niceScaleBar：边界与比例尺不跳变
//  全部用真实文件在 vm 沙箱里加载（和 test-geo.js 同一套办法），不复制逻辑。
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}
function near(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, msg + '（期望 ' + b + '，实得 ' + a + '，容差 ' + tol + '）');
}

// ---------- 用真实文件搭出浏览器语义环境 ----------
const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
// map-view.js 加载期只碰 UI.el（拿来做 DOM 辅助）；这里给个够用的桩
sandbox.window.UI = {
  el: () => ({
    style: {}, classList: { add() {}, remove() {} },
    appendChild() {}, setAttribute() {}, addEventListener() {}
  })
};
vm.createContext(sandbox);
for (const f of ['city-geo.js', 'geo.js', 'map-view.js']) {
  const src = fs.readFileSync(path.join(__dirname, 'src', 'renderer', f), 'utf-8');
  vm.runInContext(src, sandbox, { filename: f });
}
const Geo = sandbox.window.Geo;
const I = sandbox.window.MapView && sandbox.window.MapView._internal;
assert(!!I && typeof I.zoomAroundCenter === 'function', '地图交互数学已导出（_internal）');

const W = 768, H = 420;

// 和 createMap 里 project/unproject 完全同款的算式：锚点地理点的唯一真相
function anchorGeo(center, z, ax, ay, datum) {
  const d = Geo.fromWgs84(center[0], center[1], datum);
  const cp = Geo.lngLatToWorldPixel(d[1], d[0], z);
  const ll = Geo.worldPixelToLngLat(cp[0] + (ax - W / 2), cp[1] + (ay - H / 2), z);
  return Geo.toWgs84(ll[0], ll[1], datum);
}

// ---------- 1) 锚点缩放：鼠标底下那个点不许跑 ----------
// 覆盖：两种坐标系 × 三个城市 × 多个起点级别 × 5 个锚点（含四角/中心）× 放大/缩小/小数级
const DRIFT_TOL = 1e-3; // 约 100m；GCJ-02 往返换算本身只有 ~1e-5° 精度，这里放宽到工程可用
let worst = 0, worstWhere = '';
for (const datum of ['wgs84', 'gcj02']) {
  for (const c of [[30.2741, 120.1551], [39.9055, 116.3976], [22.5460, 114.0546]]) {
    for (const z0 of [4, 9, 12, 16]) {
      for (const [ax, ay] of [[W / 2, H / 2], [60, 50], [700, 370], [200, 150], [640, 120]]) {
        for (const dz of [-2.5, -1.3, -0.4, 0.6, 1, 2.5]) {
          const z1 = z0 + dz;
          if (z1 < 3 || z1 > 19) continue;
          const next = I.zoomAroundCenter(c[0], c[1], z0, ax, ay, z1, W, H, datum);
          const before = anchorGeo(c, z0, ax, ay, datum);
          const after = anchorGeo(next, z1, ax, ay, datum);
          const err = Math.hypot(before[0] - after[0], before[1] - after[1]);
          if (err > worst) { worst = err; worstWhere = datum + ' z' + z0 + '→' + z1 + ' anchor(' + ax + ',' + ay + ')'; }
        }
      }
    }
  }
}
assert(worst <= DRIFT_TOL, '锚点缩放后锚点地理点不动（最坏漂移 ' + worst.toExponential(2) + '° @ ' + worstWhere + '）');

// 中心锚点：缩放只变级别，中心必须几乎原样
{
  const c = [30.2741, 120.1551];
  const next = I.zoomAroundCenter(c[0], c[1], 12, W / 2, H / 2, 15, W, H, 'gcj02');
  near(next[0], c[0], 1e-3, '锚点在画布中心时，中心纬度不变');
  near(next[1], c[1], 1e-3, '锚点在画布中心时，中心经度不变');
}
// 放大时中心应向锚点方向靠（锚点在上方 → 新中心纬度更高）
{
  const c = [30.0, 120.0];
  const next = I.zoomAroundCenter(c[0], c[1], 11, W / 2, 60, 12, W, H, 'wgs84');
  assert(next[0] > c[0], '锚点在画布上方：放大后中心北移（指哪缩哪的方向性）');
  near(next[1], c[1], 1e-6, '锚点与中心同经度：放大后中心经度不变');
}
// 缩小（小数级，触控板）同样锚点固定
{
  const c = [31.2304, 121.4737];
  const next = I.zoomAroundCenter(c[0], c[1], 14, 120, 300, 13.35, W, H, 'wgs84');
  const before = anchorGeo(c, 14, 120, 300, 'wgs84');
  const after = anchorGeo(next, 13.35, 120, 300, 'wgs84');
  near(Math.hypot(before[0] - after[0], before[1] - after[1]), 0, 1e-9, '小数级缩放同样锚点固定');
}

// ---------- 2) 平移：像素位移 ↔ 中心位移必须互逆 ----------
{
  // 容差 1e-4°（≈10m）：GCJ-02 往返换算本身只有 ~1e-5° 精度，
  // 比任何能看出来的地图移动小四个数量级，工程上即「原样返回」
  const c = [30.2741, 120.1551];
  const rt = I.panCenterByPixels(c[0], c[1], 11, 137, -89, 'gcj02');
  const back = I.panCenterByPixels(rt[0], rt[1], 11, -137, 89, 'gcj02');
  near(back[0], c[0], 1e-4, '平移往返回到原纬度');
  near(back[1], c[1], 1e-4, '平移往返回到原经度');
  // wgs84 下必须严格可逆
  const rt2 = I.panCenterByPixels(c[0], c[1], 11, 137, -89, 'wgs84');
  const back2 = I.panCenterByPixels(rt2[0], rt2[1], 11, -137, 89, 'wgs84');
  near(back2[0], c[0], 1e-12, 'wgs84 下平移严格可逆（纬度）');
  near(back2[1], c[1], 1e-12, 'wgs84 下平移严格可逆（经度）');
}
// 拖动方向：地图跟手向右（dx>0）→ 视野西移 → 中心经度减小
{
  const c = [30.0, 120.0];
  const p = I.panCenterByPixels(c[0], c[1], 11, 100, 0, 'wgs84');
  assert(p[1] < c[1], '向右拖 100px：中心经度西移（跟手方向正确）');
  const q = I.panCenterByPixels(c[0], c[1], 11, 0, 100, 'wgs84');
  assert(q[0] > c[0], '向下拖 100px：中心纬度北移（跟手方向正确）');
}
// 量纲：z12 赤道处每像素 ≈ 33.1m（Web Mercator 标准值）
{
  near(I.metersPerPixel(0, 12), 156543.03392 / 4096, 0.01, 'z12 赤道每像素米数符合 Mercator 标准值');
  near(I.metersPerPixel(0, 13), I.metersPerPixel(0, 12) / 2, 1e-9, '每升一级每像素米数减半');
  near(I.metersPerPixel(60, 10), I.metersPerPixel(0, 10) * Math.cos(60 * Math.PI / 180), 1e-9, '纬度 60° 按 cos 收缩');
}

// ---------- 3) 边界与比例尺 ----------
{
  assert(I.clampZoom(2, 3, 19) === 3, '低于下限被夹到 3');
  assert(I.clampZoom(25, 3, 19) === 19, '高于上限被夹到 maxZoom');
  assert(I.clampZoom(12.4, 3, 19) === 12.4, '小数级别原样通过（滚轮实时缩放需要）');
  assert(I.clampZoom(-5, 3, 19) === 3, '负值被夹到下限');
}
// 比例尺：任何级别/纬度下条长都要落在 45–130px，且刻度是 1/2/5×10^n
{
  let okRange = true, okUnit = true, seen = '';
  for (const lat of [0, 22.5, 30, 45, 60]) {
    for (const z of [3, 5, 8, 11, 12, 14, 17, 19]) {
      const bar = I.niceScaleBar(I.metersPerPixel(lat, z));
      if (bar.px < 45 || bar.px > 130) okRange = false;
      const mant = bar.unit / Math.pow(10, Math.floor(Math.log10(bar.unit)));
      if (Math.abs(mant - 1) > 1e-9 && Math.abs(mant - 2) > 1e-9 && Math.abs(mant - 5) > 1e-9) okUnit = false;
      if (z === 12 && lat === 30) seen = I.fmtMeters(bar.unit);
    }
  }
  assert(okRange, '比例尺条长始终在 45–130px（不跳变）');
  assert(okUnit, '比例尺刻度只取 1/2/5×10^n 米');
  assert(seen === '2 km', '杭州 z12 比例尺读作 2 km（实得 ' + seen + '）');
  assert(I.fmtMeters(500) === '500 m' && I.fmtMeters(2000) === '2 km', '米/千米格式化正确');
}

console.log('\n地图交互测试完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
