'use strict';
// 生成器：从权威数据集生成 CITIES / SCHOOLS，并原地替换 data.js 中的两个数组，
// 保留 MAJORS / ROLES / DEGREES 不变。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dataFile = path.join(ROOT, 'src', 'renderer', 'data.js');

// ---------- 城市：全部地级市 + 直辖市 + 港澳台 ----------
const rawCities = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cities.json'), 'utf8'));
const EXCLUDE = new Set(['市辖区', '县', '省直辖县级行政区划', '自治区直辖县级行政区划']);
const citySet = new Set();
const CITIES = [];
function pushCity(name) {
  if (!name || citySet.has(name)) return;
  citySet.add(name);
  CITIES.push(name);
}
// 直辖市（cities.json 中显示为“市辖区”，需手动补齐）
['北京', '上海', '天津', '重庆'].forEach(pushCity);
rawCities.forEach((c) => {
  if (EXCLUDE.has(c.name)) return;
  // 地级市去掉“市”后缀，与既有风格一致；自治州/地区/盟保留全称
  const name = /市$/.test(c.name) ? c.name.replace(/市$/, '') : c.name;
  pushCity(name);
});
// 港澳台
['香港', '澳门', '台北', '新北', '高雄', '台中', '台南'].forEach(pushCity);

// ---------- 学校：教育部名单中“本科”层次 ----------
const csv = fs.readFileSync(path.join(ROOT, 'data', 'schools_b.csv'), 'utf8').replace(/^\uFEFF/, '');
const lines = csv.split(/\r?\n/).filter((l) => l.trim().length);
const header = lines[0].split(',');
const idxName = header.indexOf('学校名称');
const idxLevel = header.indexOf('办学层次');
const schoolSet = new Set();
const SCHOOLS = [];
for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(',');
  const level = (cols[idxLevel] || '').trim();
  const name = (cols[idxName] || '').trim();
  if (level !== '本科' || !name) continue;
  if (schoolSet.has(name)) continue;
  schoolSet.add(name);
  SCHOOLS.push(name);
}

// ---------- 生成数组字面量（每行若干项，便于阅读） ----------
function toBlock(arr, perLine) {
  const out = [];
  for (let i = 0; i < arr.length; i += perLine) {
    out.push('    ' + arr.slice(i, i + perLine).map((s) => "'" + s + "'").join(', '));
  }
  return out.join(',\n');
}

let text = fs.readFileSync(dataFile, 'utf8');

const citiesBlock = 'const CITIES = [\n' + toBlock(CITIES, 12) + '\n  ];';
const schoolsBlock = 'const SCHOOLS = [\n' + toBlock(SCHOOLS, 6) + '\n  ];';

text = text.replace(/const CITIES = \[[\s\S]*?\];/, citiesBlock);
text = text.replace(/const SCHOOLS = \[[\s\S]*?\];/, schoolsBlock);

fs.writeFileSync(dataFile, text, 'utf8');
console.log('CITIES=', CITIES.length, 'SCHOOLS=', SCHOOLS.length);
console.log('city sample:', CITIES.slice(0, 8).join(' '));
console.log('school sample:', SCHOOLS.slice(0, 6).join(' '));
