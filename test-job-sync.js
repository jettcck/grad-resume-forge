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
const fs = require('fs');

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
assert(P.every((p) => p.id && p.name && p.entryUrl), '每个平台都有 id / 名称 / 入口地址');
assert(P.every((p) => p.syncable ? !!p.recordHint : true), '声明可同步的平台都给了「去哪找记录」的人工指引');
assert(P.every((p) => p.syncable ? true : !!p.recordHint), '不可同步的平台也说明了原因（不静默留空）');
// 关键回归：入口一律是平台首页，刻意不再硬编码会 404 的「投递记录」深链接
// （2026-10-11 实测：zhipin /web/geek/job/apply → 302 到 404，写死深链接=白屏）
assert(P.every((p) => /^https:\/\/[^/]+\/?$/.test(p.entryUrl)), '入口统一是平台首页（不写会失效的记录页深链接）');
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
assert(C.normalizeTime('1735689600000') === '2025-01-01', '毫秒时间戳被归一化成 YYYY-MM-DD（实得 ' + C.normalizeTime('1735689600000') + '）');assert(C.normalizeTime('1735689600') === '2025-01-01', '秒级时间戳同样能识别');
assert(C.normalizeTime('2026/3/7') === '2026-03-07', '斜杠日期补齐月份（实得 ' + C.normalizeTime('2026/3/7') + '）');
assert(C.normalizeTime('昨天') === '', '认不出的时间返回空串，不硬猜');
// 本地日期回归：清晨（UTC 还是前一天）的投递不许被算成前一天 ——
// 曾经用 toISOString（UTC），用户看到「投递时间：昨天」以为数据错了。
// 注意：必须用「本地时间」构造时间戳，不能写死 epoch——写死只在东八区成立，
// CI 是 UTC 会误挂。new Date(y,m,d,...) 按运行时本地时区构造，任何时区下
// normalizeTime 都应返回构造时的那个本地日期。
const earlyMorning = new Date(2026, 9, 13, 0, 30, 0); // 本地 2026-10-13 00:30
const earlyMorningMs = String(earlyMorning.getTime());
assert(C.normalizeTime(earlyMorningMs) === '2026-10-13', '清晨投递按本地日期归一化（实得 ' + C.normalizeTime(earlyMorningMs) + '）');
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

// ---------- 8) 同公司多岗位不许被去重误伤（用户实机疑问：两个「来人送」） ----------
const two = C.extractRecords([
  { url: 'u', json: { list: [
    { jobName: '配送员(蜂鸟即配)', companyName: '来人送', encryptJobId: 'j1' },
    { jobName: '站点直招配送员', companyName: '来人送', encryptJobId: 'j2' }
  ] } }
], 'applied');
assert(two.length === 2, '同公司两个不同岗位是两条记录（实得 ' + two.length + '）——岗位名不同不算重复');

// ---------- 9) store 层：同 id 重复记录自愈 + importAuthorized 不再双重插入 ----------
// 背景：importAuthorized 曾在 saveApplication 内部 unshift 后又对同一数组引用
// unshift 一次 → 同 id 记录成对出现，删除按 id 过滤一次删两条（用户实测踩过）。
const os = require('os');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-store-'));
const store = require(path.join(__dirname, 'dist/main/store'));
store.init(tmpDir);
const uid = 'u_dedup_' + Date.now();
// 模拟历史坏库：同 id 两条
const badList = [
  { id: 'dup_1', company: '九维星汉', position: '初级java', stage: 'wish', createdAt: 1, updatedAt: 1 },
  { id: 'dup_1', company: '九维星汉', position: '初级java', stage: 'wish', createdAt: 1, updatedAt: 1 },
  { id: 'ok_1', company: '来人送', position: '配送员A', stage: 'wish', createdAt: 2, updatedAt: 2 }
];
// 直接通过导出的 API 构造坏数据：save 两条后手动把同 id 记录塞回去再重载不可行
// （store 不导出原始 load），改为验证行为不变量：save→list 无重复、delete 按 id 只删该条。
const saved1 = store.saveApplication(uid, { company: '来人送', position: '配送员A', stage: 'wish' });
const saved2 = store.saveApplication(uid, { company: '来人送', position: '配送员B', stage: 'wish' });
const listed = store.listApplications(uid);
const listIds = listed.map((a) => a.id);
assert(new Set(listIds).size === listIds.length, '连续新增两条后列表内无重复 id');
assert(listed.length === 2, '新增两条列表就是两条（实得 ' + listed.length + '）——不再双重插入');
store.deleteApplication(uid, saved1.id);
const afterDel = store.listApplications(uid);
assert(afterDel.length === 1 && afterDel[0].id === saved2.id, '删除一条只少一条，另一条健在（实得 ' + afterDel.length + ' 条）');
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }

// ---------- N) BOSS recommend 多页签过滤（收藏=感兴趣 tab=48，不混入沟通 tab=148） ----------
// 回归背景：BOSS /web/geek/recommend 是多页签页面，tab=148 沟通（含已投递）、tab=48 感兴趣（收藏）。
// 旧实现不区分页签，抓取收藏时把沟通页签的公司混了进来。
const bossBodies = [
  { url: 'https://www.zhipin.com/web/geek/recommend?tab=48&sub=1', json: { zpData: { list: [{ jobName: 'A岗', companyName: '感兴趣公司' }] } } },
  { url: 'https://www.zhipin.com/web/geek/recommend?tab=148&sub=1', json: { zpData: { list: [{ jobName: 'B岗', companyName: '沟通公司' }] } } }
];
assert(C.bossTabOf('https://www.zhipin.com/web/geek/recommend?tab=48&sub=1') === '48', 'bossTabOf 解析出 tab=48');
assert(C.bossTabOf('https://www.zhipin.com/web/geek/recommend') === '', 'bossTabOf 无 tab 参数返回空串');
const favOnly = C.filterBodiesByTab('boss', 'collected', bossBodies);
assert(favOnly.length === 1, '抓取收藏时缓冲只保留 tab=48 的响应（实得 ' + favOnly.length + ' 条）');
const favRecs = C.extractRecords(favOnly, 'collected');
assert(favRecs.length === 1 && favRecs[0].company === '感兴趣公司', 'BOSS 抓取收藏只出「感兴趣」公司，不混入沟通页签');
const appOnly = C.filterBodiesByTab('boss', 'applied', bossBodies);
const appRecs = C.extractRecords(appOnly, 'applied');
assert(appRecs.length === 1 && appRecs[0].company === '沟通公司', '抓取沟通时只出 tab=148 的公司，不混入感兴趣页签');
// 非 BOSS 平台不做过滤（不误伤其他平台的响应）
const other = C.filterBodiesByTab('liepin', 'collected', bossBodies);
assert(other.length === 2, '非 BOSS 平台不做页签过滤（实得 ' + other.length + ' 条）');

console.log('\n招聘平台同步自测完成: ' + pass + ' passed, ' + failCnt + ' failed | exitCode = ' + (process.exitCode || 0));
