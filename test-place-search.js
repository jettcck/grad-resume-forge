'use strict';

// ============================================================
//  出发地搜索选点回归测试（place-search.js）
//
//  守的是「默认填简历学校 + 高德式搜索选点」这条链上最容易错的事：
//    1. 学校名 → 所在地：精确 / 带括号后缀 / 长包含，三种写法都要能定位
//    2. 搜索排序：学校名精确命中必须排第一，不能输「四川大学」先蹦出一堆城市
//    3. 每个候选都必须带合法坐标（没有坐标的候选存进出发地就是 NaN 距离）
//    4. 省名搜索定位到省会，且 34 个省的省会都能解析（硬编码表写错一个这里就炸）
//    5. 源码级契约：出发地对话框里不允许再出现经纬度输入（用户明确要求去掉）
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
for (const f of ['city-geo.js', 'geo.js', 'place-search.js']) {
  const src = fs.readFileSync(path.join(__dirname, 'src', 'renderer', f), 'utf8');
  vm.runInContext(src, sandbox, { filename: f });
}
const PS = sandbox.window.PlaceSearch;
const Geo = sandbox.window.Geo;

assert(!!PS, 'PlaceSearch 已挂到 window');
assert(Array.isArray(PS.SCHOOLS) && PS.SCHOOLS.length > 2500, '学校库规模正常（实得 ' + (PS.SCHOOLS ? PS.SCHOOLS.length : 0) + ' 所）');

// ---------- 1) 学校名 → 所在地 ----------
{
  const pku = PS.schoolLocation('北京大学');
  assert(!!pku && pku.locText === '北京市', '北京大学 → 北京市（实得 ' + (pku && pku.locText) + '）');
  assert(!!pku && Math.abs(pku.lat - 39.9) < 1 && Math.abs(pku.lng - 116.4) < 1, '北京大学坐标落在北京（' + (pku && pku.lat.toFixed(3)) + ',' + (pku && pku.lng.toFixed(3)) + '）');

  const uestc = PS.schoolLocation('电子科技大学（清水河校区）');
  assert(!!uestc && uestc.locText === '成都市', '带括号后缀的学校名也能定位（实得 ' + (uestc && uestc.locText) + '）');

  const thu = PS.schoolLocation('清华大学计算机系');
  assert(!!thu && thu.school === '清华大学', '输入包含库内校名时取最长匹配（实得 ' + (thu && thu.school) + '）');

  assert(PS.schoolLocation('火星大学文理学院') === null, '查不到的学校返回 null（不瞎猜位置）');
  assert(PS.schoolLocation('') === null && PS.schoolLocation(null) === null, '空输入返回 null');
}

// ---------- 2) 搜索：学校精确命中排第一 ----------
{
  const r = PS.search('四川大学', 8);
  assert(r.length > 0 && r[0].type === 'school' && r[0].name === '四川大学', '输「四川大学」第一个就是该校（实得 ' + (r[0] && r[0].type + ':' + r[0].name) + '）');

  const cd = PS.search('成都', 8);
  assert(cd.some((x) => x.type === 'city' && x.name === '成都'), '输「成都」能选到成都市（实得 ' + cd.map((x) => x.type + ':' + x.name).join(' | ') + '）');
  assert(cd.some((x) => x.type === 'school' && x.detail.indexOf('成都') >= 0), '输「成都」同时列出成都的学校');

  const cd2 = PS.search('成都市', 8);
  assert(cd2.some((x) => x.type === 'city' && x.name === '成都'), '输「成都市」（带市后缀）也能选到成都');

  const cy = PS.search('朝阳', 8);
  assert(cy.some((x) => x.type === 'district' && x.name === '朝阳'), '输「朝阳」能选到朝阳（区县表存裸名，实得 ' + cy.map((x) => x.type + ':' + x.name).join(' | ') + '）');

  const cy2 = PS.search('朝阳区', 8);
  assert(cy2.some((x) => x.type === 'district' && x.name === '朝阳'), '输「朝阳区」（带区后缀）也能选到朝阳');

  const sc = PS.search('四川', 8);
  const prov = sc.find((x) => x.type === 'province');
  assert(!!prov && prov.detail.indexOf('成都') >= 0, '输「四川」给出省份且定位到成都（实得 ' + (prov && prov.detail) + '）');
}

// ---------- 3) 每个候选都带合法坐标 ----------
{
  const queries = ['北京', '上海', '广州', '武汉', '西安', '杭州', '深圳', '南京', '朝阳', '浦东', '海淀', '大学'];
  let bad = 0, total = 0;
  for (const q of queries) {
    for (const it of PS.search(q, 8)) {
      total++;
      if (!isFinite(it.lat) || !isFinite(it.lng) || it.lat < -90 || it.lat > 90 || it.lng < -180 || it.lng > 180) {
        bad++;
        console.log('    BAD', q, JSON.stringify(it));
      }
    }
  }
  assert(bad === 0, '全部 ' + total + ' 个候选坐标合法（坏 ' + bad + ' 个）');

  const hot = PS.search('', 8);
  assert(hot.length === 8 && hot.every((x) => x.type === 'city'), '空查询给 8 个热门城市');
  const lim = PS.search('大学', 3);
  assert(lim.length <= 3, 'limit 参数生效（实得 ' + lim.length + '）');
}

// ---------- 4) 34 省的省会都能解析 ----------
{
  let badProv = [];
  for (const [prov, capital] of PS.PROVINCES) {
    const c = PS.coordsOf(capital);
    if (!c) badProv.push(prov + '→' + capital);
  }
  assert(badProv.length === 0, '34 个省级行政区的省会全部可解析' + (badProv.length ? '（失败：' + badProv.join(', ') + '）' : ''));
}

// ---------- 5) 源码级契约：出发地对话框不出现经纬度输入 ----------
{
  const mv = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'map-view.js'), 'utf8');
  assert(!/label:\s*'lat'/.test(mv) && !/label:\s*'lng'/.test(mv), '出发地/公司位置表单里不再有纬度/经度输入项');
  assert(!/纬度（选填/.test(mv) && !/经度（选填/.test(mv), '任何位置对话框都不再提示填经纬度');
  assert(mv.indexOf('originSearchModal') < 0 && mv.indexOf('placeSearchModal') >= 0, '位置选点统一走 placeSearchModal');
  assert(mv.indexOf('deriveOriginFromProfile') >= 0, '出发地默认值走简历学校派生（deriveOriginFromProfile）');
  assert(mv.indexOf("source: 'school'") >= 0, '学校来源标记已接入（source: school）');

  const html = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'index.html'), 'utf8');
  assert(html.indexOf('place-search.js') >= 0, 'index.html 已加载 place-search.js');
}

console.log('\n出发地搜索选点自测完成: ' + pass + ' passed, ' + failCnt + ' failed | exitCode = ' + (failCnt ? 1 : 0));
