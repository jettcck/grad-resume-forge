'use strict';

// 从安全备份里恢复「王锦楠」那份档案，并把当前的测试档案存成一个简历版本。
//
// 原则：只动 profiles[当前用户]，其余（登录会话、设置里的模型配置与密钥、投递记录、
// 版本、快照、备份）原样保留 —— 整库覆盖会把用户在导入之后做的所有事一起抹掉。
//
// 用法：
//   node scripts/restore-profile.js            # 只做检查，不写文件
//   node scripts/restore-profile.js --apply    # 真正写入（会先另存一份当前库）
const fs = require('fs');
const path = require('path');

const dd = path.join(process.env.APPDATA, 'grad-resume-forge', 'grad-resume-data');
const dbFile = path.join(dd, 'db.json');
const SOURCE = path.join(dd, 'db.json.bak-before-1.9.12-install');
const apply = process.argv.includes('--apply');
const TARGET_NAME = '王锦楠';
const TEMPLATE = 'classic';

const cur = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
const bak = JSON.parse(fs.readFileSync(SOURCE, 'utf-8'));

const uid = Object.keys(cur.profiles || {})[0];
if (!uid) { console.error('当前库里没有档案，终止'); process.exit(1); }

const mine = bak.profiles && bak.profiles[uid];
if (!mine || mine.name !== TARGET_NAME) {
  console.error('备份里没有找到「' + TARGET_NAME + '」的档案，终止');
  process.exit(1);
}

const before = cur.profiles[uid];
console.log('将把当前档案「' + before.name + '」替换为备份里的「' + mine.name + '」');
console.log('  恢复内容：' + mine.targetRole + ' | ' + (mine.education || []).map((e) => e.school).join('、') +
  ' | 手机 ' + mine.phone + ' | 城市 ' + mine.city);
console.log('  保留不动：用户/登录会话/设置（含模型配置与密钥）/投递/版本/快照/备份文件');

if (!apply) {
  console.log('\n（当前是检查模式，未写入任何文件。加 --apply 才会真正恢复）');
  process.exit(0);
}

// 1) 先把当前库另存一份，恢复错了还能回退
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const safety = path.join(dd, 'db.json.bak-before-restore-' + TARGET_NAME);
fs.copyFileSync(dbFile, safety);
console.log('\n已另存当前状态：' + path.basename(safety));

// 2) 把测试档案存成一个简历版本（这样它不会消失，界面上能随时切回）
try {
  if (!cur.resumeVersions) cur.resumeVersions = {};
  if (!cur.resumeVersions[uid]) cur.resumeVersions[uid] = [];
  const now = Date.now();
  cur.resumeVersions[uid].unshift({
    id: 'ver_restore_' + now,
    name: '测试样本 · ' + (before.name || '导入的简历'),
    note: '恢复原档案前，自动留存的导入测试档案',
    targetRole: String(before.targetRole || '').slice(0, 60),
    template: TEMPLATE,
    auditScore: null,
    jdScore: null,
    jdHit: 0,
    jdTotal: 0,
    createdAt: now,
    updatedAt: now,
    profile: JSON.parse(JSON.stringify(before)),
    jdText: ''
  });
  console.log('已把「' + before.name + '」存为简历版本：测试样本 · ' + before.name);
} catch (err) {
  console.log('（留存测试档案失败，仅影响便利性：' + err.message + '）');
}

// 3) 只替换档案本身
cur.profiles[uid] = JSON.parse(JSON.stringify(mine));
cur.schemaVersion = typeof cur.schemaVersion === 'number' ? cur.schemaVersion : 1;

// 4) 原子写：先写 .tmp 再改名（与应用自己的 persist 一致，避免半截文件）
const tmp = dbFile + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(cur, null, 2), 'utf-8');
fs.renameSync(tmp, dbFile);

// 5) 读回校验
const check = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
const p = check.profiles[uid];
console.log('\n写回校验：');
console.log('  档案名 = ' + p.name + ' | 岗位 = ' + p.targetRole + ' | 手机 = ' + p.phone + ' | 城市 = ' + p.city);
console.log('  教育 = ' + (p.education || []).map((e) => e.school + '/' + e.major).join('、'));
console.log('  项目 = ' + (p.projects || []).length + ' 段 | 作品集 = ' + (p.github || '(空)'));
console.log('  设置键保留 = ' + Object.keys(check.settings || {}).join(', '));
console.log('  版本数 = ' + ((check.resumeVersions && check.resumeVersions[uid]) || []).length +
  ' | 用户数 = ' + (check.users || []).length);
console.log(p.name === TARGET_NAME ? '\n恢复成功 ✓' : '\n恢复后档案名不符，请检查 ✗');
