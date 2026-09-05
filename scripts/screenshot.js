'use strict';

// ============================================================
//  UI 截图管线：启动真实渲染器（自带最小 IPC 集），预置演示账号与档案，
//  逐页截图到 shots/ —— 供界面重设计前后对比。
//  运行：npx electron scripts/screenshot.js --no-sandbox --disable-gpu
// ============================================================
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'shots');

const store = require(path.join(ROOT, 'dist/main/store'));
const auth = require(path.join(ROOT, 'dist/main/auth'));
const engine = require(path.join(ROOT, 'dist/main/resume-engine'));
const { createLlmClient } = require(path.join(ROOT, 'dist/main/llm-client'));
const secure = require(path.join(ROOT, 'dist/main/secure-store'));

const DEMO_EMAIL = 'shot@demo.local';
const DEMO_PASSWORD = 'demo123456';

const DEMO_PROFILE = {
  name: '李明', phone: '13812345678', email: 'liming@example.com', city: '杭州',
  github: 'github.com/liming', targetRole: '后端开发工程师', summary: '',
  skills: 'Java, Go, MySQL, Redis, Kafka, 数据结构, 计算机网络, Git, Linux, Docker',
  education: [{
    school: '浙江大学', major: '计算机科学与技术', degree: '本科',
    period: '2021.09 - 2025.06', gpa: '3.8/4.0',
    courses: '数据结构、操作系统、计算机网络、数据库原理'
  }],
  internships: [{
    name: '字节跳动', role: '后端开发实习生', period: '2024.06 - 至今', tech: 'Go / MySQL / Redis',
    description: '负责订单系统查询优化，P99 从 800ms 降到 120ms\n参与用户模块开发，支撑日活 3 万'
  }],
  projects: [
    {
      name: '分布式短链服务', role: '核心开发', period: '2024.01 - 2024.05', tech: 'Go / Redis / Kafka',
      description: '设计短链算法，QPS 提升 5 倍\n使用多级缓存优化查询，P99 降到 80ms'
    },
    {
      name: '高并发秒杀系统', role: '独立开发', period: '2023.09 - 2023.12', tech: 'Java / Spring Cloud',
      description: '实现库存预扣与异步下单，支撑 5000 QPS\n用压测定位瓶颈，吞吐提升 3 倍'
    }
  ]
};

const DEMO_APPS = [
  { company: '腾讯', position: '后端开发工程师', stage: 'interview' },
  { company: '阿里巴巴', position: 'Java 开发', stage: 'applied' },
  { company: '网易', position: '服务端开发', stage: 'applied' },
  { company: '拼多多', position: '后端开发', stage: 'wish' },
  { company: '美团', position: '后端开发工程师', stage: 'wish' }
];

const ok = (d) => ({ ok: true, data: d });
const fail = (e) => ({ ok: false, error: String((e && e.message) || e) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => {
    try { return ok(await fn(...args)); } catch (err) { return fail(err); }
  });
  h('auth:register', (p) => auth.register(p));
  h('auth:login', (p) => auth.login(p));
  h('auth:session', () => null);
  h('auth:logout', () => ({ ok: true }));
  h('profile:get', (uid) => store.getProfile(uid));
  h('profile:save', (uid, p) => store.saveProfile(uid, p));
  h('applications:list', (uid) => store.listApplications(uid));
  h('applications:save', (uid, a) => store.saveApplication(uid, a));
  h('applications:delete', (uid, id) => store.deleteApplication(uid, id));
  h('resume:generate', (p, o) => engine.generate(p, o || {}));
  h('agent:status', async () => {
    const c = createLlmClient(store.getSetting('agent') || {});
    return { ...(await c.status()), config: c.config, provider: c.provider };
  });
  h('settings:get', () => null);
  h('settings:save', (_k, v) => v);
  h('updater:status', () => ({ version: '1.1.0', isPackaged: false, updaterActive: false, repo: 'jettcck/grad-resume-forge', mirror: '' }));
  h('clipboard:writeText', () => ({ done: true }));
  h('shell:openExternal', (u) => ({ opened: u }));
}

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG());
  console.log('  📸', name);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  store.init(app.getPath('userData'));
  registerIpc();

  // ---- safeStorage 真实 DPAPI 往返断言（Electron 环境）----
  {
    const t = (c, m) => console.log((c ? '✅' : '❌') + ' [secure] ' + m);
    if (secure.isAvailable()) {
      const enc = secure.encryptString('sk-roundtrip-test');
      t(enc.startsWith('enc:v1:'), '加密产出 enc:v1: 密文');
      t(enc !== 'sk-roundtrip-test', '密文不含明文');
      t(secure.decryptString(enc) === 'sk-roundtrip-test', 'DPAPI 加解密往返一致');
      t(secure.decryptString('legacy-plain-key') === 'legacy-plain-key', '旧明文向前兼容');
    } else {
      t(false, 'safeStorage 在此环境不可用（DPAPI 缺失？）');
    }
  }

  // 预置演示账号 + 档案 + 投递记录（渲染器走正常登录流程进入）
  try { auth.register({ email: DEMO_EMAIL, password: DEMO_PASSWORD, name: '李明' }); } catch (_) {} // eslint-disable-line no-empty
  const user = store.findUserByEmail(DEMO_EMAIL);
  store.saveProfile(user.id, DEMO_PROFILE);
  DEMO_APPS.forEach((a) => store.saveApplication(user.id, a));

  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'dist/main/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  win.removeMenu();
  await win.loadFile(path.join(ROOT, 'src/renderer/index.html'));
  win.show();
  await sleep(2000); // 字体 + 入场动画

  await shot(win, '01-auth');

  // 认证页设计断言
  console.log(await verify(win, `(() => {
    const gs = (el, p) => getComputedStyle(el, p || null);
    const out = [];
    const t = (n, c) => out.push((c ? '✅' : '❌') + ' ' + n);
    const pw = document.querySelector('.poster-word');
    t('海报描边回声(data-text)', pw && gs(pw, '::before').content.includes('FORGE'));
    t('噪点作用域(auth-view)', gs(document.querySelector('.auth-view'), '::after').backgroundImage.includes('svg'));
    t('PDF安全:body无装饰', gs(document.body, '::after').backgroundImage === 'none');
    return out.join('\\n');
  })()`));

  // 登录进入主应用
  await win.webContents.executeJavaScript(`(() => {
    const f = document.getElementById('auth-form');
    f.querySelector('input[name="email"]').value = '${DEMO_EMAIL}';
    f.querySelector('input[name="password"]').value = '${DEMO_PASSWORD}';
    f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return true;
  })()`);
  await sleep(1800);
  await shot(win, '02-profile');

  for (const [route, name] of [['resume', '03-resume'], ['apps', '04-apps']]) {
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('.nav-item[data-route="${route}"]').click();
      return true;
    })()`);
    await sleep(1800);
    await shot(win, name);

    if (route === 'resume') {
      console.log(await verify(win, `(() => {
        const gs = (el, p) => getComputedStyle(el, p || null);
        const out = [];
        const t = (n, c) => out.push((c ? '✅' : '❌') + ' ' + n);
        const paper = document.querySelector('.paper');
        t('简历纸张白底保留', paper && gs(paper).backgroundColor === 'rgb(255, 255, 255)');
        const wrap = document.querySelector('.paper-wrap');
        t('纸张台四角角标', wrap && gs(wrap, '::after').backgroundImage.includes('linear-gradient'));
        const head = document.querySelector('#route-resume .page-head');
        t('页头水印数字02', head && gs(head, '::after').content.includes('02'));
        const meter = document.querySelector('.meter');
        t('仪表刻度条', meter && gs(meter).backgroundImage.includes('repeating-linear-gradient'));
        return out.join('\\n');
      })()`));
    } else {
      console.log(await verify(win, `(() => {
        const gs = (el, p) => getComputedStyle(el, p || null);
        const out = [];
        const t = (n, c) => out.push((c ? '✅' : '❌') + ' ' + n);
        t('看板工序色(wish)', !!document.querySelector('.column.stage-wish'));
        t('看板工序色(offer)', !!document.querySelector('.column.stage-offer'));
        t('管线统计条(4节点)', document.querySelectorAll('.pl-node').length >= 4);
        t('管线箭头', !!document.querySelector('.pl-arrow'));
        t('看板列头图标', !!document.querySelector('.column h4 svg'));
        t('新增投递按钮图标', !!document.querySelector('#route-apps .toolbar .btn-primary svg'));
        const col = document.querySelector('.column.stage-applied');
        t('已投列金色顶边', col && gs(col).borderTopColor === 'rgb(255, 176, 30)');
        const chip = document.querySelector('.company-chip');
        t('铭牌芯片切角', chip && gs(chip).clipPath.includes('polygon'));
        const head = document.querySelector('#route-apps .page-head');
        t('页头水印数字03', head && gs(head, '::after').content.includes('03'));
        const ws = document.querySelector('.workspace');
        t('图纸网点背景', ws && gs(ws).backgroundImage.includes('radial-gradient'));
        return out.join('\\n');
      })()`));
    }
  }

  // 回到信息录入页做最后断言
  await win.webContents.executeJavaScript(`(() => {
    document.querySelector('.nav-item[data-route="profile"]').click();
    return true;
  })()`);
  await sleep(1200);
  console.log(await verify(win, `(() => {
    const gs = (el, p) => getComputedStyle(el, p || null);
    const out = [];
    const t = (n, c) => out.push((c ? '✅' : '❌') + ' ' + n);
    const card = document.querySelector('.card');
    t('卡片硬朗直角(4px)', card && gs(card).borderRadius === '4px');
    const entry = document.querySelector('.entry');
    t('条目时间轴节点', entry && gs(entry, '::before').borderRadius === '50%');
    const btn = document.querySelector('.btn-primary');
    t('主按钮切角(clip-path)', btn && gs(btn).clipPath.includes('polygon'));
    const nav = document.querySelector('.nav-item.active');
    t('导航发热条', nav && gs(nav, '::before').width === '3px');
    t('控制台铭牌(CONSOLE)', !!document.querySelector('.side-label'));
    t('版本刻印', !!document.querySelector('.side-ver'));
    // —— 本轮新增结构断言 ——
    t('双栏布局(grid)', !!document.querySelector('.profile-layout') && gs(document.querySelector('.profile-layout')).display === 'grid');
    t('侧栏存在', !!document.querySelector('.profile-side'));
    t('完成度仪表卡', !!document.querySelector('.completeness .score-num'));
    t('检查清单≥8项', document.querySelectorAll('.check-item').length >= 8);
    t('速览统计行', document.querySelectorAll('.stat-row').length >= 4);
    t('悬浮保存条', !!document.querySelector('.save-bar .btn-primary'));
    t('导入条', !!document.querySelector('.import-bar'));
    const icos = document.querySelectorAll('#route-profile .ico-wrap svg');
    t('录入页图标≥10个', icos.length >= 10);
    t('卡片标题图标', !!document.querySelector('#card-basics .card-title h3 svg'));
    t('PDF安全:body无装饰', gs(document.body, '::after').backgroundImage === 'none');
    // —— 提亮配色 + 声音系统 ——
    const bg0 = getComputedStyle(document.documentElement).getPropertyValue('--bg-0').trim();
    t('配色已提亮(--bg-0)', bg0 === '#101623');
    t('新gold色板', getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() === '#ffb01e');
    t('声音系统已加载', !!(window.Sound && typeof window.Sound.play === 'function'));
    t('静音开关按钮', !!document.getElementById('btn-sound'));
    t('纸张仍白底(PDF不变)', gs(document.querySelector('.paper')).backgroundColor === 'rgb(255, 255, 255)');
    return out.join('\\n');
  })()`));
  await shot(win, '02-profile-b');

  console.log('done. shots in', SHOTS);
  app.exit(0);
}

async function verify(win, js) {
  return win.webContents.executeJavaScript(js);
}

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
