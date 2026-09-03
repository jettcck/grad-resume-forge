'use strict';

// ============================================================
//  本地构建补丁固化
//  背景：国内网络下 electron-builder 的本地构建会连环失败——
//    1) winCodeSign 等二进制从 GitHub 下载超时
//    2) 镜像包内的 darwin 符号链接在 Windows 非管理员下解压必炸
//    3) app-builder(Go) 内置 sha512 校验，消毒包过不了
//  解法：给 app-builder-lib 打两个运行时补丁（rcedit 直调本地 exe、
//    winCodeSign 本地目录复用），配合 .local-bin/ 本地二进制源。
//  本脚本把补丁写入 node_modules，幂等（重复执行无副作用）。
//  npm install / 依赖重装后需要重跑：npm run dist:local 会自动调用。
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function log(ok, msg) {
  console.log((ok ? '✅' : '❌') + ' ' + msg);
  ok ? pass++ : fail++;
}

function patch(file, marker, patchCode) {
  const p = path.join(ROOT, 'node_modules', file);
  if (!fs.existsSync(p)) { log(false, '缺文件 ' + file + '（先 npm install）'); return; }
  let src = fs.readFileSync(p, 'utf8');
  if (src.includes(marker)) { log(true, '已打补丁 ' + file); return; }
  const patched = patchCode(src);
  if (!patched || patched === src) { log(false, '补丁注入失败 ' + file); return; }
  fs.writeFileSync(p, patched, 'utf8');
  log(true, '补丁写入 ' + file);
}

// ---- 补丁 1：binDownload.js —— winCodeSign 本地目录复用 ----
// 场景：WINCODESIGN_LOCAL_DIR 指向手动解压好的目录时跳过下载。
patch(
  'app-builder-lib/out/binDownload.js',
  'WINCODESIGN_LOCAL_DIR',
  (src) => src.replace(
    'function getBin(name, url, checksum) {',
    `function getBin(name, url, checksum) {
    // [local-patch] winCodeSign 本地目录复用（绕过下载与符号链接问题）
    if (name === "winCodeSign" && process.env.WINCODESIGN_LOCAL_DIR) {
        const fs = require("fs");
        if (fs.existsSync(process.env.WINCODESIGN_LOCAL_DIR)) {
            return Promise.resolve(process.env.WINCODESIGN_LOCAL_DIR);
        }
    }`
  )
);

// ---- 补丁 2：winPackager.js —— rcedit 直调本地 exe ----
// 场景：RCEDIT_LOCAL_EXE 指向本地 rcedit-x64.exe 时直调，
// 绕过 app-builder 内部的下载（内置 sha512 校验绕不过）。
patch(
  'app-builder-lib/out/winPackager.js',
  'RCEDIT_LOCAL_EXE',
  (src) => src.replace(
    `        if (process.platform === "win32" || process.platform === "darwin") {
            await (0, builder_util_1.executeAppBuilder)(["rcedit", "--args", JSON.stringify(args)], undefined /* child-process */, {}, 3 /* retry three times */);
        }`,
    `        if (process.platform === "win32" || process.platform === "darwin") {
            // [local-patch] rcedit 直调本地 exe（绕过 app-builder 下载）
            if (process.env.RCEDIT_LOCAL_EXE && require("fs").existsSync(process.env.RCEDIT_LOCAL_EXE)) {
                const cp = require("child_process");
                await new Promise((resolve, reject) => {
                    cp.execFile(process.env.RCEDIT_LOCAL_EXE, args, { timeout: 60000 }, (err, _so, se) => {
                        if (err) reject(new Error("rcedit failed: " + err.message + " " + se));
                        else resolve();
                    });
                });
            }
            else {
                await (0, builder_util_1.executeAppBuilder)(["rcedit", "--args", JSON.stringify(args)], undefined /* child-process */, {}, 3 /* retry three times */);
            }
        }`
  )
);

// ---- 环境自检：本地二进制源就绪性 ----
const binRoot = path.join(ROOT, '.local-bin');
const needs = [
  ['nsis-3.0.4.1/nsis-3.0.4.1.7z', 'nsis 3.0.4.1'],
  ['nsis-resources-3.4.1/nsis-resources-3.4.1.7z', 'nsis-resources 3.4.1']
];
let binOk = true;
needs.forEach(([rel, label]) => {
  const ok = fs.existsSync(path.join(binRoot, rel));
  if (!ok) binOk = false;
  log(ok, '本地二进制 ' + label + (ok ? '' : ' 缺失（npm run dist:local 首次会自动从 npmmirror 下载）'));
});

console.log('');
if (fail > 0) {
  console.log('❌ 补丁 ' + fail + ' 项失败');
  process.exit(1);
}
console.log('✅ 补丁全部就绪（' + pass + ' 项）');
