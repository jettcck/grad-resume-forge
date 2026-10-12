const asar = require('@electron/asar');
const p = process.argv[2];
function get(name) {
  try { return asar.extractFile(p, name).toString('utf8'); }
  catch (e) {
    try { return asar.extractFile(p, name.replace(/\//g, '\\')).toString('utf8'); }
    catch (e2) { return null; }
  }
}
const pkg = get('package.json');
const js = get('dist/main/job-sync.js');
const preload = get('src/renderer/jobsync-capture-preload.js');
console.log(JSON.stringify({
  asar: p,
  version: pkg ? JSON.parse(pkg).version : '(读不到)',
  hasCdpAttach: js ? /\.debugger\.attach\s*\(/.test(js) : null,
  hasPreloadHook: js ? (/jobsync:captured/.test(js) && /capturePreloadPath/.test(js)) : null,
  revealsOnFirstPaint: js ? /revealOnFirstPaint/.test(js) : null,
  preloadPackaged: preload ? /jobsync:captured/.test(preload) : false,
  dataUrlLoadURL: js ? (js.match(/loadURL\(['"]data:/g) || []).length : null
}, null, 2));
