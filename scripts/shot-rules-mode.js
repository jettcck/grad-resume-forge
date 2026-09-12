'use strict';

// 专用截图：零配置（规则）通道的优化卡片 + 运行结果
// 运行：npx electron scripts/shot-rules-mode.js --no-sandbox --disable-gpu
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (data) => ({ ok: true, data });

const engine = require(path.join(ROOT, 'dist', 'main', 'resume-engine'));
const agentReal = require(path.join(ROOT, 'dist', 'main', 'agent'));

const PROFILE = {
  name: '王锦楠', phone: '13800000000', email: 'a@b.com', city: '绵阳',
  github: 'github.com/jettcck', targetRole: '大模型 Agent 工程师',
  summary: '本人具备扎实的编程基础，积极主动认真负责',
  skills: 'Java, MySQL, Redis',
  education: [{ school: '成都理工大学工程技术学院', major: '计算机科学与技术', degree: '本科', period: '2025.09 - 至今', gpa: '3.8' }],
  internships: [],
  projects: [{
    name: '简历锻造炉', role: '独立开发', period: '2026.08 - 至今', tech: 'Electron / LLM',
    description: '本人负责整体设计，通过赋能业务实现降本增效\n参与用户模块开发，支撑日活 3 万'
  }]
};

const JD = '岗位：大模型 Agent 工程师\n任职要求：\n1. 必须熟练掌握 Python 与 LLM 应用开发；\n2. 熟悉 RAG 检索增强与向量数据库；\n加分项：了解 Docker 部署者优先。';

function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => ok(await fn(...a)));
  h('updater:status', () => ({ version: '1.6.3', isPackaged: true, updaterActive: true, repo: 'jettcck/grad-resume-forge', mirror: '' }));
  h('settings:get', () => null);
  h('settings:save', (_k, v) => v);
  h('auth:session', () => null);
  h('assistant:hot', () => []);
  h('agent:status', () => ({
    available: false, models: [], error: '',
    config: { provider: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'qwen2.5:7b', temperature: 0.3 },
    provider: 'ollama'
  }));
  h('agent:detectLocal', () => []);
  // 用真实引擎跑规则通道（不依赖任何模型）
  h('resume:generate', (p) => engine.generate(p, {}));
  h('agent:run', async (profile, jd, opts) => {
    const result = await agentReal.runAgent(profile, jd, { rulesOnly: opts && opts.mode === 'rules' });
    return result;
  });
}

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({
    width: 1280, height: 900, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'dist', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  win.show();
  await sleep(1500);

  // 伪造登录态并进入简历页
  await win.webContents.executeJavaScript(`(() => {
    document.getElementById('auth-view').style.display = 'none';
    document.getElementById('app-view').style.display = 'block';
    window.__grfTest = true;
    return true;
  })()`);
  // 通过内部状态注入档案（无登录下的最小路径）
  await win.webContents.executeJavaScript(`(() => {
    const nav = document.querySelector('.nav-item[data-route="resume"]');
    if (nav) nav.click();
    return true;
  })()`);
  await sleep(2000);
  await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('#route-resume .audit');
    if (card) card.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await sleep(800);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ROOT, 'shots', 'rules-mode-card.png'), img.toPNG());
  console.log('shot: rules-mode-card.png');
  app.exit(0);
});
