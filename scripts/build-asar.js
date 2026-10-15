'use strict';

// ============================================================
//  打包 app.asar（桌面部署用）
//
//  组成与现有桌面 asar 完全一致：package.json + 许可证 + third-party
//  + data + src/renderer（渲染层直接加载源码）+ packages/*/dist
//  （tsc 产物）+ node_modules 运行时闭包。node_modules 不打整个目录
//  （551MB，含 electron/tsc 等开发依赖）——只打依赖闭包。
//
//  用法：
//    node scripts/build-asar.js <输出.asar路径> [参照asar路径]
//  例：
//    node scripts/build-asar.js release/app.asar "C:/.../resources/app.asar"
//  给了参照 asar 时，node_modules 精确复刻参照里的文件集合；
//  没给时按 package.json dependencies 闭包自行推导。
// ============================================================
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const ROOT = path.join(__dirname, '..');
const STAGE = path.join(ROOT, 'release', 'asar-stage');
const OUT = process.argv[2];
const REF = process.argv[3];
if (!OUT) { console.error('用法: node scripts/build-asar.js <输出.asar路径> [参照asar路径]'); process.exit(2); }

const COPY = [
  'package.json',
  'LICENSE',
  'THIRD-PARTY-NOTICES.md',
  'third-party',
  'data',
  'src/renderer',
  'dist/main',
  'packages/agent-cli/dist',
  'packages/agent-core/dist',
  'packages/llm-adapters/dist'
];
// packages/*/dist 里的 .d.ts 运行时用不到，旧 asar 也没有，跳过
const SKIP_FILE = (rel) => rel.endsWith('.d.ts');

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyRel(rel) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) { console.log('  [跳过] ' + rel + '（不存在）'); return 0; }
  const to = path.join(STAGE, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.statSync(from).isDirectory()) {
    let n = 0;
    const walk = (dir, base) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = base ? base + '/' + e.name : e.name;
        if (SKIP_FILE(r)) continue;
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else {
          fs.mkdirSync(path.dirname(path.join(to, r)), { recursive: true });
          fs.copyFileSync(path.join(dir, e.name), path.join(to, r));
          n++;
        }
      }
    };
    walk(from, '');
    console.log('  [拷贝] ' + rel + '（' + n + ' 个文件）');
    return n;
  }
  fs.copyFileSync(from, to);
  console.log('  [拷贝] ' + rel);
  return 1;
}

// node_modules 闭包：优先精确复刻参照 asar 的文件集合
function copyNodeModules() {
  let files = null;
  if (REF) {
    const list = asar.listPackage(REF).map((f) => f.replace(/\\/g, '/'));
    files = list.filter((f) => f.startsWith('/node_modules/') && !f.endsWith('/'));
    console.log('[build-asar] 参照 asar：node_modules 共 ' + files.length + ' 个文件');
  }
  if (!files) {
    // 无参照：按 dependencies 的传递闭包推导（require 链遍历太慢，直接列已知闭包）
    console.error('[build-asar] 未提供参照 asar，且未实现闭包推导——请传入参照 asar 路径');
    process.exit(2);
  }
  let n = 0, missing = 0;
  for (const f of files) {
    const rel = f.replace(/^\//, '');
    const from = path.join(ROOT, rel);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue; // 目录条目或不存在都跳过
    const to = path.join(STAGE, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    n++;
  }
  console.log('[build-asar] node_modules 拷贝 ' + n + ' 个文件' + (missing ? '，缺失 ' + missing + ' 个' : ''));
  return n;
}

console.log('[build-asar] 清理暂存目录');
rmrf(STAGE);
fs.mkdirSync(STAGE, { recursive: true });
let total = 0;
for (const rel of COPY) total += copyRel(rel);
total += copyNodeModules();
console.log('[build-asar] 共 ' + total + ' 个文件，开始打包 → ' + OUT);
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
asar.createPackage(STAGE, OUT).then(() => {
  const size = fs.statSync(OUT).size;
  console.log('[build-asar] 完成：' + OUT + '（' + (size / 1024).toFixed(1) + ' KB）');
}).catch((e) => { console.error('[build-asar] 失败:', e); process.exit(1); });
