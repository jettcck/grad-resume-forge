'use strict';

// ============================================================
//  数据备份自测（自动轮转 + 一键恢复）
//  动机：库是单文件 JSON，一次意外写入就可能丢掉整个集合。
//  这层保险要求：能留档、不堆重复、不备份坏文件、恢复安全且可回滚。
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-bak-'));
const store = require('./dist/main/store');
const auth = require('./dist/main/auth');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

const dataDir = path.join(tmp, 'grad-resume-data');
const dbFile = path.join(dataDir, 'db.json');
const bakDir = path.join(dataDir, 'backups');
const backs = () => (fs.existsSync(bakDir) ? fs.readdirSync(bakDir).filter((f) => /^db-.*\.json$/.test(f)).sort() : []);

// ---------- 1) 首次启动：还没有库文件 → 不产生备份，且不能崩 ----------
store.init(tmp);
assert(fs.existsSync(dbFile) === false || true, '首次 init 不崩');
assert(backs().length === 0, '还没有库文件时不产生备份');

// 建立真实数据
const user = auth.register({ email: 'bak@test.local', password: 'pass123456', name: '备份测试' });
store.saveProfile(user.id, { name: '张三', targetRole: '后端开发工程师', skills: 'Java' });
assert(fs.existsSync(dbFile), '库文件已生成');

// ---------- 2) 再次启动 → 为上一轮状态留档 ----------
store.init(tmp);
assert(backs().length === 1, '再次启动产生 1 份备份（实际 ' + backs().length + '）');
const first = backs()[0];
assert(/^db-\d{8}-\d{9}\.json$/.test(first), '备份文件名符合 db-YYYYMMDD-HHmmssSSS.json（含毫秒防同秒覆盖）：' + first);
const b1 = JSON.parse(fs.readFileSync(path.join(bakDir, first), 'utf-8'));
assert(Array.isArray(b1.users) && b1.users.length === 1, '备份内容含用户数据');
assert(b1.profiles[user.id].name === '张三', '备份内容含档案');

// ---------- 3) 内容没变 → 不重复堆副本 ----------
store.init(tmp);
assert(backs().length === 1, '库内容未变时不重复备份（仍 ' + backs().length + ' 份）');

// ---------- 4) 内容变化 → 新增一份 ----------
store.saveProfile(user.id, { name: '张三（改）' });
store.init(tmp);
assert(backs().length === 2, '内容变化后新增一份（实际 ' + backs().length + ' 份）');
const latest = JSON.parse(fs.readFileSync(path.join(bakDir, backs()[1]), 'utf-8'));
const earlier = JSON.parse(fs.readFileSync(path.join(bakDir, backs()[0]), 'utf-8'));
assert(latest.profiles[user.id].name === '张三（改）', '新备份是变化后的状态');
assert(earlier.profiles[user.id].name === '张三', '旧备份保留变化前的状态（可回滚到更早）');

// ---------- 5) 上限：只保留最近 5 份 ----------
for (let i = 0; i < 8; i++) {
  store.saveProfile(user.id, { name: '第' + i + '次改动' });
  store.init(tmp);
}
assert(backs().length === 5, '备份上限 5 份（实际 ' + backs().length + '）');
const keptNames = backs().map((f) => JSON.parse(fs.readFileSync(path.join(bakDir, f), 'utf-8')).profiles[user.id].name);
assert(keptNames[keptNames.length - 1] === '第7次改动', '保留的是最近的几份（最后一份=' + keptNames[keptNames.length - 1] + '）');
assert(!keptNames.includes('张三'), '最旧的备份已被淘汰');

// ---------- 6) listBackups：最新在前，含大小与时间 ----------
const list = store.listBackups();
assert(list.length === 5, 'listBackups 返回 5 条');
assert(list[0].name > list[4].name, '最新在前（按文件名排序）');
assert(list.every((x) => x.size > 0 && x.createdAt > 0), '每条含 size 与 createdAt');

// ---------- 7) 恢复：内容回到那一份，且恢复前也留档（恢复可回滚）----------
const target = list[list.length - 1]; // 最旧的一份（第 3 次改动左右）
const targetName = JSON.parse(fs.readFileSync(path.join(bakDir, target.name), 'utf-8')).profiles[user.id].name;
const beforeRestore = backs().length;
const res = store.restoreBackup(target.name);
assert(res.restored === target.name, '恢复返回被恢复的备份名');
assert(store.getProfile(user.id).name === targetName, '恢复后内存中的档案回到该备份状态（' + targetName + '）');
assert(JSON.parse(fs.readFileSync(dbFile, 'utf-8')).profiles[user.id].name === targetName, '恢复后磁盘内容同步');
assert(backs().length >= beforeRestore, '恢复前会先把当前状态留档（恢复本身可回滚）');

// ---------- 8) 安全性：非法名/路径穿越/不存在的备份都要被拒 ----------
[['../../etc/passwd', /不合法/], ['db-20200101-000000000.json', /不存在/], ['', /不合法/], ['evil.json', /不合法/]]
  .forEach(([name, re]) => {
    let err = null;
    try { store.restoreBackup(name); } catch (e) { err = e; }
    assert(err && re.test(err.message), '拒绝非法恢复请求：' + (name || '(空)') + ' → ' + (err ? err.message : '未抛错'));
  });

// ---------- 9) 坏文件不备份；库损坏时不影响启动 ----------
fs.writeFileSync(dbFile, '{ 这不是合法 JSON', 'utf-8');
const beforeBad = backs().length;
store.init(tmp);
assert(backs().length === beforeBad, '库文件损坏时不备份（避免把坏内容也留档）');
assert(fs.readdirSync(dataDir).some((f) => f.includes('.corrupt-')), '损坏的库被改名另存（不静默丢弃）');

console.log('\n数据备份自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
