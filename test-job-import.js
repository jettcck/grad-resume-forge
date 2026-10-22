'use strict';

// ============================================================
//  粘贴导入回归测试
//
//  守三件事：
//    1. 从各平台真实粘贴格式里能正确抽出 公司 / 岗位 / 城市·区 / 薪资 / 链接
//       —— 抽错字段比抽不到更糟，用户会带着错误信息去投递
//    2. 认不出就说认不出：绝不把无关文本编成岗位名（这条是硬要求）
//    3. 批量粘贴能切出多条，且字段不串（第 2 条的公司名不能跑到第 1 条上）
//
//  纯本地解析，无网络、无 Electron。语料按平台真实排版写。
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

// ---------- 搭环境：真实加载 city-geo.js / geo.js / job-import.js ----------
const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
// job-import.js 载入时会取 UI.el；解析逻辑不需要真的 UI，给个最小替身
sandbox.window.UI = {
  el: () => ({ appendChild() {}, addEventListener() {}, setAttribute() {} }),
  toast: () => {}, call: () => Promise.resolve(null), modalTextarea: () => Promise.resolve(null)
};
vm.createContext(sandbox);
for (const f of ['city-geo.js', 'geo.js', 'job-import.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'src', 'renderer', f), 'utf-8'), sandbox, { filename: f });
}
const JI = sandbox.window.JobImport;
assert(!!JI && typeof JI.parse === 'function', 'job-import.js 能在浏览器语义下加载并导出 parse');

const one = (text) => {
  const r = JI.parse(text);
  return r.candidates.length === 1 ? r.candidates[0] : null;
};

// ---------- 1) BOSS直聘 列表卡片 ----------
const bossCard = `Java开发工程师
15-25K
北京·朝阳区
3-5年
本科`;
const c1 = one(bossCard);
assert(!!c1, 'BOSS 卡片能解析出 1 条');
assert(c1.position === 'Java开发工程师', '岗位名抓对（实得 ' + c1.position + '）');
assert(c1.salary === '15-25K', '薪资抓对（实得 ' + c1.salary + '）');
assert(c1.place === '北京朝阳', '城市·区抓对（实得 ' + c1.place + '）');
assert(c1.cityKey === undefined || c1.city === '北京', '城市归一化到「北京」（实得 ' + c1.city + '）');
assert(c1.education === '本科', '学历抓对（实得 ' + c1.education + '）');
assert(c1.experience === '3-5年', '经验抓对（实得 ' + c1.experience + '）');

// ---------- 2) BOSS直聘 详情页（含大段 JD 正文，不能把正文当岗位名） ----------
const bossDetail = `Java开发工程师
北京 朝阳区
15-25K·14薪
本科及以上
3-5年
某某科技有限公司
互联网
已上市
1000-9999人
职位描述
1、负责后端服务开发，保障高并发下的稳定性；
2、参与系统架构设计。
任职要求
熟悉 Java、Spring、MySQL`;
const c2 = one(bossDetail);
assert(!!c2, '详情页能解析出 1 条');
assert(c2.position === 'Java开发工程师', '详情页岗位名不被 JD 正文抢走（实得 ' + c2.position + '）');
assert(c2.company === '某某科技有限公司', '详情页公司名抓对（实得 ' + c2.company + '）');
assert(c2.salary === '15-25K·14薪', '带「·14薪」的薪资抓对（实得 ' + c2.salary + '）');
assert(c2.place === '北京朝阳', '详情页地点抓对（实得 ' + c2.place + '）');
assert(c2.notes.length === 0 || !/公司名是推断/.test(c2.notes.join()), '公司名是识别到的，不该被标成「推断」');

// ---------- 3) 智联招聘（「万」为单位的薪资 + 短横线城市） ----------
const zhaopin = `Java开发工程师
1.5-2.5万
北京-朝阳区
3-5年
本科
某某网络科技有限公司`;
const c3 = one(zhaopin);
assert(!!c3, '智联格式能解析出 1 条');
assert(c3.salary === '1.5-2.5万', '「万」单位薪资抓对（实得 ' + c3.salary + '）');
assert(c3.place === '北京朝阳', '短横线城市格式抓对（实得 ' + c3.place + '）');
assert(c3.company === '某某网络科技有限公司', '公司名抓对（实得 ' + c3.company + '）');

// ---------- 4) 分享文本格式：岗位_城市-区_薪资 + 公司 + 平台 ----------
const share = `【Java开发工程师_北京-朝阳区_15-25K】某某科技有限公司 - BOSS直聘
https://www.zhipin.com/job_detail/abc123.html`;
const c4 = one(share);
assert(!!c4, '分享文本能解析出 1 条');
assert(c4.position === 'Java开发工程师', '分享格式岗位名抓对（实得 ' + c4.position + '）');
assert(c4.place === '北京朝阳', '分享格式地点抓对（实得 ' + c4.place + '）');
assert(c4.company === '某某科技有限公司', '分享格式公司名抓对（实得 ' + c4.company + '）');
assert(c4.platform === 'BOSS直聘', '平台识别为 BOSS直聘（实得 ' + c4.platform + '）');
assert(/^https:\/\/www\.zhipin\.com\//.test(c4.url), '链接抓对（实得 ' + c4.url.slice(0, 40) + '）');

// ---------- 5) 实习僧（元/天） ----------
const shixiseng = `前端开发实习生
200-300元/天
北京
本科
某某信息技术有限公司
https://www.shixiseng.com/intern/xyz`;
const c5 = one(shixiseng);
assert(!!c5, '实习岗能解析出 1 条');
assert(c5.salary === '200-300元/天', '「元/天」薪资抓对（实得 ' + c5.salary + '）');
assert(c5.platform === '实习僧', '平台识别为实习僧（实得 ' + c5.platform + '）');

// ---------- 6) 批量：空行分隔两条，字段不串 ----------
const bulk = `Java开发工程师
15-25K
北京·朝阳区
甲甲科技有限公司

产品经理
20-30K
杭州·西湖区
乙乙网络有限公司`;
const rb = JI.parse(bulk);
assert(rb.candidates.length === 2, '批量粘贴切出 2 条（实得 ' + rb.candidates.length + '）');
assert(rb.candidates.every((c) => typeof c.raw === 'string' && c.raw.length > 0),
  '每个候选都带自己的原文 raw（多岗位入池时各存各的 JD）');
assert(rb.candidates[0].raw.indexOf('甲甲科技') >= 0 && rb.candidates[1].raw.indexOf('乙乙网络') >= 0,
  'raw 未跨岗位串文本');
if (rb.candidates.length === 2) {
  assert(rb.candidates[0].company === '甲甲科技有限公司' && rb.candidates[1].company === '乙乙网络有限公司',
    '两条的公司名没有串位（实得 ' + rb.candidates[0].company + ' / ' + rb.candidates[1].company + '）');
  assert(rb.candidates[0].place === '北京朝阳' && rb.candidates[1].place === '杭州西湖',
    '两条的地点各自正确（实得 ' + rb.candidates[0].place + ' / ' + rb.candidates[1].place + '）');
  assert(rb.candidates[0].position === 'Java开发工程师' && rb.candidates[1].position === '产品经理',
    '两条的岗位名各自正确');
}

// ---------- 7) 诚实性：认不出就认不出，绝不编造 ----------
const junk = '你好，这是一段普通文字，跟我聊聊天吧';
const rj = JI.parse(junk);
assert(rj.candidates.length === 0, '无关文本不产出候选（实得 ' + rj.candidates.length + ' 条）');
assert(/没认出/.test(rj.warning), '无关文本给出明确提示而不是静默或硬猜');
assert(JI.parse('').candidates.length === 0, '空输入不产出候选');
assert(JI.parse('   \n\n  ').candidates.length === 0, '纯空白不产出候选');
const randomNum = JI.parse('12345\n67890\n00000');
assert(randomNum.candidates.length === 0, '纯数字不产出候选（不会把数字当岗位名）');

// 只有公司名也要能导入（用户就想顺手记一条），但要提示缺地点
const onlyCo = one('某某科技有限公司');
assert(!!onlyCo && onlyCo.company === '某某科技有限公司', '只给公司名也能导入');
assert(/工作地点/.test(onlyCo.notes.join('')), '缺地点时明确提示（否则用户以为距离算错了）');

// ---------- 8) 显式前缀优先于推断 ----------
const explicit = `岗位：算法工程师
公司：某某智能科技有限公司
工作地点：杭州·余杭
薪资：30-50K·16薪`;
const c8 = one(explicit);
assert(!!c8, '带「字段：值」前缀的能解析');
assert(c8.position === '算法工程师', '显式岗位名优先（实得 ' + c8.position + '）');
assert(c8.company === '某某智能科技有限公司', '显式公司名优先（实得 ' + c8.company + '）');
assert(c8.place === '杭州余杭', '显式地点优先（实得 ' + c8.place + '）');
assert(c8.level.position === 'explicit' && c8.level.company === 'explicit', '显式字段被标为「原文」而不是「推断」');

// ---------- 9) 不会把公司名当成地点 ----------
const cityInName = one(`Java开发工程师
15-25K
北京中科某某科技有限公司`);
assert(!!cityInName, '公司名里含城市名时仍能解析');
assert(cityInName.company === '北京中科某某科技有限公司', '公司名没被当成地点吞掉（实得 ' + cityInName.company + '）');

// ---------- 10) 多平台域名识别 ----------
assert(JI._internal.platformOf('https://www.zhaopin.com/job/1') === '智联招聘', 'zhaopin.com → 智联招聘');
assert(JI._internal.platformOf('https://we.51job.com/pc/search') === '前程无忧', '51job.com → 前程无忧');
assert(JI._internal.platformOf('https://www.liepin.com/job/1') === '猎聘', 'liepin.com → 猎聘');
assert(JI._internal.platformOf('https://www.iguopin.com/job/1') === '国聘', 'iguopin.com → 国聘');
assert(JI._internal.platformOf('https://example.com/job/1') === '', '不认识的域名不硬贴平台名');

console.log('\n粘贴导入自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
