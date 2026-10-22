'use strict';

// ============================================================
//  岗位池核心逻辑自测
//  覆盖：部分更新不清空 / 后端去重合并 / 状态流转 / 上限 / 用户隔离
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-jobs-'));
process.env.GRF_TEST_DIR = tmp;
const store = require('./dist/main/store');
const auth = require('./dist/main/auth');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

store.init(tmp);
const user = auth.register({ email: 'jobs@test.local', password: 'pass123456', name: '岗位测试' });
const uid = user.id;

// ---------------------------------------------------------------
// 1) 部分更新不得清空未传字段
// ---------------------------------------------------------------
const created = store.saveJob(uid, {
  company: '赞同科技',
  position: '大模型算法工程师',
  jdText: '岗位职责：负责大模型应用落地……',
  salary: '15-25k·14薪',
  city: '绵阳',
  education: '本科',
  experience: '应届',
  skills: 'Python / PyTorch',
  url: 'https://example.com/job/1',
  starred: true,
  priority: 5
});
assert(!!created.id, '新增岗位返回 id');
assert(created.salary === '15-25k·14薪', '新增保留薪资');

// 模拟「转投递」时的部分更新：只传 id + company + applicationId
const partial = store.saveJob(uid, {
  id: created.id,
  company: '赞同科技',
  applicationId: 'app_123'
});
assert(partial.jdText === '岗位职责：负责大模型应用落地……', '部分更新不清空 JD 文本');
assert(partial.salary === '15-25k·14薪', '部分更新不清空薪资');
assert(partial.education === '本科', '部分更新不清空学历');
assert(partial.experience === '应届', '部分更新不清空经验');
assert(partial.skills === 'Python / PyTorch', '部分更新不清空技能');
assert(partial.url === 'https://example.com/job/1', '部分更新不清空链接');
assert(partial.starred === true, '部分更新不清空星标');
assert(partial.priority === 5, '部分更新不清空优先级');
assert(partial.applicationId === 'app_123', '部分更新写入关联投递 id');

// 显式传空字符串才允许清空
const cleared = store.saveJob(uid, { id: created.id, company: '赞同科技', salary: '' });
assert(cleared.salary === '', '显式传空才清空字段');

// ---------------------------------------------------------------
// 2) 后端去重：同公司+同岗位合并，不新建
// ---------------------------------------------------------------
const before = store.listJobs(uid).length;
const dup = store.saveJob(uid, {
  company: '赞同科技',
  position: '大模型算法工程师',
  salary: '20-30k'
});
const after = store.listJobs(uid).length;
assert(after === before, '同公司+同岗位不新增记录（' + before + '→' + after + '）');
assert(dup.id === created.id, '去重命中返回原记录 id');
assert(dup.salary === '20-30k', '去重合并时新值覆盖旧值');
assert(dup.jdText === '岗位职责：负责大模型应用落地……', '去重合并不丢原有 JD');

// 同链接不同公司名也算同一条
const byUrl = store.saveJob(uid, {
  company: '赞同科技（改名）',
  position: '另一个岗位',
  url: 'https://example.com/job/1'
});
assert(byUrl.id === created.id, '相同 URL 视为同一条岗位');

// 同公司不同岗位应各自独立
const other = store.saveJob(uid, {
  company: '赞同科技',
  position: 'Java 开发工程师',
  url: 'https://example.com/job/2'
});
assert(other.id !== created.id, '同公司不同岗位各自独立');
assert(store.listJobs(uid).length === before + 1, '新岗位正常入池');

// 没写岗位名时不做公司级判重
const noPos = store.saveJob(uid, { company: '某公司A' });
const noPos2 = store.saveJob(uid, { company: '某公司A' });
assert(noPos.id !== noPos2.id, '未填岗位名时不按公司误合并');

// ---------------------------------------------------------------
// 3) 状态：淘汰即关闭，取消淘汰回到候选/已投
// ---------------------------------------------------------------
store.markJob(uid, created.id, { rejected: true });
assert(store.getJob(uid, created.id).status === 'closed', '淘汰后状态为 closed');
store.markJob(uid, created.id, { rejected: false });
assert(store.getJob(uid, created.id).status === 'applied', '有投递关联时取消淘汰回到 applied');

const plain = store.saveJob(uid, { company: '无投递公司', position: '测试岗' });
assert(plain.status === 'candidate', '新岗位默认 candidate');
store.markJob(uid, plain.id, { rejected: true });
store.markJob(uid, plain.id, { rejected: false });
assert(store.getJob(uid, plain.id).status === 'candidate', '无投递关联时取消淘汰回到 candidate');

// ---------------------------------------------------------------
// 4) 用户隔离
// ---------------------------------------------------------------
const user2 = auth.register({ email: 'jobs2@test.local', password: 'pass123456', name: '用户二' });
assert(store.listJobs(user2.id).length === 0, '岗位数据按用户隔离');

// ---------------------------------------------------------------
// 5) 新增时公司名为空要报错
// ---------------------------------------------------------------
let threw = false;
try { store.saveJob(uid, { position: '缺公司' }); } catch (_) { threw = true; }
assert(threw, '新增岗位缺公司名报错');

threw = false;
try { store.saveJob(uid, { id: created.id, company: '   ' }); } catch (_) { threw = true; }
assert(threw, '更新时显式传空公司名报错');

// ---------------------------------------------------------------
// 6) 上限保护
// ---------------------------------------------------------------
for (let i = 0; i < 205; i++) {
  store.saveJob(uid, { company: '公司' + i, position: '岗位' + i });
}
assert(store.listJobs(uid).length <= 200, '岗位数量不超过上限（' + store.listJobs(uid).length + '）');

console.log('\n岗位池自测完成: ' + pass + ' passed, ' + failCnt + ' failed | exitCode = ' + (process.exitCode || 0));
