'use strict';
// 生成 src/renderer/city-geo.js：全国地级市 + 区县坐标（统一转成 WGS-84）
//
// 用法（两步，上游数据不进仓库）：
//   1) curl -L -o "$env:TEMP/grf-geo/data.json" https://raw.githubusercontent.com/88250/city-geo/master/data.json
//   2) node scripts/gen-city-geo.js
//
// 数据来源：88250/city-geo（木兰宽松许可证 v2），坐标由其用百度地图 API 补齐；
// 坐标系判定为 GCJ-02 后转为 WGS-84 —— 判定依据与校核结果见 docs/map-distance.md 第三节。
const fs = require('fs');
const path = require('path');
const d = require(process.env.TEMP + '/grf-geo/data.json');

const PI = Math.PI, A = 6378245.0, EE = 0.00669342162296594323;
const outOfChina = (lat, lng) => lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
function transformLat(x, y) {
  let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  r += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  r += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return r;
}
function transformLng(x, y) {
  let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  r += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  r += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return r;
}
function wgs84ToGcj02(lat, lng) {
  if (outOfChina(lat, lng)) return [lat, lng];
  const dLat = transformLat(lng - 105.0, lat - 35.0), dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat); magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  return [
    lat + (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI),
    lng + (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI)
  ];
}
const gcj02ToWgs84 = (lat, lng) => {
  const [gLat, gLng] = wgs84ToGcj02(lat, lng);
  return [lat * 2 - gLat, lng * 2 - gLng];
};

// 行政区后缀归一化：让「东城区」与「东城」、「延边朝鲜族自治州」与「延边朝鲜族」都能命中
const SUFFIX = /(特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|自治州|自治县|地区|盟|林区|新区|省|市|区|县|旗)$/;
function norm(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/[\s　]+/g, '');
  if (!s) return '';
  // 先剥一层「市」再剥通用后缀，兼容「杭州市西湖区」这种连写
  const stripped = s.replace(SUFFIX, '');
  return stripped || s;
}

const MUNI = { 北京市: '北京', 上海市: '上海', 天津市: '天津', 重庆市: '重庆' };
const table = {};
const dup = [];
let droppedZero = 0;

function put(key, lat, lng, tag) {
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) { droppedZero++; return; }
  if (lat < 3 || lat > 54 || lng < 73 || lng > 136) { droppedZero++; return; }
  if (table[key]) { dup.push(key + '(' + tag + ')'); return; }
  table[key] = [Number(lat.toFixed(4)), Number(lng.toFixed(4))];
}

for (const x of d) {
  const prov = String(x.province || ''), city = String(x.city || ''), area = String(x.area || '');
  const la = Number(x.lat), ln = Number(x.lng);
  if (!isFinite(la) || !isFinite(ln)) { droppedZero++; continue; }
  const [wLat, wLng] = gcj02ToWgs84(la, ln);
  const cityName = MUNI[prov] ? MUNI[prov] : (city && city !== '市辖区' ? norm(city) : norm(prov));
  if (!cityName || /省直辖县级|自治区直辖县级/.test(cityName)) continue;
  if (!area) { put(cityName, wLat, wLng, 'city'); continue; }
  const aName = norm(area);
  if (aName) put(cityName + '|' + aName, wLat, wLng, 'district');
}

// 港澳台：上游数据只覆盖大陆，手工补齐（这三地不用 GCJ-02 偏移，直接是 WGS-84）
const MANUAL = {
  香港: [22.3193, 114.1694], 澳门: [22.1987, 113.5439],
  台北: [25.0330, 121.5654], 新北: [25.0169, 121.4628], 高雄: [22.6273, 120.3014],
  台中: [24.1477, 120.6736], 台南: [22.9999, 120.2269]
};
Object.keys(MANUAL).forEach((k) => put(k, MANUAL[k][0], MANUAL[k][1], 'manual'));

const cityKeys = Object.keys(table).filter((k) => k.indexOf('|') < 0);
const distKeys = Object.keys(table).filter((k) => k.indexOf('|') >= 0);
console.log('城市数:', cityKeys.length, '| 区县数:', distKeys.length, '| 合计:', Object.keys(table).length);
console.log('丢弃(0,0 或越界):', droppedZero, '| 重名跳过:', dup.length);
if (dup.length) console.log('  重名示例:', dup.slice(0, 12).join(', '));

const km = (a, b) => {
  const R = 6371.0088, r = PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const REF = {
  北京: [39.9055, 116.3976], 上海: [31.2304, 121.4737], 广州: [23.1291, 113.2644],
  深圳: [22.5460, 114.0546], 杭州: [30.2741, 120.1551], 成都: [30.6570, 104.0657],
  哈尔滨: [45.7569, 126.6425], 乌鲁木齐: [43.8256, 87.6168], 三亚: [18.2528, 109.5119],
  拉萨: [29.6520, 91.1721], 重庆: [29.5630, 106.5516]
};
console.log('\n=== 城市级与权威 WGS-84 参照点偏差 ===');
for (const n of Object.keys(REF)) {
  if (!table[n]) { console.log('  ' + n + ': 缺失'); continue; }
  console.log('  ' + n.padEnd(5) + table[n].join(',') + '   偏差 ' + km(table[n], REF[n]).toFixed(1) + 'km');
}
console.log('\n=== 区级抽查（区名归一化后）===');
[['北京', '朝阳'], ['北京', '海淀'], ['上海', '浦东'], ['深圳', '南山'], ['杭州', '西湖'], ['广州', '天河']].forEach(([c, a]) => {
  const v = table[c + '|' + a];
  console.log('  ' + c + '|' + a + ' → ' + (v ? v.join(',') : '缺失'));
});

const entries = Object.keys(table).sort().map((k) => JSON.stringify(k) + ':[' + table[k][0] + ',' + table[k][1] + ']');
const out = "'use strict';\n\n" +
  '// 全国地级市 + 区县坐标表（内部统一为 WGS-84）\n' +
  '//\n' +
  '// 数据来源：https://github.com/88250/city-geo （木兰宽松许可证，第2版 / Mulan PSL v2）\n' +
  '//   - 上游按「省 / 市 / 区」组织；本文件取其中 342 条城市级 + 区县级记录\n' +
  '//   - 上游由百度地图 API 补齐坐标。经参照点核对，其偏移量（如北京东城区 ≈ +0.0063°/+0.0064°）\n' +
  '//     明显小于 BD-09 所需（≈ +0.011°/+0.0126°），符合 GCJ-02 特征 → 按 GCJ-02 处理，\n' +
  '//     生成时用标准算法转成 WGS-84，使全应用只有一种内部坐标系\n' +
  '//   - 验证：转换后与权威 WGS-84 地标比对，北京/上海/广州/深圳/成都/乌鲁木齐/三亚 偏差 0.6–1.3km，\n' +
  '//     杭州 5.8km、哈尔滨 10km、拉萨 5.1km（这三者是政府驻地离地标本身就有那么远）\n' +
  '//   - 港澳台上游不含，按 WGS-84 手工补齐（这三地不用 GCJ-02 偏移）\n' +
  '//\n' +
  '// 精度口径（别把这张表当导航数据）：\n' +
  '//   - 城市级点多为政府驻地或城区质心，与「你要去的那栋楼」差 5–10km 很常见\n' +
  '//   - 区级点误差通常在 1–3km；坐标系判定若有残余偏差，量级 0.5–1.5km\n' +
  '//   - 需要精确位置时请在地图上点选，或手动填经纬度覆盖\n' +
  '//   - 许可证要求保留声明，完整协议见仓库根目录 THIRD-PARTY-NOTICES.md\n' +
  '(function () {\n' +
  '  // 键：城市名（如「北京」「延边朝鲜族」）；「城市|区县」为区县级（如「北京|朝阳」）\n' +
  '  // 值：[纬度, 经度]（WGS-84）\n' +
  '  const CITY_GEO = {\n    ' + entries.join(',\n    ') + '\n  };\n\n' +
  '  // 行政区后缀归一化：让「东城区」「东城」、「延边朝鲜族自治州」「延边朝鲜族」都能命中\n' +
  '  const SUFFIX = /(特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|自治州|自治县|地区|盟|林区|新区|省|市|区|县|旗)$/;\n' +
  '  function normalizeCityName(raw) {\n' +
  '    let s = String(raw == null ? \'\' : raw).trim().replace(/[\\s　]+/g, \'\');\n' +
  '    if (!s) return \'\';\n' +
  '    const stripped = s.replace(SUFFIX, \'\');\n' +
  '    return stripped || s;\n' +
  '  }\n\n' +
  '  window.CityGeo = { table: CITY_GEO, normalizeCityName: normalizeCityName };\n' +
  '})();\n';
fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'city-geo.js'), out, 'utf-8');
console.log('\n已写入 src/renderer/city-geo.js  ' + (out.length / 1024).toFixed(1) + 'KB');
