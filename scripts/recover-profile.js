'use strict';
// 一次性恢复脚本：把用户最近的「回炉快照」（真实档案）写回当前 profile，
// 修复「点示例把档案覆盖、无法还原」的数据丢失。使用后如无需要可删除。

const fs = require('fs');
const path = require('path');

const dbFile = path.join(
  process.env.APPDATA, 'grad-resume-forge', 'grad-resume-data', 'db.json'
);

if (!fs.existsSync(dbFile)) {
  console.error('未找到 db.json: ' + dbFile);
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));

// 找出所有用户，取其最新的真实快照（label 以「Agent 改写前 / 载入示例前」开头，排除示例档案）
let restored = [];
for (const userId of Object.keys(db.profiles || {})) {
  const snaps = (db.agentSnapshots || {})[userId] || [];
  if (!snaps.length) continue;
  const snap = snaps.find((s) => !/示例/.test(s.label || '')) || snaps[0];
  const p = snap.profile;
  if (!p || !p.name) continue;
  // 写回当前档案（保留 userId / createdAt，刷新 updatedAt）
  db.profiles[userId] = {
    ...p,
    userId,
    createdAt: db.profiles[userId] && db.profiles[userId].createdAt,
    updatedAt: Date.now()
  };
  restored.push({ userId, name: p.name, targetRole: p.targetRole });
}

if (!restored.length) {
  console.error('没有可用的真实快照可恢复');
  process.exit(2);
}

fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf-8');
console.log('已恢复 ' + restored.length + ' 个用户档案:');
restored.forEach((r) => console.log(`  - ${r.name}（${r.targetRole || '未填目标岗位'}）`));
