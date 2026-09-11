'use strict';

// ============================================================
//  「零门槛」回归守卫：内嵌模型通道（应用内模型）结构性自测
//
//  背景：embedded-llm.js 曾以经典 <script> 加载却带顶层 export / TS 注解，
//  整个文件从未执行过，window.EmbeddedLlm 一直不存在——"零门槛"名存实亡。
//  本测试守住这条线：加载形态、国内镜像、CSP 放行、默认选项、诚实文案。
// ============================================================
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

// ---------- 1) embedded-llm.js 必须是可执行的经典脚本 ----------
const emb = R('src/renderer/embedded-llm.js');

// new Function 只编译不执行 —— 语法层面证明它能作为经典 <script> 跑起来
let syntaxOk = true;
try { new Function(emb); } catch (e) { syntaxOk = false; console.log('   语法错误:', e.message); }
assert(syntaxOk, 'embedded-llm.js 可作为经典脚本编译（无顶层 export / TS 注解）');
assert(!/^\s*export\s/m.test(emb), '无顶层 export（经典脚本禁止）');
assert(!/\bas\s+any\b/.test(emb) && !/\)\s*:\s*(boolean|string|number)\b/.test(emb), '无 TS 类型注解残留');
assert(/window\.EmbeddedLlm\s*=/.test(emb), '挂载 window.EmbeddedLlm（app.js 依赖此全局）');

// ---------- 2) 国内镜像直连（huggingface 直连在国内不通，探针实测） ----------
assert(/hf-mirror\.com\/mlc-ai\/Qwen2\.5-0\.5B-Instruct-q4f16_1-MLC\/resolve\/main\//.test(emb),
  '模型权重走 hf-mirror 镜像（f16 档）');
assert(/hf-mirror\.com\/mlc-ai\/Qwen2\.5-0\.5B-Instruct-q4f32_1-MLC\/resolve\/main\//.test(emb),
  '模型权重走 hf-mirror 镜像（f32 档）');
assert(/gh-proxy\.com\/https:\/\/raw\.githubusercontent\.com\/mlc-ai\/binary-mlc-llm-libs/.test(emb),
  '模型库 wasm 走 gh-proxy 代理');
assert(/'\.\.\/\.\.\/node_modules\/@mlc-ai\/web-llm\/lib\/index\.js'/.test(emb),
  'web-llm 用相对路径动态 import（dev 与 asar 打包同构）');
assert(/mirroredAppConfig/.test(emb) && /model_lib:\s*variant\.mirrorLibUrl/.test(emb),
  'appConfig 同时改写权重与模型库两个下载地址（按所选档位）');
assert(/weightsMB:\s*276/.test(emb) && /weightsMB:\s*265/.test(emb),
  'modelInfo 标注真实下载量（f16 276MB / f32 265MB，非 500MB）');
assert(/moduleSelfTest/.test(emb), '提供 moduleSelfTest 诊断入口（不触发模型下载）');

// ---------- 2b) 显卡自动选档（q4f16 的 f16 shader 在无 shader-f16 的 GPU 上编译失败，探针实测） ----------
assert(/shader-f16/.test(emb) && /detectVariant/.test(emb),
  '按 adapter.features 检测 shader-f16 自动选档（f16 省显存 / f32 全兼容）');
assert(/VARIANTS/.test(emb) && /requiresF16/.test(emb), '双档位定义完整（VARIANTS + requiresF16 标记）');
assert(/isRetryableError/.test(emb), '重试区分错误类型（网络抖动续传，确定性失败快速失败）');

// ---------- 3) CSP 必须放行镜像源 ----------
const html = R('src/renderer/index.html');
const csp = (html.match(/Content-Security-Policy[^>]*content="([^"]+)"/) || [])[1] || '';
assert(/connect-src[^;]*hf-mirror\.com/.test(csp), 'CSP connect-src 放行 hf-mirror.com');
assert(/connect-src[^;]*gh-proxy\.com/.test(csp), 'CSP connect-src 放行 gh-proxy.com');
// hf-mirror 对 LFS 大文件 302 到 Xet CDN（cas-bridge.xethub.hf.co），跳转目标也必须在 connect-src 里
// （全链路探针实测踩过：配置能拉、权重 fetch 跟随跳转即被拦 → Failed to fetch）
assert(/connect-src[^;]*\*\.xethub\.hf\.co/.test(csp), 'CSP connect-src 放行 Xet CDN 跳转域（*.xethub.hf.co）');
assert(/script-src/.test(csp), 'CSP 显式声明 script-src（动态 import 依赖）');
// WebLLM 运行库是 wasm：script-src 缺 'wasm-unsafe-eval' 时 WebAssembly.instantiate 被 CSP 拒绝
// （全链路探针实测踩过：模型能下载、库能拉回，卡死在 instantiate）
assert(/script-src[^;]*'wasm-unsafe-eval'/.test(csp), "CSP script-src 含 'wasm-unsafe-eval'（WebAssembly 编译放行）");
assert(/wasmCompilable/.test(emb), 'embedded-llm.js 提供 wasmCompilable 运行时检测（CSP 拦截时 UI 明示原因）');

// ---------- 4) 配置弹窗：默认选应用内模型 + 诚实文案 ----------
const app = R('src/renderer/app.js');
assert(/isCloudStored \? 'cloud' : 'embedded'/.test(app), '未配置时默认选「应用内模型」（零门槛首选）');
assert(/国内镜像/.test(app) && /270-281MB/.test(app), '配置弹窗明示真实下载量区间与国内镜像');
assert(/自动选/.test(app), '配置弹窗说明按显卡自动选档（用户无需理解 f16/f32）');
assert(!/约 500MB/.test(app), '配置弹窗不再宣称 500MB');

// ---------- 5) 全站无 500MB 夸大宣称 ----------
const knowledge = R('src/main/assistant-knowledge.ts');
assert(!/500\s?MB/.test(emb + app + knowledge + html), '渲染层/知识库无 500MB 旧口径');
assert(/281MB/.test(knowledge) && /镜像/.test(knowledge), '小助手「免安装」条目更新为真实体积 + 镜像口径');

// ---------- 6) 自检钩子（打包版验证与用户自查用） ----------
const preload = R('src/main/preload.ts');
assert(/embeddedSelfTest/.test(preload) && /GRF_EMBEDDED_SELFTEST/.test(preload),
  'preload 暴露 env.embeddedSelfTest（GRF_EMBEDDED_SELFTEST=1 触发自检）');
assert(/embedded-selftest/.test(app), 'app.js 在自检模式下输出链路诊断日志');

// ---------- 7) README 双语：能力×依赖矩阵 + 措辞校准 ----------
const en = R('README.md');
const zh = R('README.zh-CN.md');
assert(/Zero-barrier/i.test(en) && /Needs a model/i.test(en), '英文 README 含能力×依赖矩阵');
assert(/零门槛起步/.test(zh) && /需要模型/.test(zh), '中文 README 含能力×依赖矩阵');
assert(/in-app model/i.test(en) && /281\s?MB/i.test(en), '英文 README 提及应用内模型与真实下载量');
assert(/应用内模型/.test(zh) && /281\s?MB/.test(zh), '中文 README 提及应用内模型与真实下载量');
assert(/hf-mirror/i.test(en) && /hf-mirror/.test(zh), '双语 README 说明国内镜像来源');

// ---------- 8) README 必须如实声明能力边界（不许只讲好话） ----------
assert(/## ⚠️ Limits/.test(en) && /## ⚠️ 能力边界/.test(zh), '双语 README 含「能力边界」章节');
assert(/lexical|词表/.test(en) && /词表/.test(zh), 'README 说明 JD 匹配是词表级而非语义级');
assert(/hiring prediction|录用概率/.test(en + zh), 'README 声明匹配分不等于录用概率');
assert(/one person|单人维护|single person/i.test(en + zh), 'README 如实说明单人维护');
assert(/macOS/.test(en) && /macOS/.test(zh), 'README 如实说明仅 Windows 平台');

// ---------- 9) 本测试挂在 npm test 上（CI 门禁） ----------
const pkg = JSON.parse(R('package.json'));
assert(/test-embedded\.js/.test(pkg.scripts.test), 'npm test 包含 test-embedded.js');

console.log('\n零门槛守卫自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
