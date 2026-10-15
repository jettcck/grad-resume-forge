'use strict';

// ============================================================
//  生成 src/renderer/place-search.js：出发地搜索索引（离线）
//
//  数据来源（均在仓库内，随应用打包）：
//    data/schools_b.csv —— 全国高等学校名单（名称 + 所在地，木兰/公开数据）
//    省→省会映射 —— 本脚本内硬编码（34 条，用于「输入省名定位到省会」）
//
//  城市/区县坐标不在这里：运行时直接用 geo.js 的 parseLocation 查
//  CityGeo 表（city-geo.js，342 条城市+区县），避免同一份坐标存两遍。
//
//  用法：node scripts/gen-place-search.js
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSV = path.join(ROOT, 'data', 'schools_b.csv');
const OUT = path.join(ROOT, 'src', 'renderer', 'place-search.js');

// 省级行政区 → 省会/首府（用于搜省名时定位；直辖市即本市）
const PROVINCES = [
  ['北京市', '北京市'], ['天津市', '天津市'], ['上海市', '上海市'], ['重庆市', '重庆市'],
  ['河北省', '石家庄市'], ['山西省', '太原市'], ['辽宁省', '沈阳市'], ['吉林省', '长春市'],
  ['黑龙江省', '哈尔滨市'], ['江苏省', '南京市'], ['浙江省', '杭州市'], ['安徽省', '合肥市'],
  ['福建省', '福州市'], ['江西省', '南昌市'], ['山东省', '济南市'], ['河南省', '郑州市'],
  ['湖北省', '武汉市'], ['湖南省', '长沙市'], ['广东省', '广州市'], ['海南省', '海口市'],
  ['四川省', '成都市'], ['贵州省', '贵阳市'], ['云南省', '昆明市'], ['陕西省', '西安市'],
  ['甘肃省', '兰州市'], ['青海省', '西宁市'], ['台湾省', '台北市'],
  ['内蒙古自治区', '呼和浩特市'], ['广西壮族自治区', '南宁市'], ['西藏自治区', '拉萨市'],
  ['宁夏回族自治区', '银川市'], ['新疆维吾尔自治区', '乌鲁木齐市'],
  ['香港特别行政区', '香港'], ['澳门特别行政区', '澳门']
];

function main() {
  const txt = fs.readFileSync(CSV, 'utf8').replace(/^\uFEFF/, '');
  const lines = txt.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('schools_b.csv 内容为空');

  const seen = new Set();
  const schools = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 6) { skipped++; continue; }
    const name = (cols[1] || '').trim();
    const loc = (cols[4] || '').trim();
    if (!name || !loc || seen.has(name)) { skipped++; continue; }
    seen.add(name);
    schools.push([name, loc]);
  }
  if (!schools.length) throw new Error('没有解析到任何学校记录');

  const body = [
    '// 本文件由 scripts/gen-place-search.js 自动生成，请勿手改。',
    '// 学校名单来自 data/schools_b.csv（' + schools.length + ' 所）；省→省会映射同目录生成脚本内硬编码。',
    '// 城市/区县坐标运行时查 CityGeo 表（geo.js），本文件只存「名称 → 所在地文本」。',
    "'use strict';",
    '',
    '(function () {',
    '  var SCHOOLS = ' + JSON.stringify(schools) + ';',
    '  var PROVINCES = ' + JSON.stringify(PROVINCES) + ';',
    '',
    '  function normalize(s) {',
    "    return String(s == null ? '' : s).replace(/[\\s\\u3000]+/g, '');",
    '  }',
    '',
    '  // 所在地文本 → 坐标（带缓存；地名字符串去重后只有几百种）',
    '  var coordCache = {};',
    '  function coordsOf(locText) {',
    '    var key = normalize(locText);',
    '    if (!key) return null;',
    '    if (coordCache[key]) return coordCache[key];',
    '    var p = (window.Geo && window.Geo.parseLocation) ? window.Geo.parseLocation(key) : null;',
    '    coordCache[key] = p ? [p.coords[0], p.coords[1], p.level] : null;',
    '    return coordCache[key];',
    '  }',
    '',
    '  var TYPE_LABEL = { school: "学校", city: "城市", district: "区县", province: "省份" };',
    '',
    '  /** 学校名 → 所在地。支持：精确 / 去括号后缀 / 互相包含的最长匹配 */',
    '  function schoolLocation(name) {',
    '    var q = normalize(name);',
    '    if (!q) return null;',
    '    var i, s;',
    '    for (i = 0; i < SCHOOLS.length; i++) {',
    '      if (normalize(SCHOOLS[i][0]) === q) return hit(SCHOOLS[i]);',
    '    }',
    '    // 去掉「（xxx）」「[xxx]」后缀再试：用户常写「电子科技大学（清水河校区）」',
    '    var stripped = q.replace(/[（(\\[【][^）)\\]】]*[）)\\]】]/g, "");',
    '    if (stripped && stripped !== q) {',
    '      for (i = 0; i < SCHOOLS.length; i++) {',
    '        if (normalize(SCHOOLS[i][0]) === stripped) return hit(SCHOOLS[i]);',
    '      }',
    '    }',
    '    // 互相包含，取最长的库内名（>=4 字，避免「北大」式误配的噪声）',
    '    var best = null;',
    '    for (i = 0; i < SCHOOLS.length; i++) {',
    '      s = normalize(SCHOOLS[i][0]);',
    '      if (s.length < 4) continue;',
    '      if (q.indexOf(s) >= 0 || s.indexOf(q) >= 0) {',
    '        if (!best || s.length > normalize(best[0]).length) best = SCHOOLS[i];',
    '      }',
    '    }',
    '    return best ? hit(best) : null;',
    '  }',
    '',
    '  function hit(entry) {',
    '    var c = coordsOf(entry[1]);',
    '    if (!c) return null;',
    '    return { school: entry[0], locText: entry[1], lat: c[0], lng: c[1], level: c[2] || "city" };',
    '  }',
    '',
    '  // 允许不命中（返回 -1）——用于多变体匹配',
    '  function matchRank(name, q) {',
    '    if (!q) return -1;',
    '    if (name === q) return 0;',
    '    if (name.indexOf(q) === 0) return 1;',
    '    if (name.indexOf(q) >= 0) return 2;',
    '    return -1;',
    '  }',
    '',
    '  function mk(type, name, detail, place, c) {',
    '    return { type: type, name: name, detail: detail, place: place, lat: c[0], lng: c[1], level: c[2] || "city" };',
    '  }',
    '',
    '  /** 高德式搜索：学校 / 城市 / 区县 / 省份混合候选，供输入框补全 */',
    '  function search(raw, limit) {',
    '    var max = limit || 8;',
    '    var q = normalize(raw);',
    '    if (!q) {',
    '      // 空查询给热门城市，别空手甩用户一脸',
    '      var hot = ["北京", "上海", "广州", "深圳", "成都", "武汉", "西安", "杭州"];',
    '      var out0 = [];',
    '      for (var h = 0; h < hot.length && out0.length < max; h++) {',
    '        var c0 = coordsOf(hot[h] + "市");',
    '        if (c0) out0.push(mk("city", hot[h], "城市", hot[h], c0));',
    '      }',
    '      return out0;',
    '    }',
    '    // 「成都市」「朝阳区」也要能搜——表里存的是裸名（成都 / 朝阳），剥一个后缀再匹配',
    '    var q2 = q.replace(/(省市|省|市|区|县)$/, "");',
    '    var variants = q === q2 ? [q] : [q, q2];',
    '    var G = window.Geo || {};',
    '    var internal = G._internal || {};',
    '    var cityKeys = internal.cityKeys || [];',
    '    var districtsOf = internal.districtsOf || {};',
    '    var hits = [];',
    '    var i, name, c, v, rk;',
    '',
    '    function bestRank(n) {',
    '      var best = -1;',
    '      for (var k = 0; k < variants.length; k++) {',
    '        var r = matchRank(n, variants[k]);',
    '        if (r >= 0 && (best < 0 || r < best)) best = r;',
    '      }',
    '      return best;',
    '    }',
    '',
    '    // 1) 学校（最具体的「位置」）——校名不带行政区后缀，只按原始输入匹配',
    '    for (i = 0; i < SCHOOLS.length; i++) {',
    '      name = normalize(SCHOOLS[i][0]);',
    '      rk = matchRank(name, q);',
    '      if (rk >= 0) {',
    '        c = coordsOf(SCHOOLS[i][1]);',
    '        if (c) hits.push({ r: rk, t: 0, len: name.length, hit: mk("school", SCHOOLS[i][0], "学校 · " + SCHOOLS[i][1], SCHOOLS[i][0], c) });',
    '      }',
    '    }',
    '',
    '    // 2) 城市',
    '    for (i = 0; i < cityKeys.length; i++) {',
    '      name = cityKeys[i];',
    '      rk = bestRank(name);',
    '      if (rk >= 0) {',
    '        c = coordsOf(name);',
    '        if (c) hits.push({ r: rk, t: 1, len: name.length, hit: mk("city", name, "城市", name, c) });',
    '      }',
    '    }',
    '',
    '    // 3) 区县（detail 带所属城市，重名区县不混淆；表里区县是裸名，用户输「朝阳区」也要中）',
    '    var cities = Object.keys(districtsOf);',
    '    for (i = 0; i < cities.length; i++) {',
    '      var ds = districtsOf[cities[i]];',
    '      for (var j = 0; j < ds.length; j++) {',
    '        name = ds[j];',
    '        rk = bestRank(name);',
    '        if (rk >= 0) {',
    '          c = coordsOf(cities[i] + name);',
    '          if (c) hits.push({ r: rk, t: 2, len: name.length, hit: mk("district", name, "区县 · " + cities[i], cities[i] + "·" + name, c) });',
    '        }',
    '      }',
    '    }',
    '',
    '    // 4) 省份（定位到省会）',
    '    for (i = 0; i < PROVINCES.length; i++) {',
    '      rk = matchRank(PROVINCES[i][0], q);',
    '      if (rk < 0) rk = matchRank(PROVINCES[i][1], q);',
    '      if (rk >= 0) {',
    '        c = coordsOf(PROVINCES[i][1]);',
    '        if (c) hits.push({ r: rk, t: 3, len: PROVINCES[i][0].length, hit: mk("province", PROVINCES[i][0], "省份 · 定位到" + PROVINCES[i][1], PROVINCES[i][0], c) });',
    '      }',
    '    }',
    '',
    '    hits.sort(function (a, b) {',
    '      return (a.r - b.r) || (a.t - b.t) || (a.len - b.len);',
    '    });',
    '    // 类型多样性：防止「成都」被同城学校刷满 8 个格子，城市/省份一个都挤不进来',
    '    var caps = { 0: 4, 1: 2, 2: 2, 3: 1 };',
    '    var used = { 0: 0, 1: 0, 2: 0, 3: 0 };',
    '    var taken = {};',
    '    var out = [];',
    '    for (i = 0; i < hits.length && out.length < max; i++) {',
    '      if (used[hits[i].t] < caps[hits[i].t]) { used[hits[i].t]++; taken[i] = 1; out.push(hits[i].hit); }',
    '    }',
    '    for (i = 0; i < hits.length && out.length < max; i++) {',
    '      if (!taken[i]) out.push(hits[i].hit);',
    '    }',
    '    return out;',
    '  }',
    '',
    '  window.PlaceSearch = {',
    '    SCHOOLS: SCHOOLS,',
    '    PROVINCES: PROVINCES,',
    '    search: search,',
    '    schoolLocation: schoolLocation,',
    '    coordsOf: coordsOf',
    '  };',
    '})();',
    ''
  ].join('\n');

  fs.writeFileSync(OUT, body, 'utf8');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log('[gen-place-search] 学校 ' + schools.length + ' 条（跳过 ' + skipped + '），省 ' + PROVINCES.length + ' 条 → ' + path.relative(ROOT, OUT) + '（' + kb + ' KB）');
}

main();
