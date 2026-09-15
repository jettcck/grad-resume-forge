'use strict';
// 校验装机版 app.asar 里到底有没有 v1.9.8 的导入修复（中文按 UTF-8 字节查，别用 latin1）
const fs = require('fs');
const asar = process.env.LOCALAPPDATA + '/Programs/grad-resume-forge/resources/app.asar';
const buf = fs.readFileSync(asar);
const has = (t) => buf.indexOf(Buffer.from(t, 'utf8')) >= 0;

const checks = [
  ['康熙部首归一化函数 normalizeExtractedText', has('normalizeExtractedText')],
  ['分节关键词「实习与实践」', has('实习与实践')],
  ['分节关键词「奖项与证书」', has('奖项与证书')],
  ['角色行优先判定（注释）', has('角色行优先判断')],
  ['真动态 import（import(specifier)）', buf.indexOf(Buffer.from('import(specifier)', 'utf8')) >= 0],
  // v1.9.9：GitHub → 作品集/个人主页
  ['作品集格式化函数 portfolioLine', has('portfolioLine')],
  ['平台标签「掘金」', has('掘金：')],
  ['表单标签「作品集 / 个人主页」', has('作品集 / 个人主页')],
  ['导入器认得掘金链接', has('juejin\\.cn')],
  ['PDF 夹具未进安装包', !has('resume-sample-ats-classic')]
];
checks.forEach(([name, ok]) => console.log((ok ? '  ✅ ' : '  ❌ ') + name));
const bad = checks.filter(([, ok]) => !ok).length;
console.log(bad === 0 ? '\n装机版包含全部导入修复 ✓' : '\n有 ' + bad + ' 项缺失 ✗');
process.exitCode = bad === 0 ? 0 : 1;
