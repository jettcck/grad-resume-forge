'use strict';

// 端到端集成冒烟测试：不启动 GUI，直接驱动后端三大模块
// 注册 → 登录 → 存档 → 生成简历 → 去AI味体检 → 投递记录

const os = require('os');
const path = require('path');
const fs = require('fs');

const store = require('./src/main/store');
const auth = require('./src/main/auth');
const engine = require('./src/main/resume-engine');

let pass = 0;
let failCnt = 0;
function assert(cond, label) {
  if (cond) {
    pass++;
    console.log('✅ PASS:', label);
  } else {
    failCnt++;
    console.log('❌ FAIL:', label);
    process.exitCode = 1;
  }
}

// 用临时目录模拟 Electron userData，避免污染真实数据
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grad-resume-e2e-'));
store.init(tmpDir);
console.log('临时数据目录:', tmpDir, '\n');

// 1) 注册
const email = 'test_' + Date.now() + '@example.com';
const registered = auth.register({ email, password: 'secret123', name: '李明' });
assert(registered && registered.id && registered.email === email, '注册成功并返回公开用户');
assert(registered.hash === undefined && registered.salt === undefined, '公开用户不泄露密码 hash/salt');

// 2) 重复注册应报错
let dupErr = null;
try { auth.register({ email, password: 'secret123' }); } catch (e) { dupErr = e; }
assert(dupErr && /已注册/.test(dupErr.message), '重复邮箱注册被拒绝');

// 3) 弱密码应报错
let weakErr = null;
try { auth.register({ email: 'x@y.com', password: '123' }); } catch (e) { weakErr = e; }
assert(weakErr && /至少 6 位/.test(weakErr.message), '弱密码被拒绝');

// 4) 登录：错误密码
let wrongPwd = null;
try { auth.login({ email, password: 'wrong' }); } catch (e) { wrongPwd = e; }
assert(wrongPwd && /密码错误/.test(wrongPwd.message), '错误密码登录被拒绝');

// 5) 登录：正确密码
const loggedIn = auth.login({ email, password: 'secret123' });
assert(loggedIn.id === registered.id, '正确密码登录成功');

const uid = loggedIn.id;

// 6) 保存个人信息（含明显 AI 味的原始描述）
const profile = {
  name: '李明', phone: '13800001111', email, city: '杭州',
  github: 'github.com/liming', targetRole: '后端开发工程师',
  summary: '',
  skills: 'Java, Go, MySQL, Redis, 数据结构, 计算机网络, Java',
  education: [{ school: '浙江大学', major: '计算机科学与技术', degree: '本科', period: '2021.09-2025.06', gpa: '3.8/4.0', courses: '数据结构、操作系统、计算机网络' }],
  internships: [{
    name: '字节跳动', role: '后端开发实习生', period: '2024.06-2024.09', tech: 'Go/MySQL/Redis',
    description: '本人致力于负责订单系统的优化工作，通过赋能业务实现降本增效，将接口 P99 从 800ms 降到 120ms\n参与用户模块开发，支撑日活 3 万'
  }],
  projects: [{
    name: '分布式短链服务', role: '核心开发', period: '2024.01-2024.05', tech: 'Go/Redis',
    description: '负责短链算法设计，QPS 提升 5 倍\n优秀地实现了缓存查询，P99 降到 80ms'
  }]
};
const savedProfile = store.saveProfile(uid, profile);
assert(savedProfile.userId === uid && savedProfile.updatedAt, '个人信息保存成功');

// 7) 读回
const gotProfile = store.getProfile(uid);
assert(gotProfile && gotProfile.name === '李明', '个人信息读回正确');

// 8) 生成简历
const result = engine.generate(gotProfile, {});
assert(result.resume.basics.name === '李明', '简历基本信息正确');
assert(result.resume.skills.length === 6, '技能去重正确（7 项去重后 6 项）');
assert(result.resume.summary && result.resume.summary.length > 0, '空 summary 自动生成');
assert(result.resume.domain === 'backend', '领域识别为后端');

// 9) 去AI味核心校验：原始文本含套话，改写后应删除
const internBullets = result.resume.internships[0].bullets.join(' ');
assert(!/致力于|本人|赋能|降本增效/.test(internBullets), '实习条目已删除中文套话');
const projBullets = result.resume.projects[0].bullets.join(' ');
assert(!/优秀地|优秀/.test(projBullets), '项目条目已删除空洞形容词');
assert(/主导/.test(projBullets), '弱动词「负责」被强化为「主导」');

// 断裂语句清理：删套话后不应残留「通过业务实现，」这类悬空碎片
assert(!/通过业务实现|通过.{0,4}实现，|，实现，/.test(internBullets), '删套话后无残留断裂从句');

// 10) 体检分数
assert(typeof result.audit.score === 'number' && result.audit.score >= 0 && result.audit.score <= 100, '体检返回合法分数');
assert(Array.isArray(result.tips), '返回优化建议数组');
console.log('   → 生成简历体检分:', result.audit.score, '|', result.audit.level);
console.log('   → 实习条目:', JSON.stringify(result.resume.internships[0].bullets));
console.log('   → 项目条目:', JSON.stringify(result.resume.projects[0].bullets));

// 11) 投递记录 CRUD
const app1 = store.saveApplication(uid, { company: '腾讯', position: '后端开发', stage: 'wish' });
assert(app1.id && app1.company === '腾讯', '新增投递记录');
const app2 = store.saveApplication(uid, { company: '阿里', position: '后端', stage: 'applied' });
assert(store.listApplications(uid).length === 2, '投递列表含 2 条');
const updated = store.saveApplication(uid, { id: app1.id, stage: 'interview' });
assert(updated.stage === 'interview', '更新投递状态成功');
store.deleteApplication(uid, app2.id);
assert(store.listApplications(uid).length === 1, '删除投递记录成功');

// 11b) Agent 快照：保存 / 列表 / 恢复 / 上限 / 深拷贝隔离
const snapProfile = JSON.parse(JSON.stringify(gotProfile));
snapProfile.summary = '被 Agent 改坏的简介';
const snap1 = store.saveAgentSnapshot(uid, 'Agent 改写前 · A', gotProfile);
assert(snap1.id && snap1.label.includes('A'), '快照保存并返回元数据');
assert(store.listAgentSnapshots(uid).length === 1, '快照列表 1 条');
assert(store.listAgentSnapshots(uid)[0].profile === undefined, '列表不含档案本体（轻量）');

// 深拷贝隔离：改原档案不影响快照内容
const mutate = JSON.parse(JSON.stringify(gotProfile));
mutate.summary = '后续手动改掉的简介';
const restoredFromSnap = store.getAgentSnapshot(uid, snap1.id);
assert(restoredFromSnap.summary !== mutate.summary, '快照与后续修改隔离（深拷贝）');

// 恢复 = 用快照内容覆盖档案
store.saveProfile(uid, snapProfile);
assert(store.getProfile(uid).summary === '被 Agent 改坏的简介', '档案已被改写（模拟 Agent 应用）');
const restored = store.saveProfile(uid, store.getAgentSnapshot(uid, snap1.id));
assert(restored.summary === gotProfile.summary, '从快照恢复成功（回到改写前）');

// 上限：最多保留 5 份
for (let i = 0; i < 8; i++) store.saveAgentSnapshot(uid, '快照 ' + i, gotProfile);
assert(store.listAgentSnapshots(uid).length === 5, '快照上限 5 份（存 9 留 5）');
assert(store.listAgentSnapshots(uid)[0].label === '快照 7', '最新的排在最前');

// 删除
store.deleteAgentSnapshot(uid, store.listAgentSnapshots(uid)[0].id);
assert(store.listAgentSnapshots(uid).length === 4, '删除快照成功');
assert(store.getAgentSnapshot(uid, 'snap_不存在') === null, '读取不存在的快照返回 null');

// 12) 数据真正落盘（新实例重新 load 也能读到）
const dbPath = path.join(tmpDir, 'grad-resume-data', 'db.json');
assert(fs.existsSync(dbPath), 'db.json 已落盘');
const rawDb = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
assert(rawDb.users.length === 1 && rawDb.users[0].hash, '落盘数据含用户与加密 hash');

// 清理
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

console.log('\n========================================');
console.log('端到端集成测试完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
console.log('========================================');
