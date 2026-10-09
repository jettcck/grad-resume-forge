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
  // v1.10.0：Runtime / 评测 / 架构拆分
  ['agent-core 已打进安装包（状态机）', has('RunStateMachine')],
  ['agent-core 工具注册层', has('validateArgs') && has('idempotentHit')],
  ['agent-core 运行记录与脱敏', has('buildInputSnapshot') && has('jdDigest')],
  ['agent-core 回放能力', has('replayRun')],
  ['主进程 require agent-core 路径', has('agent-core/dist')],
  ['运行记录 IPC（取消 / 清理）', has('agent:cancel') && has('agent:clearRuns')],
  ['界面运行记录入口', has('清理运行记录') && has('最近运行记录')],
  ['防幻觉门（证据约束）', has('疑似编造技能')],
  ['llm-adapters 已打进安装包', has('llm-adapters/dist') && has('createOllamaClient')],
  ['会话 token 只存哈希（SHA-256 键）', has('createHash') && has("'sha256'")],
  ['取消能中断模型请求（AbortSignal 透传）', has('externalSignal') && has('adapter.decide(messages, opts.signal)')],
  ['重复 runId 被拒绝', has('正在使用中')],
  ['回放校验输入是否同一份', has('不是同一份')],
  ['会话与临时密钥随窗口销毁清理', has('forgetSession') && has("'destroyed'")],
  // v1.10.7：CSP 收紧 + 导航守卫（preload 一直挂在主窗口上，不能让它加载远端页面）
  ['CSP script-src 已收紧（无 unsafe-inline / data:）', has("script-src 'self' 'wasm-unsafe-eval'")],
  ['CSP style-src 仍保留 unsafe-inline（内联样式需要）', has("style-src 'self' 'unsafe-inline'")],
  ['导航守卫 will-navigate', has('will-navigate') && has('[nav-blocked]')],
  ['新窗口守卫 setWindowOpenHandler', has('setWindowOpenHandler') && has('[window-open-blocked]')],
  // v1.11.0：投递地点与距离（离线直线距离对比 + 可选在线地图）
  ['城市/区县坐标表已打进安装包', has('CityGeo') && has('北京|朝阳')],
  ['距离与坐标解析模块', has('haversineKm') && has('parseLocation') && has('formatDistance')],
  ['坐标系换算（WGS-84 ⇄ GCJ-02）', has('wgs84ToGcj02') && has('needsGcjOffset')],
  ['离线相对位置图', has('buildCompareSvg') && has('mv-svg')],
  ['地图视图模块', has('MapView') && has('mv-map-canvas')],
  ['瓦片走主进程代理（CSP 无需放宽）', has('map:tile') && has('map:setCustomSource') && has('data:image/png;base64,')],
  ['瓦片代理 SSRF 守卫', has('isBlockedHost') && has('assertAllowedHop') && has('validateTemplate')],
  ['内置瓦片源（OSM + 高德，含版权署名）', has('tile.openstreetmap.org') && has('is.autonavi.com')],
  ['在线地图默认源为高德（OSM 国内实测不可达）', has("tiles.sourceId || 'amap'")],
  ['第三方数据许可声明随包分发', has('木兰宽松许可证')],
  ['agent-cli 已打进安装包', has('agent-cli/dist')],
  // 夹具不该进安装包
  ['PDF 夹具未进安装包', !has('resume-sample-ats-classic') && !has('resume-sample-stem')]
];

checks.forEach(([name, ok]) => console.log((ok ? '  ✅ ' : '  ❌ ') + name));
const bad = checks.filter(([, ok]) => !ok).length;
console.log(bad === 0 ? '\n装机版包含本轮全部改动 ✓' : '\n有 ' + bad + ' 项缺失 ✗');
process.exitCode = bad === 0 ? 0 : 1;
