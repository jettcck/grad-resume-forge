'use strict';
// 校验装机版 app.asar 里到底有没有本次修复/新功能的关键符号。
// 中文按 UTF-8 字节查（用 latin1 读会全部漏判），每次发版后跑一遍：
//   node scripts/check-installed-asar.js
const fs = require('fs');

const asar = process.env.LOCALAPPDATA + '/Programs/grad-resume-forge/resources/app.asar';
if (!fs.existsSync(asar)) {
  console.error('找不到装机版 asar：' + asar);
  process.exit(1);
}
const buf = fs.readFileSync(asar);
const has = (t) => buf.indexOf(Buffer.from(t, 'utf8')) >= 0;

const checks = [
  // v1.9.7：PDF 解析在 Electron(20.18) 下能跑
  ['真动态 import（import(specifier)）', has('import(specifier)')],
  // v1.9.8：中文 PDF 抽取与解析质量
  ['康熙部首归一化 normalizeExtractedText', has('normalizeExtractedText')],
  ['分节关键词「实习与实践」', has('实习与实践')],
  ['角色行优先判定（注释）', has('角色行优先判断')],
  // v1.9.9：GitHub → 作品集 / 个人主页
  ['作品集格式化函数 portfolioLine', has('portfolioLine')],
  ['平台标签「掘金」', has('掘金：')],
  ['表单标签「作品集 / 个人主页」', has('作品集 / 个人主页')],
  ['导入器认得掘金链接', has('juejin\\.cn')],
  // v1.9.10：竞赛 / 奖项字段 + 完善度清单移除自我介绍
  ['表单卡片「竞赛 / 奖项荣誉」', has('竞赛 / 奖项荣誉')],
  ['渲染分节「奖项与证书」', has('奖项与证书')],
  ['完善度清单已把自我介绍移出的注释', has('一边说可以留空、一边扣你的分')],
  ['奖项合并按整行去重', has('合并按整行去重')],
  // 夹具不该进安装包
  ['PDF 夹具未进安装包', !has('resume-sample-ats-classic')]
];

checks.forEach(([name, ok]) => console.log((ok ? '  ✅ ' : '  ❌ ') + name));
const bad = checks.filter(([, ok]) => !ok).length;
console.log(bad === 0 ? '\n装机版包含本轮全部改动 ✓' : '\n有 ' + bad + ' 项缺失 ✗');
process.exitCode = bad === 0 ? 0 : 1;
