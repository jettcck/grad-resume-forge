const fs = require('fs');
const asar = require('C:/trae/resume-app/node_modules/@electron/asar');
const p = 'C:/Users/王锦楠/Desktop/grad-resume-forge/resources/app.asar';
const code = asar.extractFile(p, 'dist/main/job-sync.js').toString();
const pkg = JSON.parse(asar.extractFile(p, 'package.json').toString());
console.log(JSON.stringify({ version: pkg.version, browserView: code.includes('BrowserView'), platformContents: code.includes('platformContents'), finishLoad: code.includes('did-finish-load'), targetGuard: code.includes("p.entryUrl + '/"), appAsarSize: fs.statSync(p).size, ffmpegSize: fs.statSync('C:/Users/王锦楠/Desktop/grad-resume-forge/ffmpeg.dll').size }));
