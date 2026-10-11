'use strict';

// ============================================================
//  招聘平台同步自测（纯逻辑层）
//
//  只测 job-sync-core（无 electron 依赖）：
//    - 平台注册表的完整性与自洽
//    - 响应体 → 投递记录的归一化：字段别名、嵌套、去重、噪音过滤、时间解析
//  窗口与 CDP 旁路属于 IO，不在这里测。
// ============================================================
const path = require('path');

const C = require(path.join(__dirname, 'dist/main/job-sync-core'));

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

// ---------- 1) 平台注册表 ----------
const P = C.SYNC_PLATFORMS;
assert(Array.isArray(P) && P.length >= 9, '平台表覆盖用户列出的招聘站（实得 ' + P.length + ' 个）');
const ids = new Set(P.map((p) => p.id));
assert(ids.size === P.length, '平台 id 不重复');
assert(P.every((p) => p.id && p.name && p.loginUrl), '每个平台都有 id / 名称 / 登录入口');
assert(P.every((p) => p.syncable ? !!p.applyUrl : true), '声明可同步的平台都配了投递记录页地址');
assert(P.every((p) => p.syncable ? true : !!p.note), '不可同步的平台都给了明确原因（不静默留空）');
const names = P.map((p) => p.name);
['BOSS直聘', '智联招聘', '前程无忧', '实习僧', '猎聘', '拉勾', '国聘'].forEach((n) => {
  assert(names.includes(n), '平台表包含 ' + n);
});
assert(C.findPlatform('boss').name === 'BOSS直聘', 'findPlatform 能按 id 取到平台');
assert(C.findPlatform('not-exist') === null, '未知 id 返回 null 而不是抛错');

// ---------- 2) 字段别名与嵌套 ----------
const bossLike = {
  code: 0,
  zpData: {
    list: [
      { jobName: 'Java开发工程师', companyName: '甲甲公司', cityName: '北京', encryptJobId: 'a1', jobUrl: '/job_detail/a1.html' },
      { jobName: '前端开发工程师', companyName: '乙乙公司', cityName: '杭州', encryptJobId: 'b2' }
    ],
    total: 2
  }
};
const r1 = C.extractRecords([{ url: 'https://x/api', json: bossLike }], 'applied');
assert(r1.length === 2, '从嵌套响应里提取到 2 条记录（实得 ' + r1.length + '）');
assert(r1[0].company === '甲甲公司' && r1[0].position === 'Java开发工程师', '公司名与岗位名抓对');
assert(r1[0].place === '北京', '地点抓对');
assert(r1[0].externalId === 'a1', '平台内 ID 抓对（用于跨次去重）');
assert(r1[0].stage === 'applied', '投递记录落到「已投递」');

const altLike = {
  data: {
    items: [
      { company: { name: '丙丙科技' }, jobTitle: '算法工程师', workCity: '深圳', positionId: 998877 }
    ]
  }
};
const r2 = C.extractRecords([{ url: 'https://y/api', json: altLike }], 'applied');
assert(r2.length === 1, '换一套字段别名（company.name / jobTitle）同样能提取');
assert(r2[0].company === '丙丙科技' && r2[0].position === '算法工程师', '嵌套公司名被正确展开');
assert(r2[0].externalId === '998877', '数字 ID 被转成字符串（IPC 断言不接受非字符串）');

// ---------- 3) 噪音过滤与去重 ----------
const noisy = {
  data: {
    banners: [{ title: '春季招聘会', content: '欢迎参加。' }],
    list: [
      { jobName: '测试工程师', companyName: '丁丁公司' },
      { jobName: '测试工程师', companyName: '丁丁公司' },
      { jobName: '测试工程师' },
      { companyName: '只有公司没有岗位' },
      { jobName: '一段很长的岗位描述。它包含句号。', companyName: '戊戊公司' },
      { jobName: '岗位', companyName: '这是一个很长的公司名，长到明显不是公司名，而是一段介绍文字。还有句号。' }
    ]
  }
};
const r3 = C.extractRecords([{ url: 'https://z/api', json: noisy }], 'applied');
assert(r3.length === 1, '重复项、缺字段项、长文本噪音都被过滤（实得 ' + r3.length + ' 条）');
assert(r3[0].company === '丁丁公司', '保留下来的正是那条干净记录');

// ---------- 4) 收藏与投递的语义区分 ----------
const favJson = { list: [{ jobName: '数据分析师', companyName: '己己集团' }] };
const fav = C.extractRecords([{ url: 'https://s/api', json: favJson }], 'collected');
assert(fav.length === 1 && fav[0].stage === 'wish', '收藏记录落到「想投」');
assert(/平台收藏/.test(fav[0].notes), '收藏记录标注了来源，便于回溯');

// ---------- 5) 时间归一化 ----------
assert(C.normalizeTime('1735689600000') === '2025-01-01', '毫秒时间戳被归一化成 YYYY-MM-DD（实得 ' + C.normalizeTime('1735689600000') + '）');
assert(C.normalizeTime('1735689600') === '2025-01-01', '秒级时间戳同样能识别');
assert(C.normalizeTime('2026/3/7') === '2026-03-07', '斜杠日期补齐月份（实得 ' + C.normalizeTime('2026/3/7') + '）');
assert(C.normalizeTime('昨天') === '', '认不出的时间返回空串，不硬猜');
const timed = C.extractRecords([{ url: 'u', json: { list: [{ jobName: '产品经理', companyName: '庚庚公司', applyTime: '2026-03-07 10:00:00' }] } }], 'applied');
assert(/投递时间：2026-03-07/.test(timed[0].notes), '投递时间写进备注，界面上能看出跟进节奏');

// ---------- 6) 边界：不该崩 ----------
assert(C.extractRecords([], 'applied').length === 0, '空响应列表返回空数组');
assert(C.extractRecords(null, 'applied').length === 0, 'null 输入返回空数组');
assert(C.extractRecords([{ url: 'u', json: '一段字符串' }], 'applied').length === 0, '纯字符串 JSON 不产出记录');
assert(C.extractRecords([{ url: 'u', json: 42 }], 'applied').length === 0, '数字 JSON 不产出记录');
assert(C.extractRecords([{ url: 'u', json: null }], 'applied').length === 0, 'null JSON 不产出记录');
assert(C.extractRecords([{ url: 'u', json: {} }], 'applied').length === 0, '空对象不产出记录');

let deep = { jobName: '深层岗位', companyName: '深层公司' };
for (let i = 0; i < 40; i++) deep = { child: deep };
let deepThrew = false;
let deepOut = [];
try { deepOut = C.extractRecords([{ url: 'u', json: deep }], 'applied'); } catch (_) { deepThrew = true; }
assert(!deepThrew, '超深嵌套不会爆栈');
assert(deepOut.length === 0, '超过深度上限的嵌套不再下探（返回空而不是误报）');

// 循环引用不能把深扫描带进死循环
const cyc = { jobName: '循环岗位', companyName: '循环公司' };
cyc.self = cyc;
let cycThrew = false;
try { C.extractRecords([{ url: 'u', json: cyc }], 'applied'); } catch (_) { cycThrew = true; }
assert(!cycThrew, '循环引用不会导致无限递归');

// ---------- 7) 多响应合并 ----------
const multi = C.extractRecords([
  { url: 'p1', json: { list: [{ jobName: '岗位A', companyName: '公司A' }] } },
  { url: 'p2', json: { list: [{ jobName: '岗位B', companyName: '公司B' }] } }
], 'applied');
assert(multi.length === 2, '多个响应（分页/多接口）合并去重后共 2 条');

console.log('\n招聘平台同步自测完成: ' + pass + ' passed, ' + failCnt + ' failed | exitCode = ' + (process.exitCode || 0));
