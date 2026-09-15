'use strict';

// 作品集 / 个人主页字段自测
//
// 背景：这个字段原来叫「GitHub」，但国内简历里掘金、知乎、站酷、小红书、公众号、
// 个人网站比 GitHub 常见得多。现在按域名自动认平台并补标签，导出成
// 「掘金：juejin.cn/user/x」而不是一行光秃秃的网址；也支持多条链接。
//
// 这里直接把 src/renderer/template.js 跑在 vm 里（不是复制一份逻辑），
// 所以只要格式化函数退化，本测试就会红。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

const src = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'template.js'), 'utf8');
const sandbox = { window: { UI: { esc: (s) => String(s == null ? '' : s) } }, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const T = sandbox.window.Template;
const line = T.portfolioLine;
const render = T.renderResumeInner;

// ---------- 1) 各平台按域名认出来 ----------
const platformCases = [
  ['github.com/liming', 'GitHub：github.com/liming'],
  ['https://github.com/liming/', 'GitHub：github.com/liming'],
  ['gitee.com/liming', 'Gitee：gitee.com/liming'],
  ['juejin.cn/user/12345', '掘金：juejin.cn/user/12345'],
  ['zhihu.com/people/liming', '知乎：zhihu.com/people/liming'],
  ['zcool.com.cn/u/888', '站酷：zcool.com.cn/u/888'],
  ['bilibili.com/123456', 'B站：bilibili.com/123456'],
  ['xiaohongshu.com/user/profile/abc', '小红书：xiaohongshu.com/user/profile/abc'],
  ['blog.csdn.net/liming', 'CSDN：blog.csdn.net/liming'],
  ['yuque.com/liming/resume', '语雀：yuque.com/liming/resume']
];
platformCases.forEach(([input, expect]) => {
  assert(line(input) === expect, '平台识别：' + input + ' → ' + line(input));
});

// 不认识的域名也算作品集（不能因为不是 GitHub 就不给标签）
assert(line('mysite.dev/portfolio') === '作品集：mysite.dev/portfolio', '未知域名兜底为「作品集：」');

// ---------- 2) 用户自己写了标签的，尊重原标题 ----------
assert(line('作品集：财务分析报告 3 份') === '作品集：财务分析报告 3 份', '纯文本带标签原样保留');
assert(line('掘金：juejin.cn/user/1') === '掘金：juejin.cn/user/1', '用户已写标签时不重复加平台名');
assert(line('暂无') === '暂无', '非链接纯文本原样保留');

// ---------- 3) 多条链接 ----------
assert(line('github.com/a, juejin.cn/user/b') === 'GitHub：github.com/a | 掘金：juejin.cn/user/b',
  '逗号分隔的多条链接各自带标签');
assert(line('github.com/a、zhihu.com/people/b') === 'GitHub：github.com/a | 知乎：zhihu.com/people/b',
  '顿号分隔同样生效');
assert(line('github.com/a juejin.cn/user/b zcool.com.cn/u/c') ===
  'GitHub：github.com/a | 掘金：juejin.cn/user/b | 站酷：zcool.com.cn/u/c', '空格分隔三条');

// ---------- 4) 上限与空值 ----------
const four = line('github.com/a, gitee.com/b, juejin.cn/user/c, zhihu.com/people/d');
assert((four.match(/\|/g) || []).length === 2, '最多展示 3 条（超出不再拼接，避免联系方式行挤爆）');
assert(line('') === '' && line('   ') === '' && line(null) === '' && line(undefined) === '',
  '留空返回空串（导出时该字段整段省略，不会出现空标签）');

// ---------- 5) 渲染链路真的用上了这个格式化 ----------
const resume = {
  basics: { name: '李明', phone: '13800000000', email: 'liming@example.com', city: '杭州', github: 'juejin.cn/user/12345' },
  summary: '', skills: '', education: [], internships: [], projects: []
};
const html = render(resume, 'classic');
assert(html.includes('掘金：juejin.cn/user/12345'), '简历渲染的联系方式行带上平台标签');
assert(!html.includes('>juejin.cn/user/12345<'), '不再是光秃秃的裸网址');
const emptyHtml = render(Object.assign({}, resume, { basics: Object.assign({}, resume.basics, { github: '' }) }), 'classic');
assert(!/作品集：|GitHub：/.test(emptyHtml), '留空时联系方式行不出现任何作品集标签');

// ---------- 6) 竞赛 / 奖项渲染（同一份模板代码，顺带守住） ----------
const withAwards = Object.assign({}, resume, {
  awards: ['全国大学生数学建模竞赛 省级二等奖 2024', '校级三好学生 2023']
});
const awardsHtml = render(withAwards, 'classic');
assert(awardsHtml.includes('奖项与证书'), '简历渲染出「奖项与证书」分节');
assert(awardsHtml.includes('全国大学生数学建模竞赛 省级二等奖 2024'), '奖项逐条渲染（原样，不润色）');
assert(awardsHtml.includes('校级三好学生 2023'), '多条奖项都渲染');
assert(!render(resume, 'classic').includes('奖项与证书'), '没有奖项时不渲染空分节（不留空标题）');

console.log('\n作品集字段自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
