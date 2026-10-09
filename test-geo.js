'use strict';

// ============================================================
//  「投递地点与距离」回归测试
//
//  这里守的是几件很容易「看起来对、其实错」的事：
//    1. 大圆距离是否真的算对（拿已知城际距离当基准，误差 >2% 就该报）
//    2. 位置文本解析：招聘平台上抄下来的写法五花八门，解析错了距离就全错
//    3. 坐标系换算：WGS-84 ⇄ GCJ-02 往返必须回到原点（差 0.5km 肉眼在瓦片上能看出来）
//    4. 瓦片投影往返一致，且纬度上限（85.05°）不崩
//  纯本地计算，不联网、不依赖 Electron。
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

// ---------- 用真实文件搭出浏览器环境（不是复制一份逻辑）----------
const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
for (const f of ['city-geo.js', 'geo.js']) {
  const src = fs.readFileSync(path.join(__dirname, 'src', 'renderer', f), 'utf-8');
  vm.runInContext(src, sandbox, { filename: f });
}
const Geo = sandbox.window.Geo;
const CityGeo = sandbox.window.CityGeo;

assert(!!Geo && !!CityGeo, '两个模块都能在浏览器语义下加载并挂在 window 上');
const tableSize = Object.keys(CityGeo.table).length;
assert(tableSize > 3000, '坐标表体量合理（实得 ' + tableSize + ' 条）');
assert(typeof Geo.parseLocation === 'function' && typeof Geo.haversineKm === 'function', '导出解析与距离函数');

// ---------- 1) 距离：与已知城际直线距离比对 ----------
const D = {
  北京: [39.9055, 116.3976], 上海: [31.2304, 121.4737], 广州: [23.1291, 113.2644],
  深圳: [22.5460, 114.0546], 杭州: [30.2741, 120.1551], 成都: [30.6570, 104.0657]
};
// 权威直线距离（km，四舍五入到个位；来源：常见大圆距离计算，允许 2% 误差）
const CASES = [
  ['北京', '上海', 1067], ['北京', '广州', 1888], ['上海', '广州', 1213],
  ['广州', '深圳', 104], ['杭州', '上海', 163], ['成都', '北京', 1524]
];
CASES.forEach(([a, b, want]) => {
  const got = Geo.haversineKm(D[a], D[b]);
  const err = Math.abs(got - want) / want;
  assert(err < 0.02, a + '→' + b + ' 直线距离 ≈ ' + want + 'km（实得 ' + got.toFixed(0) + 'km，偏差 ' + (err * 100).toFixed(1) + '%）');
});
assert(Geo.haversineKm([0, 0], [0, 0]) === 0, '同一点距离为 0');
assert(!isFinite(Geo.haversineKm(null, [1, 2])), '缺参数返回 NaN 而不是 0（否则会被当成「同城」）');
assert(!isFinite(Geo.haversineKm([NaN, 1], [1, 2])), '非法坐标返回 NaN');
// 对跖点附近：赤道半圈 ≈ 20015km，验证不会因浮点溢出变成 NaN
const half = Geo.haversineKm([0, 0], [0, 180]);
assert(isFinite(half) && Math.abs(half - 20015) < 30, '赤道半圈 ≈ 20015km（实得 ' + half.toFixed(0) + '），未溢出');

// ---------- 2) 距离展示与分档 ----------
assert(Geo.formatDistance(0.82) === '820 m', '1km 以内用米（实得 ' + Geo.formatDistance(0.82) + '）');
assert(Geo.formatDistance(9.87) === '9.9 km', '1–10km 保留一位小数（实得 ' + Geo.formatDistance(9.87) + '）');
assert(Geo.formatDistance(12.34) === '12 km', '10km 以上取整，不假精确（实得 ' + Geo.formatDistance(12.34) + '）');
assert(Geo.formatDistance(1204) === '1.2 千公里', '超远距离不写成一长串数字（实得 ' + Geo.formatDistance(1204) + '）');
assert(Geo.formatDistance(NaN) === '—', '未定位显示占位符而不是 NaN');
assert(Geo.bandOf(3).key === 'very-close' && Geo.bandOf(60).key === 'far' && Geo.bandOf(9999).key === 'very-far', '距离分档边界正确');
assert(Geo.bandOf(NaN).key === 'unknown', '没坐标时分档为 unknown');

// ---------- 3) 位置文本解析 ----------
const P = [
  ['北京·朝阳区', '北京', '朝阳'],
  ['北京市朝阳区', '北京', '朝阳'],
  ['上海·浦东新区', '上海', '浦东'],
  ['上海市浦东新区', '上海', '浦东'],
  ['深圳 南山区', '深圳', '南山'],
  ['广东深圳南山区科技园', '深圳', '南山'],
  ['杭州', '杭州', null],
  ['杭州市', '杭州', null],
  ['成都市高新区', '成都', null],
  ['成都·武侯区', '成都', '武侯'],
  ['哈尔滨市松北区', '哈尔滨', '松北'],
  ['延边朝鲜族自治州', '延边朝鲜族', null],
  ['乌鲁木齐市天山区', '乌鲁木齐', '天山']
];
P.forEach(([text, city, dist]) => {
  const r = Geo.parseLocation(text);
  const ok = r && r.cityKey === city && (dist ? r.districtKey === dist : !r.districtKey);
  assert(ok, '解析「' + text + '」→ ' + (r ? r.cityKey + (r.districtKey ? '|' + r.districtKey : '') : 'null') +
    '（期望 ' + city + (dist ? '|' + dist : '') + '）');
});
assert(Geo.parseLocation('') === null && Geo.parseLocation(null) === null, '空输入返回 null 而不是乱猜');
assert(Geo.parseLocation('某个不存在的城市') === null, '认不出就返回 null（由界面提示手填，不硬猜）');
assert(Geo.parseLocation('公司地址不详') === null, '无关文本不返回坐标');
// 子串误判防守：不能把「吉林市」的坐标安到「吉林省」这种模糊输入上，也不能互相抢
const jl = Geo.parseLocation('吉林市');
assert(jl && jl.cityKey === '吉林', '「吉林市」解析到吉林（省级与市级同名时不崩）');
const hn = Geo.parseLocation('海南藏族自治州');
assert(hn && hn.cityKey === '海南藏族', '「海南藏族自治州」不被「海南」误抢（长键优先）');

// 区级比城市级更准：同一城市下，指定区县必须和城市中心不同
const c = Geo.parseLocation('杭州');
const d = Geo.parseLocation('杭州·西湖区');
assert(c && d && d.level === 'district' && c.level === 'city', '区分城市级/区县级标注');
assert(Geo.haversineKm(c.coords, d.coords) > 1, '区级坐标确实比城市中心精确（相差 ' + Geo.haversineKm(c.coords, d.coords).toFixed(1) + 'km）');

// ---------- 4) 坐标系换算 ----------
const BJ = [39.9055, 116.3976];
const gcj = Geo.wgs84ToGcj02(BJ[0], BJ[1]);
const back = Geo.gcj02ToWgs84(gcj[0], gcj[1]);
assert(Math.abs(back[0] - BJ[0]) < 0.00001 && Math.abs(back[1] - BJ[1]) < 0.00001,
  'WGS-84 → GCJ-02 → WGS-84 往返回到原点（残差 ' + (Geo.haversineKm(back, BJ) * 1000).toFixed(1) + 'm）');
const shift = Geo.haversineKm(BJ, gcj);
assert(shift > 0.3 && shift < 1.0, '北京一带 GCJ-02 偏移量级 0.3–1km（实得 ' + (shift * 1000).toFixed(0) + 'm），符合已知特征');
// 境外不偏移（用香港当参照，香港不使用 GCJ-02）
const HK = [22.3193, 114.1694];
assert(Geo.haversineKm(HK, Geo.wgs84ToGcj02(HK[0], HK[1])) === 0, '境外坐标不做 GCJ-02 偏移');
// 港澳台在地理包围盒内但官方制图用 WGS-84：若照搬「在中国境内就偏移」会平白加 555m
assert(Geo.needsGcjOffset(39.9, 116.4) === true, '大陆坐标需要 GCJ-02 偏移');
assert(Geo.needsGcjOffset(22.3193, 114.1694) === false, '香港不施加 GCJ-02 偏移（否则瓦片上偏 500m）');
assert(Geo.needsGcjOffset(22.1987, 113.5439) === false, '澳门不施加 GCJ-02 偏移');
assert(Geo.needsGcjOffset(25.0330, 121.5654) === false, '台湾不施加 GCJ-02 偏移');
assert(Geo.needsGcjOffset(39.9, 200) === false, '经度越界一律不偏移');
assert(Geo.toWgs84(39.9, 116.4, 'wgs84')[0] === 39.9, 'toWgs84 对 wgs84 声明原样返回');
assert(Math.abs(Geo.toWgs84(gcj[0], gcj[1], 'gcj02')[0] - BJ[0]) < 0.00001, 'toWgs84 按 gcj02 声明正确换算');

// ---------- 5) 瓦片投影 ----------
const ll = [39.9055, 116.3976];
for (const z of [0, 5, 10, 15, 18]) {
  const px = Geo.lngLatToWorldPixel(ll[1], ll[0], z);
  const rt = Geo.worldPixelToLngLat(px[0], px[1], z);
  assert(Math.abs(rt[0] - ll[0]) < 1e-6 && Math.abs(rt[1] - ll[1]) < 1e-6, 'z=' + z + ' 经纬度 → 世界像素 → 经纬度 往返一致');
}
const p0 = Geo.lngLatToWorldPixel(0, 0, 0);
assert(Math.abs(p0[0] - 128) < 1e-6 && Math.abs(p0[1] - 128) < 1e-6, 'z=0 时 (0,0) 落在 256px 瓦片正中心');
const north = Geo.worldPixelToLngLat(0, 0, 1);
assert(north[0] > 85 && north[0] <= 85.06, '纬度上限符合 Web Mercator（实得 ' + north[0].toFixed(3) + '°），不产生 NaN');

// ---------- 6) 补全候选 ----------
const sug = Geo.suggestCity('杭', 5);
assert(sug.indexOf('杭州') >= 0, '城市补全能命中「杭」→ 杭州');
const sug2 = Geo.suggestCity('', 5);
assert(sug2.length === 5, '空输入给出固定条数候选，不一次性倒出几百条');

console.log('\n地点与距离自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
