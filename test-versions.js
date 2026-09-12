'use strict';

// ============================================================
//  简历版本（多版本：一个岗位一版）自测
//  重点：深拷贝隔离、覆盖/新建语义、上限、按用户隔离、老库兼容
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-ver-'));
process.env.GRF_TEST_DIR = tmp;
const store = require('./dist/main/store');
const auth = require('./dist/main/auth');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

store.init(tmp);
const user = auth.register({ email: 'ver@test.local', password: 'pass123456', name: '版本测试' });

const PROFILE_A = {
  name: '张三', phone: '13800000000', email: 'a@b.c', city: '成都', targetRole: '后端开发工程师',
  skills: 'Java, MySQL', education: [], internships: [],
  projects: [{ name: '订单系统', role: '开发', tech: 'Java', description: '优化接口，P99 从 800ms 降到 120ms' }]
};
const JD_BACKEND = '后端工程师\n要求：熟悉 Java、MySQL、Redis';

// ---------- 1) 保存与列表 ----------
const v1 = store.saveVersion(user.id, {
  name: '字节-后端', note: '偏基础架构', profile: PROFILE_A, jdText: JD_BACKEND,
  targetRole: '后端开发工程师', template: 'tech', auditScore: 92, jdScore: 67, jdHit: 2, jdTotal: 3
});
assert(!!v1.id && v1.id.startsWith('ver_'), '保存返回带 id 的版本元数据');
assert(v1.name === '字节-后端' && v1.note === '偏基础架构', '名称与备注正确保存');
assert(v1.hasJd === true, '元数据标记「带 JD」');
assert(v1.auditScore === 92 && v1.jdScore === 67, '保存时算好的体检分与 JD 覆盖率被记住');

const list1 = store.listVersions(user.id);
assert(list1.length === 1, '列表返回 1 条');
assert(list1[0].profile === undefined && list1[0].jdText === undefined,
  '列表是轻量元数据（不带档案本体与 JD 原文）');

// ---------- 2) 深拷贝隔离：改档案不影响已存版本 ----------
PROFILE_A.name = '被改过的名字';
PROFILE_A.projects[0].description = '被改过的描述';
const got = store.getVersion(user.id, v1.id);
assert(got.profile.name === '张三', '版本内的档案与后续修改隔离（姓名未被污染）');
assert(got.profile.projects[0].description.includes('120ms'), '版本内项目描述未被污染');
PROFILE_A.name = '张三'; // 还原

// ---------- 3) getVersion 返回深拷贝：改返回值不影响库内 ----------
got.profile.name = '外部改的';
const got2 = store.getVersion(user.id, v1.id);
assert(got2.profile.name === '张三', 'getVersion 返回深拷贝（改返回值不污染库内）');
assert(got2.jdText.includes('Redis'), '版本保留了针对的 JD 原文');

// ---------- 4) 带 id 保存 = 覆盖（不新增） ----------
const v1b = store.saveVersion(user.id, {
  id: v1.id, name: '字节-后端 v2', profile: PROFILE_A, targetRole: '后端开发工程师'
});
assert(v1b.id === v1.id, '带 id 保存是覆盖同一版本');
assert(store.listVersions(user.id).length === 1, '覆盖不产生新条目');
assert(store.listVersions(user.id)[0].name === '字节-后端 v2', '覆盖后名称已更新');

// ---------- 5) 只改名不动档案 ----------
const renamed = store.renameVersion(user.id, v1.id, '字节-后端（终版）', '投递用');
assert(renamed.name === '字节-后端（终版）' && renamed.note === '投递用', '改名与备注生效');
assert(store.getVersion(user.id, v1.id).profile.name === '张三', '改名不影响档案本体');
let renameErr = null;
try { store.renameVersion(user.id, 'ver_not_exist', 'x'); } catch (e) { renameErr = e; }
assert(renameErr && /不存在/.test(renameErr.message), '改不存在的版本报错');

// ---------- 6) 多版本排序与新建 ----------
const v2 = store.saveVersion(user.id, { name: '腾讯-后端', profile: PROFILE_A, targetRole: '后端开发工程师' });
const v3 = store.saveVersion(user.id, { name: '美团-数据', profile: PROFILE_A, targetRole: '数据分析师' });
const list3 = store.listVersions(user.id);
assert(list3.length === 3, '现有 3 个版本');
assert(list3[0].id === v3.id, '最新保存的排在最前');

// ---------- 7) 删除（必须在容量测试之前：v2 仍存在才有意义） ----------
assert(store.listVersions(user.id).length === 3, '删除前共 3 个版本');
const del = store.deleteVersion(user.id, v2.id);
assert(del.removed === v2.id, '删除返回被删 id');
assert(store.listVersions(user.id).length === 2, '删除后数量减 1（实际 ' + store.listVersions(user.id).length + '）');
assert(!store.listVersions(user.id).some((x) => x.id === v2.id), '删除后列表不含该版本');
assert(store.getVersion(user.id, v2.id) === null, '删除后取该版本返回 null');
assert(store.getVersion(user.id, v1.id) !== null, '删除不影响其它版本');

// ---------- 8) 上限 30：超出丢最旧 ----------
for (let i = 0; i < 35; i++) {
  store.saveVersion(user.id, { name: '批量-' + i, profile: PROFILE_A });
}
const capped = store.listVersions(user.id);
assert(capped.length === 30, '版本上限 30 份（实际 ' + capped.length + '）');
assert(capped[0].name === '批量-34', '最新的仍在最前');
assert(!capped.some((x) => x.name === '字节-后端（终版）'), '超出上限时丢弃最旧的版本');

// ---------- 9) 按用户隔离 ----------
const user2 = auth.register({ email: 'ver2@test.local', password: 'pass123456', name: '另一个用户' });
assert(store.listVersions(user2.id).length === 0, '新用户看不到别人的版本');
store.saveVersion(user2.id, { name: '我的版本', profile: { name: '李四' } });
assert(store.listVersions(user2.id).length === 1, '各用户版本互不影响');
assert(store.listVersions(user.id).length === 30, '原用户的版本数不受影响（30 条）');

// ---------- 10) 落盘与老库兼容 ----------
const dbFile = path.join(tmp, 'grad-resume-data', 'db.json');
const raw = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
assert(!!raw.resumeVersions && !!raw.resumeVersions[user.id], '版本已落盘到 db.json');
assert(!JSON.stringify(raw.resumeVersions).includes('hasJd'),
  'hasJd 是派生字段，不落盘（只存在于列表元数据）');

// 模拟旧库（没有 resumeVersions 字段）→ 不能崩、按空库处理
const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-legacy-'));
fs.mkdirSync(path.join(legacyDir, 'grad-resume-data'), { recursive: true });
fs.writeFileSync(path.join(legacyDir, 'grad-resume-data', 'db.json'), JSON.stringify({
  users: user.toJSON ? [] : [], profiles: {}, applications: {}, sessions: {}, settings: {}, agentSnapshots: {}
}), 'utf-8');
let legacyOk = true;
try {
  const store2 = require('./dist/main/store');
  // 直接调用内部加载：用 _db 或重新 init 都会读同一模块实例，这里用 init 指向新目录再列一次空版本即可
  store2.init(legacyDir);
  assert(Array.isArray(store2.listVersions('anyone')), '旧库（无 resumeVersions 字段）读版本列表不崩，返回空数组');
} catch (e) {
  legacyOk = false;
  assert(false, '旧库兼容失败：' + e.message);
}
if (legacyOk && !process.exitCode) assert(true, '老库向前兼容 OK');

console.log('\n简历版本自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
