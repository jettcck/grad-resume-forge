'use strict';

// 探针：把时钟冻结在同一毫秒，验证「两次备份落在同一毫秒」时是否互相覆盖。
// 动机：Windows 上 fs 慢、毫秒够用；Linux CI 的快速文件系统上两次 init 很容易落在同一毫秒。
// 运行：node scripts/probe-backup-collide.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-collide-'));

const RealDate = Date;
const FIXED = new RealDate(2026, 8, 13, 10, 0, 0, 123).getTime();
global.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); }
  static now() { return FIXED; }
};

const store = require('../dist/main/store');
const auth = require('../dist/main/auth');

const bakDir = path.join(tmp, 'grad-resume-data', 'backups');
const backs = () => (fs.existsSync(bakDir) ? fs.readdirSync(bakDir).filter((f) => /^db-.*\.json$/.test(f)).sort() : []);

store.init(tmp);
const u = auth.register({ email: 'c@test.local', password: 'pass123456', name: 'Collide' });
store.saveProfile(u.id, { name: 'v1' });
store.init(tmp);
store.saveProfile(u.id, { name: 'v2' });
store.init(tmp);

const files = backs();
console.log('frozen clock, backups on disk =', files.length, JSON.stringify(files));
const names = files.map((f) => JSON.parse(fs.readFileSync(path.join(bakDir, f), 'utf-8')).profiles[u.id].name);
console.log('contents =', names.join(' | '));
console.log(files.length === 2 ? 'OK: same-millisecond backups do not overwrite each other'
  : 'BUG: same-millisecond backups overwrite each other (natural on fast Linux fs)');

global.Date = RealDate;
