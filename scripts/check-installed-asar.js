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
  ['奖项合并按整行去重', has('按整行去重后追加') && has('out.awards = merged')],
  // v1.9.11：技能分隔符统一
  ['技能分隔符统一 SKILL_SEP_RE', has('SKILL_SEP_RE')],
  // v1.9.12：图标字体私用区清除
  ['私用区清除 PUA_RE', has('PUA_RE')],
  // v1.9.13：输入即刷新
  ['输入即刷新 refreshSide', has('refreshSide')],
  ['保存条「有改动未保存」', has('有改动未保存')],
  // v1.9.14：五套模板重做
  ['模板页眉包裹层 r-head', has('<div class="r-head">')],
  ['商务通栏深蓝页眉', has('.tmpl-deep .r-head') && has('linear-gradient(135deg, #16305c')],
  ['活力暖色通栏页眉', has('linear-gradient(120deg, #fff4ec')],
  ['科技顶部青蓝细条', has('.tmpl-tech::before')],
  ['极简顶部细线小节标题', has('.tmpl-minimal .r-sec-title')],
  ['经典金色细线', has('.tmpl-classic .r-head::after')],
  ['模板选择器固定三列网格', has('grid-template-columns: repeat(3')],
  // 夹具不该进安装包
  ['PDF 夹具未进安装包', !has('resume-sample-ats-classic') && !has('resume-sample-stem')]
];

checks.forEach(([name, ok]) => console.log((ok ? '  ✅ ' : '  ❌ ') + name));
const bad = checks.filter(([, ok]) => !ok).length;
console.log(bad === 0 ? '\n装机版包含本轮全部改动 ✓' : '\n有 ' + bad + ' 项缺失 ✗');
process.exitCode = bad === 0 ? 0 : 1;
