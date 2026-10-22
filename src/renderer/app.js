'use strict';

window.addEventListener('error', (e) => {
  console.error('[app.js error] ' + (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || ''));
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[app.js unhandledrejection] ' + ((e.reason && e.reason.message) || e.reason || ''));
});

const { el, esc, toast, call, modalForm, modalTextarea, modalConfirm } = window.UI;

// 本地会话凭证的存储键
const TOKEN_KEY = 'gradResume.sessionToken';

const state = {
  user: null,
  token: null,
  profile: null,
  applications: [],
  jobs: [],
  template: 'classic',
  lastResume: null,
  profileDirty: false,
  jdText: '',
  jdMatch: null
};

// 方向中文名（模块级：JD 匹配与面试准备都要用，别放进单个函数里）
const DOMAIN_LABELS = {
  backend: '后端', frontend: '前端', algorithm: '算法', data: '数据', llm: '大模型 / Agent',
  finance: '金融财务', marketing: '市场运营', design: '创意设计', eng: '机械电气',
  civil: '土木建筑', education: '教育培训', medical: '医药卫生', business: '人力行政',
  // 笔试中心新增方向
  product: '产品', operation: '运营', hr: '人力资源', admin: '行政',
  english: '英语', aptitude: '行测', review: '错题强化',
  general: '通用'
};

function blankProfile() {
  return {
    name: '', phone: '', email: '', city: '', github: '',
    targetRole: '', summary: '', skills: '', awards: [],
    education: [{ school: '', major: '', degree: '本科', period: '', gpa: '', courses: '' }],
    internships: [],
    projects: [{ name: '', role: '', period: '', tech: '', description: '' }]
  };
}

// ---------------- 认证 ----------------
const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const authForm = document.getElementById('auth-form');
const authError = document.getElementById('auth-error');
const authSubmit = document.getElementById('auth-submit');
const fieldName = document.getElementById('field-name');
let authMode = 'login';

// ---- tab 切换（含金色滑块）----
function moveTabSlider(tab) {
  const slider = document.getElementById('auth-tab-slider');
  if (!slider || !tab) return;
  slider.style.width = tab.offsetWidth + 'px';
  slider.style.transform = 'translateX(' + tab.offsetLeft + 'px)';
}

document.querySelectorAll('.auth-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    moveTabSlider(tab);
    authMode = tab.dataset.tab;
    fieldName.style.display = authMode === 'register' ? 'flex' : 'none';
    authSubmit.querySelector('.btn-label').textContent = authMode === 'register' ? '注 册' : '登 录';
    authError.textContent = '';
    clearFieldMsg('email');
    clearFieldMsg('password');
    updatePwStrength();
  });
});
// 初始定位滑块（等布局稳定）
requestAnimationFrame(() => moveTabSlider(document.querySelector('.auth-tab.active')));

// ---- 密码显示 / 隐藏 ----
const pwInput = authForm.querySelector('input[name="password"]');
const pwToggle = document.getElementById('pw-toggle');
pwToggle.addEventListener('click', () => {
  const show = pwInput.type === 'password';
  pwInput.type = show ? 'text' : 'password';
  pwToggle.classList.toggle('on', show);
  pwToggle.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
});

// ---- 大写锁定提示 ----
const capsHint = document.getElementById('caps-hint');
function checkCaps(e) {
  const on = e.getModifierState && e.getModifierState('CapsLock');
  capsHint.classList.toggle('show', !!on);
}
pwInput.addEventListener('keyup', checkCaps);
pwInput.addEventListener('keydown', checkCaps);
pwInput.addEventListener('blur', () => capsHint.classList.remove('show'));

// ---- 字段级校验提示 ----
function setFieldMsg(field, msg, ok) {
  const box = authForm.querySelector('.field-msg[data-for="' + field + '"]');
  const wrap = authForm.querySelector('input[name="' + field + '"]').closest('.field-input');
  if (box) { box.textContent = msg || ''; box.classList.toggle('ok', !!ok); box.classList.toggle('bad', !!msg && !ok); }
  if (wrap) { wrap.classList.toggle('invalid', !!msg && !ok); wrap.classList.toggle('valid', !!ok); }
}
function clearFieldMsg(field) { setFieldMsg(field, '', false); }

function validateEmail(silent) {
  const v = (authForm.querySelector('input[name="email"]').value || '').trim();
  if (!v) { if (!silent) setFieldMsg('email', '请输入邮箱', false); return false; }
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  setFieldMsg('email', ok ? '' : '邮箱格式不正确', ok);
  return ok;
}
function validatePassword(silent) {
  const v = authForm.querySelector('input[name="password"]').value || '';
  if (!v) { if (!silent) setFieldMsg('password', '请输入密码', false); return false; }
  const ok = v.length >= 6;
  setFieldMsg('password', ok ? '' : '密码至少 6 位', ok);
  return ok;
}
authForm.querySelector('input[name="email"]').addEventListener('blur', () => validateEmail(false));
pwInput.addEventListener('blur', () => validatePassword(false));

// ---- 密码强度条（仅注册模式显示）----
function scorePassword(v) {
  let s = 0;
  if (!v) return 0;
  if (v.length >= 6) s++;
  if (v.length >= 10) s++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
  if (/\d/.test(v)) s++;
  if (/[^\w\s]/.test(v)) s++;
  return Math.min(3, Math.ceil(s * 3 / 5));
}
function updatePwStrength() {
  const box = document.getElementById('pw-strength');
  const txt = document.getElementById('pw-strength-txt');
  const v = pwInput.value || '';
  if (authMode !== 'register' || !v) { box.classList.remove('show'); box.dataset.level = '0'; return; }
  const lvl = scorePassword(v);
  box.classList.add('show');
  box.dataset.level = String(lvl);
  txt.textContent = ['', '弱', '中', '强'][lvl] || '';
}
pwInput.addEventListener('input', () => {
  updatePwStrength();
  if (authForm.querySelector('.field-msg[data-for="password"]').textContent) validatePassword(true);
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  const okEmail = validateEmail(false);
  const okPw = validatePassword(false);
  if (!okEmail || !okPw) { shakeCard(); return; }

  const fd = new FormData(authForm);
  const payload = {
    name: fd.get('name'),
    email: (fd.get('email') || '').trim(),
    password: fd.get('password')
  };
  setAuthLoading(true);
  try {
    const user = authMode === 'register'
      ? await call(window.api.auth.register(payload))
      : await call(window.api.auth.login(payload));
    const remember = document.getElementById('remember-me');
    if (user.token && (!remember || remember.checked)) {
      localStorage.setItem(TOKEN_KEY, user.token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    await enterApp(user);
  } catch (err) {
    authError.textContent = err.message;
    shakeCard();
  } finally {
    setAuthLoading(false);
  }
});

// ---- 提交 loading 态 + 防重复 ----
function setAuthLoading(on) {
  authSubmit.classList.toggle('loading', on);
  authSubmit.disabled = on;
  const label = authSubmit.querySelector('.btn-label');
  if (on) {
    authSubmit.dataset.prev = label.textContent;
    label.textContent = authMode === 'register' ? '注册中…' : '登录中…';
  } else if (authSubmit.dataset.prev) {
    label.textContent = authSubmit.dataset.prev;
  }
}

// ---- 错误抖动 ----
function shakeCard() {
  const card = document.querySelector('.auth-card');
  if (!card) return;
  card.classList.remove('shake');
  void card.offsetWidth;
  card.classList.add('shake');
}

async function enterApp(user) {
  state.user = user;
  state.token = user.token || localStorage.getItem(TOKEN_KEY) || null;
  authView.style.display = 'none';
  appView.style.display = 'grid';

  document.getElementById('user-name').textContent = user.name;
  document.getElementById('user-mail').textContent = user.email;
  document.getElementById('user-avatar').textContent = (user.name || 'U').slice(0, 1).toUpperCase();

  // 档案 / 投递加载失败时降级为空数据 + 提示，而不是卡死在空白界面
  try {
    const saved = await call(window.api.profile.get(user.id));
    state.profile = saved || blankProfile();
    state.applications = await call(window.api.applications.list(user.id));
  } catch (err) {
    toast('数据加载失败：' + err.message, 'err');
    state.profile = blankProfile();
    state.applications = [];
  }

  navigate('profile');
}

// 启动时用本地 token 自动恢复登录态，免重复输入
async function tryResumeSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  try {
    const user = await call(window.api.auth.session(token));
    if (user) {
      await enterApp({ ...user, token });
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch (_) {
    localStorage.removeItem(TOKEN_KEY);
  }
}

document.getElementById('btn-logout').addEventListener('click', async () => {
  const token = state.token || localStorage.getItem(TOKEN_KEY);
  if (token) {
    try { await window.api.auth.logout(token); } catch (_) {}
  }
  localStorage.removeItem(TOKEN_KEY);
  state.user = null;
  state.token = null;
  state.profile = null;
  state.applications = [];
  appView.style.display = 'none';
  authView.style.display = 'grid';
  authForm.reset();
});

tryResumeSession();

// 侧栏版本刻印：从主进程读真实版本号（app.getVersion()），永不错版
(async () => {
  try {
    const st = await window.api.updater.status();
    const el = document.getElementById('side-ver');
    if (el && st && st.version) {
      el.textContent = 'FORGE v' + st.version + ' · LOCAL-FIRST · NO CLOUD REQUIRED';
    }
  } catch (_) {} // eslint-disable-line no-empty
})();

// 运行详情：把一条运行记录的逐步 trace 摊开（第几步、调了什么工具、多久、重试几次、错在哪）
// 这是「可观测性」在界面上的落点：不用翻日志也能回答「这次为什么失败 / 慢在哪」。
async function showRunDetail(runId) {
  let rec = null;
  try {
    rec = await call(window.api.agent.getRun(runId));
  } catch (err) {
    toast(err.message, 'err');
    return;
  }
  const overlay = el('div', { class: 'modal-overlay' });
  const steps = el('div', { class: 'snap-list' }, (rec.trace || []).map((t) => el('div', {
    class: 'agent-step' + (t.errorType ? ' bad' : '')
  }, [
    el('span', { class: 'st-ico' }, [t.errorType ? '✕' : '✓']),
    el('span', { class: 'st-label' }, ['第 ' + t.stepId + ' 步 · ' + t.tool]),
    el('span', { class: 'st-detail' }, [
      t.outputSummary + ' · ' + t.latencyMs + 'ms' +
      (t.retryCount ? ' · 重试 ' + t.retryCount + ' 次' : '') +
      (t.errorType ? ' · ' + t.errorType : '')
    ])
  ])));
  const box = el('div', { class: 'modal-box modal-box-wide' }, [
    el('h3', { class: 'modal-title' }, ['运行详情 · ' + rec.runId]),
    el('p', { style: 'font-size:12px;color:var(--ink-2);margin-bottom:10px;line-height:1.7;' }, [
      '状态 ' + rec.status + ' · 步数 ' + rec.usage.steps + ' · 工具 ' + rec.usage.toolCalls + ' 次' +
      (rec.usage.retries ? ' · 重试 ' + rec.usage.retries : '') +
      ' · 耗时 ' + Math.round(rec.usage.ms / 100) / 10 + 's' +
      (rec.usage.tokens ? ' · token ' + rec.usage.tokens : '') + '\n' +
      '输入指纹：JD ' + rec.inputSnapshot.jdLength + ' 字/' + rec.inputSnapshot.jdDigest +
      '，档案 ' + rec.inputSnapshot.profileDigest + '（记录里不保存正文）'
    ]),
    steps,
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => overlay.remove() }, ['关闭'])
    ])
  ]);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// ---------------- 关于 / 自动更新 ----------------
let _updState = { status: null, downloaded: null, target: null }; // 更新运行时状态（供横幅）
// 「关于」弹窗打开时的实时状态绑定：检查结果就地显示，
// 不再让用户自己去看左下角的炉温提示
let _aboutUi = null;

function setFurnace(text, hot) {
  const txt = document.getElementById('furnace-txt');
  const dot = document.getElementById('furnace-dot');
  if (txt) txt.textContent = text;
  if (dot) dot.classList.toggle('hot', !!hot);
}

// 弹窗状态渲染：tone 决定配色（info/ok/warn/err），终态会自动解锁按钮
const ABOUT_TONE = { checking: 'info', available: 'info', progress: 'info', downloaded: 'ok', 'not-available': 'ok', error: 'err', dev: 'warn', idle: 'info' };

function aboutSet(state, text, extra) {
  if (!_aboutUi) return;
  const ui = _aboutUi;
  ui.state = state;
  ui.statusText.className = 'about-status tone-' + (ABOUT_TONE[state] || 'info');
  ui.statusText.textContent = text;

  const pct = extra && typeof extra.percent === 'number' ? extra.percent : null;
  const showBar = state === 'progress' || (state === 'available' && pct != null);
  ui.bar.style.display = showBar ? 'block' : 'none';
  if (showBar) ui.barFill.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';

  // 下载完成 → 弹窗内直接给出安装入口
  ui.installBtn.style.display = state === 'downloaded' ? '' : 'none';
  // 到了终态就允许再次检查
  if (state === 'downloaded' || state === 'not-available' || state === 'error') {
    ui.checkBtn.disabled = false;
    if (ui.timer) { clearTimeout(ui.timer); ui.timer = null; }
  }
}

// 全局订阅更新事件（登录前后都生效）
window.api.updater.onEvent((ev) => {
  const { ev: kind, payload } = ev || {};
  const ver = (payload && payload.version) || '?';
  if (kind === 'checking') {
    setFurnace('检查更新中…', true);
    aboutSet('checking', '正在检查更新…');
  } else if (kind === 'available') {
    _updState.target = ver;
    setFurnace('发现新版本 v' + ver + '，下载中…', true);
    aboutSet('available', '发现新版本 v' + ver + '，开始下载…', { percent: 0 });
  } else if (kind === 'progress') {
    const pct = (payload && payload.percent) || 0;
    setFurnace('下载更新 ' + pct + '%', true);
    aboutSet('progress', '正在下载 v' + (_updState.target || ver) + ' · ' + pct + '%', { percent: pct });
  } else if (kind === 'downloaded') {
    _updState.downloaded = ver;
    setFurnace('新版本已就绪 · v' + _updState.downloaded, true);
    if (window.Sound) window.Sound.play('done'); // 更新就绪：琶音
    aboutSet('downloaded', '✓ 新版本 v' + ver + ' 已下载完成，重启即可生效');
    showUpdateReady(_updState.downloaded);
  } else if (kind === 'not-available') {
    setFurnace('炉温就绪 · FORGE READY', false);
    aboutSet('not-available', '✓ 已是最新版本' + (_updState.status && _updState.status.version ? '（v' + _updState.status.version + '）' : ''));
  } else if (kind === 'error') {
    setFurnace('炉温就绪 · FORGE READY', false);
    const msg = (payload && payload.message) || '未知错误';
    _updState.lastError = msg; // 网络失败不弹窗打扰，但「关于」里能看到
    aboutSet('error', '✗ 检查失败：' + msg + '\n（国内网络可在下方填写下载镜像后重试）');
  }
});

// 新版本下载完成：弹窗问「现在重启安装 / 稍后」
function showUpdateReady(version) {
  const overlay = el('div', { class: 'modal-overlay' });
  function close() { overlay.remove(); }
  const box = el('div', { class: 'modal-box' }, [
    el('h3', { class: 'modal-title' }, ['新版本已下载完成']),
    el('p', { style: 'font-size:13px;color:var(--ink-1);line-height:1.8;' },
      ['v' + version + ' 已准备好。现在重启安装，还是稍后？\n（稍后的话，退出应用时会自动安装）']),
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: close }, ['稍后']),
      el('button', {
        class: 'btn btn-primary btn-sm', type: 'button',
        onclick: async () => {
          const res = await window.api.updater.install();
          if (res && !res.ok) { toast(res.error, 'err'); close(); }
        }
      }, ['重启并安装'])
    ])
  ]);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// 「关于」弹窗：版本 / 检查更新（结果就地显示）/ 镜像设置 / 发布页
async function openAbout() {
  const overlay = el('div', { class: 'modal-overlay' });
  function close() {
    _aboutUi = null; // 解绑：弹窗关了就不再接收状态更新
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  let st = null;
  try { st = await call(window.api.updater.status()); } catch (_) {} // eslint-disable-line no-empty
  _updState.status = st;

  const statusText = el('div', { class: 'about-status' }, ['读取中…']);
  const barFill = el('i');
  const bar = el('div', { class: 'about-bar', style: 'display:none' }, [barFill]);
  const checkBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, ['检查更新']);
  const installBtn = el('button', {
    class: 'btn btn-primary btn-sm', type: 'button', style: 'display:none',
    onclick: async () => {
      const res = await window.api.updater.install();
      if (res && !res.ok) toast(res.error, 'err');
    }
  }, ['重启并安装']);
  const mirrorInput = el('input', {
    type: 'text', value: (st && st.mirror) || '',
    placeholder: '留空直连 GitHub；例：https://gh-proxy.com'
  });

  const curVersion = (st && st.version) || '';
  const repo = (st && st.repo) || '';

  // 数据备份区：启动时自动轮转留档，这里只做「看得到 + 能恢复」
  const backupBox = el('div', { class: 'backup-box' }, [
    el('p', { style: 'font-size:11.5px;color:var(--ink-2);' }, ['正在读取备份…'])
  ]);
  (async () => {
    let data = null;
    try { data = await call(window.api.backups.list()); } catch (_) { data = null; }
    backupBox.innerHTML = '';
    if (!data || !data.items || !data.items.length) {
      backupBox.appendChild(el('p', { style: 'font-size:11.5px;color:var(--ink-2);line-height:1.7;' },
        ['暂无备份。应用每次启动会自动把上一轮的数据留一份副本（保留最近 5 份），下次启动后这里就会显示。']));
      return;
    }
    backupBox.appendChild(el('p', { style: 'font-size:11.5px;color:var(--teal);font-weight:600;' },
      ['已自动保留 ' + data.items.length + ' 份数据备份（每次启动留一份，滚动保留最近 5 份）：']));
    data.items.forEach((b, i) => {
      const d = new Date(b.createdAt);
      const p = (n) => String(n).padStart(2, '0');
      const label = p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
      backupBox.appendChild(el('div', { class: 'backup-row' }, [
        el('span', { class: 'bk-time' }, [label + (i === 0 ? '（最新）' : '')]),
        el('span', { class: 'bk-size' }, [(b.size / 1024).toFixed(1) + ' KB']),
        el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: async () => {
            const ok = await modalConfirm('用这份备份覆盖当前数据？',
              '会用 ' + label + ' 的备份替换现在的全部数据（档案 / 版本 / 快照 / 投递）。' +
              '恢复前系统会先把当前状态也留一份备份，所以这一步同样可回滚。恢复后建议重启应用。', '恢复这份备份');
            if (!ok) return;
            try {
              const restored = await call(window.api.backups.restore(b.name, true));
              // 整库恢复会替换账号和会话，主进程会明确要求重新登录。
              // 这里同步清理渲染层 token，避免用户继续停留在失效的“已登录”界面。
              if (restored && restored.requiresLogin) {
                close();
                localStorage.removeItem(TOKEN_KEY);
                state.user = null;
                state.token = null;
                state.profile = null;
                state.applications = [];
                appView.style.display = 'none';
                authView.style.display = 'grid';
                authForm.reset();
                toast('数据已恢复，请重新登录以加载恢复后的账号', 'ok');
              } else {
                toast('已恢复到 ' + label + ' 的数据，建议重启应用', 'ok');
              }
            } catch (err) { toast('恢复失败：' + err.message, 'err'); }
          }
        }, ['恢复'])
      ]));
    });
    backupBox.appendChild(el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', style: 'margin-top:6px;',
      onclick: () => window.api.backups.reveal()
    }, ['打开备份文件夹']));
  })();

  async function runCheck() {
    checkBtn.disabled = true;
    aboutSet('checking', '正在检查更新…');
    try {
      await call(window.api.updater.check());
    } catch (err) {
      aboutSet('error', '✗ 检查失败：' + err.message);
      return;
    }
    // 结果经 updater:event 异步回来；这里只做超时兜底（不再把用户推去看左下角）
    if (_aboutUi) {
      _aboutUi.timer = setTimeout(() => {
        if (_aboutUi && _aboutUi.state === 'checking') {
          aboutSet('error', '✗ 检查超时：网络可能不通。\n国内网络可在下方填写下载镜像前缀（如 https://gh-proxy.com）后重试。');
        }
      }, 25000);
    }
  }
  checkBtn.addEventListener('click', runCheck);

  // 运行记录（第二阶段）：让「Agent 到底跑了什么」可查、可清理、可回放。
  // 记录里不含简历正文与 JD 原文（只存长度与指纹），所以可以放心列在这里。
  const runsBox = el('div', { class: 'snap-list' }, [
    el('p', { style: 'font-size:12px;color:var(--ink-2);padding:4px 0;' }, ['读取中…'])
  ]);
  async function fillRuns() {
    runsBox.innerHTML = '';
    let list = [];
    try {
      list = await call(window.api.agent.runs(5));
    } catch (err) {
      runsBox.appendChild(el('p', { style: 'font-size:12px;color:var(--ink-2);padding:4px 0;' }, ['读取运行记录失败：' + err.message]));
      return;
    }
    if (!list.length) {
      runsBox.appendChild(el('p', { style: 'font-size:12px;color:var(--ink-2);padding:4px 0;' },
        ['还没有运行记录。跑一次 Agent 优化后，这里会留下它的状态、耗时与工具调用次数。']));
      return;
    }
    list.forEach((r) => {
      const statusText = { COMPLETED: '完成', FAILED: '失败', CANCELLED: '已取消' }[r.status] || r.status;
      const ms = r.usage && r.usage.ms ? Math.round(r.usage.ms / 100) / 10 + 's' : '-';
      runsBox.appendChild(el('div', { class: 'snap-item' }, [
        el('div', { class: 'snap-meta' }, [
          el('span', { class: 'snap-label' }, [statusText + ' · ' + (r.cancelReason || r.error || r.currentStep)]),
          el('span', { class: 'snap-time' }, [timeAgo(r.startedAt)])
        ]),
        el('div', { class: 'snap-ops' }, [
          el('span', { style: 'font-size:11px;color:var(--ink-2);margin-right:auto;' },
            ['工具 ' + (r.usage ? r.usage.toolCalls : 0) + ' 次 · ' + ms + (r.usage && r.usage.retries ? ' · 重试 ' + r.usage.retries : '')]),
          el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: () => showRunDetail(r.runId)
          }, ['详情']),
          el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: async () => {
              // 回放要先确认是同一份输入：拿另一份简历/JD 重跑旧记录，结果没法对比
              const doReplay = async (force) => call(window.api.agent.replay(r.runId, state.profile, state.jdText || '', force));
              try {
                let res;
                try {
                  res = await doReplay(false);
                } catch (err) {
                  if (!/不是同一份/.test(err.message || '')) throw err;
                  const go = await modalConfirm('当前输入和这条记录不是同一份',
                    err.message + '\n\n强行回放会用「现在的」档案与 JD 去重跑记录里的工具调用，' +
                    '结果只能说明工具行为是否一致，不能用来说明那次运行可复现。', '仍要回放');
                  if (!go) return;
                  res = await doReplay(true);
                }
                toast(res.skipped
                  ? '这条记录默认未保存入参原文（脱敏），有 ' + res.skipped + ' 步无法回放；其余成功 ' + res.okCount + ' 次'
                  : '已用当前校验逻辑回放：工具成功 ' + res.okCount + ' 次、失败 ' + res.errorCount + ' 次（未调用模型）',
                res.skipped ? 'notify' : 'ok');
              } catch (err) { toast(err.message, 'err'); }
            }
          }, ['回放'])
        ])
      ]));
    });
  }
  fillRuns();

  const box = el('div', { class: 'modal-box' }, [
    el('h3', { class: 'modal-title' }, ['关于 简历锻造炉']),
    el('div', { class: 'modal-body' }, [
      el('div', { class: 'about-status-wrap' }, [statusText, bar]),
      backupBox,
      el('div', { style: 'margin-top:14px;' }, [
        el('div', { style: 'display:flex;align-items:center;gap:8px;' }, [
          el('span', { style: 'font-size:12.5px;font-weight:600;' }, ['最近运行记录']),
          el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', style: 'margin-left:auto;',
            onclick: async () => {
              try {
                const res = await call(window.api.agent.clearRuns());
                toast('已清理 ' + res.cleared + ' 条运行记录', 'ok');
                fillRuns();
              } catch (err) { toast(err.message, 'err'); }
            }
          }, ['清理运行记录'])
        ]),
        runsBox
      ]),
      el('label', { class: 'field' }, [
        el('span', {}, ['下载镜像（国内加速，选填）']),
        mirrorInput
      ]),
      el('p', { style: 'font-size:11.5px;color:var(--ink-2);line-height:1.7;' },
        ['更新包托管在 GitHub Releases；国内网络不通时可填写 HTTPS 加速镜像前缀（如 https://gh-proxy.com），保存后重试检查。为保护更新安全，不接受 HTTP、本机或内网地址。'])
    ]),
    el('div', { class: 'modal-actions' }, [
      repo ? el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: () => window.api.shell.openExternal('https://github.com/' + repo + '/releases/latest')
      }, ['发布页']) : null,
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: async () => {
          const m = mirrorInput.value.trim();
          try {
            await call(window.api.updater.setMirror(m));
            toast(m ? '镜像已保存' : '已恢复直连 GitHub', 'ok');
          } catch (err) { toast(err.message, 'err'); }
        }
      }, ['保存镜像']),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: close }, ['关闭']),
      installBtn,
      checkBtn
    ])
  ]);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // 绑定实时状态，并按已知情况给出初始文案（版本号始终可见）
  _aboutUi = { statusText, bar, barFill, checkBtn, installBtn, state: 'idle', timer: null, version: curVersion };
  const verLabel = '当前版本 v' + (curVersion || '未知');
  if (_updState.downloaded) {
    aboutSet('downloaded', '✓ 新版本 v' + _updState.downloaded + ' 已下载完成，重启即可生效');
  } else if (_updState.lastError) {
    aboutSet('error', '✗ 上次检查失败：' + _updState.lastError + '\n（可填写下方下载镜像后重试）');
  } else if (st && !st.updaterActive) {
    aboutSet('dev', verLabel + ' · 当前为开发模式，自动更新仅在安装版（打包后）生效');
  } else {
    aboutSet('idle', verLabel + ' · 点右侧「检查更新」看看有没有新版');
  }
}

document.getElementById('btn-about').addEventListener('click', openAbout);

// 声音开关：图标随状态切换，偏好存 localStorage
const _btnSound = document.getElementById('btn-sound');
function renderSoundBtn() {
  if (window.Sound) _btnSound.textContent = window.Sound.enabled ? '🔊' : '🔇';
}
_btnSound.addEventListener('click', () => {
  if (window.Sound) window.Sound.toggle();
  renderSoundBtn();
});
renderSoundBtn();

// ---------------- 路由 ----------------
function navigate(route) {
  document.querySelectorAll('.nav-item').forEach((n) => {
    n.classList.toggle('active', n.dataset.route === route);
  });
  ['profile', 'resume', 'jobs', 'apps', 'exam', 'interview'].forEach((r) => {
    document.getElementById('route-' + r).style.display = r === route ? 'block' : 'none';
  });
  if (window.Sound) window.Sound.play('click'); // 导航轻点音
  // 离开简历页时，摘掉纸张自适应缩放的 resize 监听，避免泄漏
  if (route !== 'resume' && _paperResizeHandler) {
    window.removeEventListener('resize', _paperResizeHandler);
    _paperResizeHandler = null;
  }
  if (route === 'profile') renderProfile();
  if (route === 'resume') renderResumePage();
  if (route === 'jobs') renderJobs();
  if (route === 'apps') renderApps();
  if (route === 'exam') renderExamCenter();
  if (route === 'interview') renderInterviewPage();
}

document.querySelectorAll('.nav-item').forEach((n) => {
  n.addEventListener('click', () => navigate(n.dataset.route));
});

// ---------------- 页面 1：信息录入 ----------------
function inputField(label, name, value, placeholder, type) {
  return el('label', { class: 'field' }, [
    el('span', {}, [label]),
    el('input', { type: type || 'text', name, value: value || '', placeholder: placeholder || '' })
  ]);
}
function areaField(label, name, value, placeholder) {
  // 导入器产出的经历描述是 string[]（每条一行）。直接塞进 textarea 会 appendChild(数组) 抛错，
  // 也会让「每行一条」的语义丢失 —— 这里统一按换行拼接。
  const text = Array.isArray(value) ? value.join('\n') : (value == null ? '' : String(value));
  return el('label', { class: 'field' }, [
    el('span', {}, [label]),
    el('textarea', { name, placeholder: placeholder || '' }, [text])
  ]);
}

// 下拉选择字段：用于离散选项（如学历）
function selectField(label, name, value, options) {
  const select = el('select', { name }, options.map((o) =>
    el('option', { value: o, selected: o === value ? 'selected' : null }, [o])
  ));
  return el('label', { class: 'field' }, [el('span', {}, [label]), select]);
}

// 时间段选择：起止「年 + 月」下拉，结束可设「至今」；合成 "YYYY.MM - YYYY.MM / 至今" 字符串存入隐藏 input[name]
// 保留 input[name=xxx] 结构，collectProfile 取值逻辑无需改动
const PERIOD_YEARS = (function () {
  const y = [];
  for (let i = new Date().getFullYear(); i >= 1980; i--) y.push(String(i));
  return y;
})();
const PERIOD_MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

function periodField(label, name, value) {
  const raw = String(value || '');
  const seg = raw.split('-').map((s) => s.trim());
  const [sy, sm] = (seg[0] || '').split('.');
  const endRaw = seg[1] || '';
  const isNow = endRaw === '至今';
  const [ey, em] = isNow ? ['至今', ''] : (endRaw || '').split('.');

  const opt = (v, text, sel) => el('option', { value: v, selected: sel ? 'selected' : null }, [text]);

  const startYear = el('select', { class: 'p-year' }, [
    opt('', '年', !sy),
    ...PERIOD_YEARS.map((y) => opt(y, y, y === sy))
  ]);
  const startMonth = el('select', { class: 'p-month' }, [
    opt('', '月', !sm),
    ...PERIOD_MONTHS.map((m) => opt(m, m, m === sm))
  ]);
  const endYear = el('select', { class: 'p-year' }, [
    opt('至今', '至今', isNow),
    ...PERIOD_YEARS.map((y) => opt(y, y, y === ey))
  ]);
  const endMonth = el('select', { class: 'p-month' }, [
    opt('', '月', !em),
    ...PERIOD_MONTHS.map((m) => opt(m, m, m === em))
  ]);

  const hidden = el('input', { type: 'hidden', name, value: raw });

  function sync() {
    const sY = startYear.value, sM = startMonth.value;
    const eY = endYear.value, eM = endMonth.value;
    endMonth.disabled = eY === '至今';
    if (!sY || !sM) { hidden.value = ''; return; }
    const start = sY + '.' + sM;
    const end = eY === '至今' ? '至今' : eY + '.' + (eM || '06');
    hidden.value = start + ' - ' + end;
  }
  [startYear, startMonth, endYear, endMonth].forEach((s) => s.addEventListener('change', sync));
  sync();

  const box = el('div', { class: 'period-box' }, [
    startYear, startMonth, el('span', { class: 'p-sep' }, ['—']), endYear, endMonth, hidden
  ]);
  return el('label', { class: 'field period-field' }, [el('span', {}, [label]), box]);
}

// 带自动补全下拉的输入字段：输入关键词模糊匹配候选，点选/键盘选择填入
// 保留 input[name=xxx] 结构，collectProfile 取值逻辑无需改动
function autocompleteField(label, name, value, placeholder, source) {
  const list = (window.SuggestData && window.SuggestData[source]) || [];
  const input = el('input', {
    type: 'text', name, value: value || '', placeholder: placeholder || '',
    autocomplete: 'off', class: 'ac-input'
  });
  const panel = el('div', { class: 'ac-panel' }, []);
  const box = el('div', { class: 'ac-box' }, [input, panel]);
  const field = el('label', { class: 'field ac-field' }, [el('span', {}, [label]), box]);

  let items = [];
  let active = -1;

  function close() { panel.classList.remove('show'); panel.innerHTML = ''; active = -1; items = []; }

  function pick(text) { input.value = text; close(); input.focus(); }

  function highlight(text, kw) {
    if (!kw) return esc(text);
    const idx = text.toLowerCase().indexOf(kw.toLowerCase());
    if (idx < 0) return esc(text);
    return esc(text.slice(0, idx)) + '<b>' + esc(text.slice(idx, idx + kw.length)) + '</b>' + esc(text.slice(idx + kw.length));
  }

  function render(kw) {
    const q = (kw || '').trim();
    const matched = q
      ? list.filter((x) => x.toLowerCase().includes(q.toLowerCase()))
      : list.slice();
    items = matched.slice(0, 12);
    active = -1;
    panel.innerHTML = '';
    if (!items.length) { close(); return; }
    items.forEach((text, i) => {
      const opt = el('div', {
        class: 'ac-opt', 'data-i': i,
        html: highlight(text, q),
        onmousedown: (e) => { e.preventDefault(); pick(text); }
      });
      panel.appendChild(opt);
    });
    panel.classList.add('show');
  }

  function setActive(next) {
    const opts = panel.querySelectorAll('.ac-opt');
    if (!opts.length) return;
    active = (next + opts.length) % opts.length;
    opts.forEach((o, i) => o.classList.toggle('active', i === active));
    opts[active].scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (!panel.classList.contains('show')) {
      if (e.key === 'ArrowDown') { render(input.value); return; }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') {
      if (active >= 0 && items[active]) { e.preventDefault(); pick(items[active]); }
    } else if (e.key === 'Escape') { close(); }
  });

  return field;
}

function eduEntry(ed, i) {
  return el('div', { class: 'entry', 'data-kind': 'edu' }, [
    el('div', { class: 'entry-head' }, [
      el('span', { class: 'entry-index' }, ['教育 #' + (i + 1)]),
      el('button', { class: 'entry-remove', type: 'button', onclick: (e) => { e.target.closest('.entry').remove(); } }, ['移除'])
    ]),
    el('div', { class: 'grid-2' }, [
      autocompleteField('学校', 'school', ed.school, '输入关键词选择，如：华中科技', 'school'),
      autocompleteField('专业', 'major', ed.major, '输入关键词选择，如：计算机', 'major')
    ]),
    el('div', { class: 'grid-2' }, [
      selectField('学历', 'degree', ed.degree, window.SuggestData.degree),
      inputField('GPA / 排名', 'gpa', ed.gpa, '3.8/4.0 或 前 5%')
    ]),
    periodField('起止时间', 'period', ed.period),
    inputField('主修课程', 'courses', ed.courses, '与目标岗位相关的 3-5 门，如：数据结构、财务管理、教育学原理…')
  ]);
}

function jobEntry(kind, it, i) {
  const label = kind === 'intern' ? '实习' : '项目';
  return el('div', { class: 'entry', 'data-kind': kind }, [
    el('div', { class: 'entry-head' }, [
      el('span', { class: 'entry-index' }, [label + ' #' + (i + 1)]),
      el('button', { class: 'entry-remove', type: 'button', onclick: (e) => { e.target.closest('.entry').remove(); } }, ['移除'])
    ]),
    el('div', { class: 'grid-2' }, [
      inputField(kind === 'intern' ? '公司 / 组织 / 学校' : '项目 / 活动名称', 'name', it.name, kind === 'intern' ? '如：字节跳动 / 会计师事务所 / 某某中学' : '如：校园二手交易平台 / 财务共享中心 / 支教志愿服务'),
      inputField('角色', 'role', it.role, kind === 'intern' ? '如：研发实习生 / 审计助理 / 实习教师' : '核心成员 / 负责人')
    ]),
    periodField('起止时间', 'period', it.period),
    inputField('工具 / 技术 / 方法', 'tech', it.tech, '技术岗：Java / MySQL；其他：Excel、SPSS、CAD、教案设计…'),
    areaField('经历描述（每行一条，用大白话写你真实做了什么，引擎会自动去 AI 味并强化）', 'description', it.description,
      '例（技术）：优化订单查询接口，把 P99 从 800ms 降到 120ms\n例（通用）：策划迎新晚会，覆盖 2000 人，满意度 96%')
  ]);
}

// 卡片标题工厂：图标 + 标题 + 提示（取代纯文字标题，全站统一）
function cardTitle(iconName, title, hint) {
  return el('div', { class: 'card-title' }, [
    el('h3', {}, [window.Icons.icon(iconName), title]),
    hint ? el('span', { class: 'hint' }, [hint]) : null
  ]);
}

function renderProfile() {
  const p = state.profile;
  const root = document.getElementById('route-profile');
  root.innerHTML = '';
  const ico = (n, s) => window.Icons.icon(n, s);

  const head = el('div', { class: 'page-head' }, [
    el('div', { class: 'page-kicker' }, ['STEP 01 / 信息录入']),
    el('h1', { class: 'page-title' }, ['讲清楚你真实做过什么']),
    el('p', { class: 'page-desc' }, ['用大白话填写即可——生成时引擎会自动删除套话、强化动词、提醒你补量化。左侧填档案，右侧看完成度。'])
  ]);

  // 一键导入旧简历（PDF / TXT）：本地解析自动填表，导入后预览确认
  const importBar = el('div', { class: 'import-bar' }, [
    ico('download', 17),
    el('div', { class: 'ib-text' }, [
      el('b', {}, ['已有旧简历？']),
      el('span', {}, ['选 PDF / TXT 文件自动填表，识别结果先给你过目'])
    ]),
    isProfileEmpty(p) ? null : el('span', { class: 'ib-demo-hint' }, ['或']),
    isProfileEmpty(p) ? null : el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => loadDemoProfile('cs') }, ['示例']),
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: onImportResume }, ['导入旧简历'])
  ]);

  // 新手引导：档案为空时给一条 30 秒体验完整流程的捷径（技术 + 财务双示例）
  let onboarding = null;
  if (isProfileEmpty(p)) {
    onboarding = el('div', { class: 'card onboarding' }, [
      el('div', { class: 'ob-badge' }, ['FIRST RUN']),
      el('h3', { class: 'ob-title' }, ['第一次用？30 秒看完整个锻造流程']),
      el('p', { class: 'ob-desc' }, ['不用逐个填表——选一份示例档案直接进炉：看体检评分、贴 JD 匹配、跑 Agent 改写，玩完再换成你自己的经历。']),
      el('div', { class: 'ob-actions' }, [
        el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => loadDemoProfile('cs') },
          [ico('code', 14), '示例：后端工程师（计算机）']),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => loadDemoProfile('finance') },
          [ico('briefcase', 14), '示例：财务专员（会计学）'])
      ])
    ]);
  }

  // ---- 左列：档案主体 ----
  const basicsCard = el('div', { class: 'card', id: 'card-basics' }, [
    cardTitle('user', '基本信息'),
    el('div', { class: 'grid-3' }, [
      inputField('姓名', 'name', p.name, '张三'),
      inputField('手机号', 'phone', p.phone, '138****8888'),
      inputField('邮箱', 'email', p.email, 'you@example.com')
    ]),
    el('div', { class: 'grid-3' }, [
      autocompleteField('城市', 'city', p.city, '输入关键词选择，如：深圳', 'city'),
      inputField('作品集 / 个人主页', 'github', p.github, 'github.com/你的名字、掘金/知乎/站酷主页、个人网站；多条用逗号分隔（最多展示 3 条）'),
      autocompleteField('目标岗位', 'targetRole', p.targetRole, '输入关键词选择，如：后端', 'targetRole')
    ]),
    areaField('一句话自我介绍（选填，留空则自动生成）', 'summary', p.summary, '留空即可，引擎会根据你的经历自动拼一句朴实、无套话的简介')
  ]);

  const skillsCard = el('div', { class: 'card', id: 'card-skills' }, [
    cardTitle('wrench', '专业技能', '逗号 / 顿号分隔'),
    areaField('技能清单', 'skills', p.skills, '技能 / 工具 / 证书都可以：Python, Excel, SQL, 文案策划, 教师资格证…'),
    (p.skills || '').trim() ? el('div', { class: 'skill-chip-row' },
      p.skills.split(SKILL_SEP_RE).map((s) => s.trim()).filter(Boolean).slice(0, 24)
        .map((s, i) => el('span', { class: 'r-skill', style: '--i:' + i }, [s]))
    ) : null
  ]);

  // 教育（保存时空条目已被过滤，这里兜底渲染一条空白引导填写）
  const eduItems = (p.education && p.education.length) ? p.education : [{ degree: '本科' }];
  const eduList = el('div', { id: 'edu-list' }, eduItems.map((ed, i) => eduEntry(ed, i)));
  const eduCard = el('div', { class: 'card' }, [
    cardTitle('cap', '教育背景'),
    eduList,
    el('button', { class: 'add-entry', type: 'button', onclick: () => {
      eduList.appendChild(eduEntry({ degree: '本科' }, eduList.children.length));
    } }, [ico('plus', 13), '+ 添加教育经历'])
  ]);

  // 实习
  const internList = el('div', { id: 'intern-list' }, (p.internships || []).map((it, i) => jobEntry('intern', it, i)));
  const internCard = el('div', { class: 'card' }, [
    cardTitle('briefcase', '实习经历', '没有可留空'),
    internList,
    el('button', { class: 'add-entry', type: 'button', onclick: () => {
      internList.appendChild(jobEntry('intern', {}, internList.children.length));
    } }, [ico('plus', 13), '+ 添加实习经历'])
  ]);

  // 项目（空档案兜底渲染一条空白引导填写）
  const projItems = (p.projects && p.projects.length) ? p.projects : [{}];
  const projList = el('div', { id: 'proj-list' }, projItems.map((it, i) => jobEntry('proj', it, i)));
  const projCard = el('div', { class: 'card' }, [
    cardTitle('code', '项目经历', '应届最重要的部分'),
    projList,
    el('button', { class: 'add-entry', type: 'button', onclick: () => {
      projList.appendChild(jobEntry('proj', {}, projList.children.length));
    } }, [ico('plus', 13), '+ 添加项目经历'])
  ]);

  // 竞赛 / 奖项 / 荣誉（每行一条：竞赛名、奖项、证书都放这里）
  const awardsCard = el('div', { class: 'card', id: 'card-awards' }, [
    cardTitle('cap', '竞赛 / 奖项荣誉', '每行一条 · 没有可留空'),
    areaField('竞赛 / 奖项 / 证书', 'awards', (p.awards || []).join('\n'),
      '一行一条，例：\n全国大学生数学建模竞赛 省级二等奖 2024\n校级书法大赛一等奖 2006\n钢琴十级 2009')
  ]);

  // ---- 右列：锻造侧栏（环形完成度仪表 + 档案统计 + 快照）----
  const stats = buildProfileStats(p);
  const scoreColor = stats.score >= 80 ? 'var(--teal)' : stats.score >= 50 ? 'var(--gold)' : 'var(--danger)';
  // 完成度与速览两张卡抽成函数：输入时要在原地重建（见 refreshProfileSide），
  // 只重建侧栏、不动表单，否则会打断用户正在输入的光标。
  const completenessCard = () => el('div', { class: 'card side-card completeness', id: 'card-completeness' }, [
    cardTitle('gauge', '档案完成度'),
    ringGauge(stats.score, scoreColor),
    el('div', { class: 'check-list' }, stats.items.map((it) =>
      el('div', { class: 'check-item' + (it.done ? ' done' : '') }, [
        el('span', { class: 'ci-ico' }, [it.done ? '✓' : '○']),
        el('span', { class: 'ci-label' }, [it.label])
      ])
    ))
  ]);
  const overviewCard = () => el('div', { class: 'card side-card', id: 'card-overview' }, [
    cardTitle('doc', '档案速览'),
    el('div', { class: 'stat-rows' }, [
      ['教育', stats.countEdu + ' 段', 'cap'],
      ['实习', stats.countIntern + ' 段', 'briefcase'],
      ['项目', stats.countProj + ' 段', 'code'],
      ['技能', stats.countSkill + ' 项', 'wrench']
    ].map(([k, v, ic]) =>
      el('div', { class: 'stat-row' }, [ico(ic, 15), el('span', { class: 'sk' }, [k]), el('b', {}, [v])])
    ))
  ]);
  // 回炉快照卡：先持有元素引用，异步填充紧跟其后。
  // 此前用 document.getElementById 查询，而该卡此刻还没被 append 进 DOM（append 在函数末尾），
  // 查不到就直接 return —— 卡片永久停在「读取中…」，「回炉」按钮永远不出现，于是无法还原。
  const snapCard = el('div', { class: 'card side-card', id: 'card-snapshots' }, [
    cardTitle('refresh', '回炉快照', 'Agent 改写前自动备份'),
    el('div', { class: 'snap-list' }, [el('p', { style: 'font-size:12px;color:var(--ink-2);padding:4px 0;' }, ['读取中…'])])
  ]);
  // 简历版本卡：同样先持有引用再异步填充（与快照卡同样的坑，别再用 getElementById）
  const verCard = el('div', { class: 'card side-card', id: 'card-versions' }, [
    cardTitle('doc', '简历版本', '一个岗位一版 · 手动命名'),
    el('div', { class: 'ver-list' }, [el('p', { style: 'font-size:12px;color:var(--ink-2);padding:4px 0;' }, ['读取中…'])]),
    el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', style: 'width:100%;margin-top:8px;',
      onclick: () => openSaveVersion()
    }, ['＋ 把当前档案存为新版本'])
  ]);
  const sideCol = el('div', { class: 'profile-side' }, [
    completenessCard(),
    overviewCard(),
    // 简历版本在回炉快照之前：前者是用户主动管理的功能，后者是自动备份（少有人翻）
    verCard,
    snapCard
  ]);

  // 输入时实时刷新侧栏（完成度/速览），并把当前表单收进 state.profile。
  // 以前没有这个监听：侧栏只在整页渲染时算一次，于是「填了城市但清单还是未完成」，
  // 而且未保存的改动不进内存，切到简历预览页看到的还是旧档案（匹配度显示旧岗位）。
  const refreshSide = debounce(() => {
    if (!document.getElementById('card-completeness')) return; // 已离开录入页
    state.profile = collectProfile();
    state.profileDirty = true;
    const fresh = buildProfileStats(state.profile);
    const color = fresh.score >= 80 ? 'var(--teal)' : fresh.score >= 50 ? 'var(--gold)' : 'var(--danger)';
    const cBox = document.getElementById('card-completeness');
    const oBox = document.getElementById('card-overview');
    if (cBox) {
      cBox.innerHTML = '';
      cBox.append(
        cardTitle('gauge', '档案完成度'),
        ringGauge(fresh.score, color),
        el('div', { class: 'check-list' }, fresh.items.map((it) =>
          el('div', { class: 'check-item' + (it.done ? ' done' : '') }, [
            el('span', { class: 'ci-ico' }, [it.done ? '✓' : '○']),
            el('span', { class: 'ci-label' }, [it.label])
          ])
        ))
      );
    }
    if (oBox) {
      oBox.innerHTML = '';
      oBox.append(
        cardTitle('doc', '档案速览'),
        el('div', { class: 'stat-rows' }, [
          ['教育', fresh.countEdu + ' 段', 'cap'],
          ['实习', fresh.countIntern + ' 段', 'briefcase'],
          ['项目', fresh.countProj + ' 段', 'code'],
          ['技能', fresh.countSkill + ' 项', 'wrench']
        ].map(([k, v, ic]) =>
          el('div', { class: 'stat-row' }, [ico(ic, 15), el('span', { class: 'sk' }, [k]), el('b', {}, [v])])
        ))
      );
    }
    markSaveBarDirty();
  });
  root.addEventListener('input', refreshSide);
  root.addEventListener('change', refreshSide);

  // 版本列表异步填充（与快照同样在 append 之后才查 DOM，但这里用直接引用，不依赖时机）
  fillVersionList(verCard);

  // 快照列表异步填充（不阻塞首屏渲染）
  (async () => {
    const list = snapCard.querySelector('.snap-list');
    if (!list) return;
    try {
      const snaps = await call(window.api.snapshots.list(state.user.id));
      list.innerHTML = '';
      if (!snaps.length) {
        list.appendChild(el('p', { style: 'font-size:12px;color:var(--ink-2);padding:4px 0;' },
          ['暂无快照。Agent 应用改写时会自动备份改写前的档案，随时可回炉。']));
        return;
      }
      snaps.forEach((s) => {
        list.appendChild(el('div', { class: 'snap-item' }, [
          el('div', { class: 'snap-meta' }, [
            el('span', { class: 'snap-label' }, [s.label]),
            el('span', { class: 'snap-time' }, [timeAgo(s.createdAt)])
          ]),
          el('div', { class: 'snap-ops' }, [
            el('button', {
              class: 'btn btn-ghost btn-sm', type: 'button',
              onclick: async () => {
                try {
                  state.profile = await call(window.api.snapshots.restore(state.user.id, s.id));
                  toast('已回炉到快照版本', 'ok');
                  renderProfile();
                } catch (err) { toast(err.message, 'err'); }
              }
            }, ['回炉']),
            el('button', {
              class: 'btn btn-ghost btn-sm snap-del', type: 'button',
              onclick: async () => {
                try {
                  await call(window.api.snapshots.remove(state.user.id, s.id));
                  toast('快照已删除', 'ok');
                  renderProfile();
                } catch (err) { toast(err.message, 'err'); }
              }
            }, ['删除'])
          ])
        ]));
      });
    } catch (_) {
      list.innerHTML = '';
      list.appendChild(el('p', { style: 'font-size:12px;color:var(--ink-2);' }, ['快照读取失败']));
    }
  })();

  // 悬浮保存条：双栏后底部按钮易被忽略，改为钉在底部的工具条
  const saveBar = el('div', { class: 'save-bar' }, [
    el('div', { class: 'sb-stat' }, ['档案完成度 ' + stats.score + '% · Ctrl+S 保存']),
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: onSaveProfile }, ['保存信息']),
    el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => { await onSaveProfile(true); navigate('resume'); } }, ['保存并生成简历 →'])
  ]);
  saveBarRef = saveBar;

  const twoCols = el('div', { class: 'profile-layout' }, [
    el('div', { class: 'profile-main' }, [basicsCard, skillsCard, eduCard, internCard, projCard, awardsCard]),
    sideCol
  ]);

  // append 遇 null 会渲染成文本「null」，这里过滤掉空节点
  root.append(...[head, onboarding, importBar, twoCols, saveBar].filter(Boolean));
}

// 保存条引用与「有改动未保存」提示：输入时实时更新完成度，并让用户看得见还没保存
let saveBarRef = null;
function markSaveBarDirty() {
  if (!saveBarRef) return;
  const stat = saveBarRef.querySelector('.sb-stat');
  if (!stat) return;
  const p = state.profile || {};
  const score = buildProfileStats(p).score;
  stat.textContent = '档案完成度 ' + score + '% · 有改动未保存 · Ctrl+S 保存';
  stat.classList.add('dirty');
}
function clearSaveBarDirty() {
  if (!saveBarRef) return;
  const stat = saveBarRef.querySelector('.sb-stat');
  if (!stat) return;
  const p = state.profile || {};
  stat.textContent = '档案完成度 ' + buildProfileStats(p).score + '% · 已保存 · Ctrl+S 保存';
  stat.classList.remove('dirty');
}
// 输入防抖：连打字时不必每个字符都重建侧栏
function debounce(fn, ms) {
  let timer = null;
  return function debounced() {
    const args = arguments;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn.apply(null, args); }, ms == null ? 250 : ms);
  };
}

// 技能分隔符必须与引擎、与导入产出一致。
// 踩过的坑：导入器把技能分节各行用「、」拼起来，而行内是「·」与空格分隔的
// （「教学 语法教学 · 教案设计 · …」），只认逗号/顿号时整串只数出 2 项，
// 于是「技能 ≥ 4 项」明明够了却一直显示未完成（用户实测反馈）。
// 特意不加空格与斜杠：那会把「Machine Learning」「CI/CD」切成两半。
const SKILL_SEP_RE = /[,，、;；·|｜\n]+/;
function splitSkills(raw) {
  return String(raw || '').split(SKILL_SEP_RE).map((s) => s.trim()).filter(Boolean);
}

// 档案完成度：只统计「该有就必须有」的项。
// 一句话自我介绍不在这里：它标注为选填且留空会自动生成，把它算作未完成
// 等于「一边说可以留空、一边扣你的分」，自相矛盾（用户明确反馈过）。
function buildProfileStats(p) {
  const items = [
    { label: '基本信息（姓名/手机/邮箱）', done: !!(p.name && p.phone && p.email) },
    { label: '城市与目标岗位', done: !!(p.city && p.targetRole) },
    { label: '技能 ≥ 4 项', done: splitSkills(p.skills).length >= 4 },
    { label: '教育经历 ≥ 1 段', done: (p.education || []).some((e) => e.school) },
    { label: '项目经历 ≥ 1 段', done: (p.projects || []).some((e) => e.name) },
    // 以前只查「项目」且标签叫「项目描述有量化」，用户看不懂在说什么；
    // 现在实习/实践也一起算（很多人的成果写在实习里），标签写清楚要什么样的数字。
    { label: '描述里有具体数字（规模 / 提升幅度）', done: (p.projects || []).concat(p.internships || []).some((e) => /\d/.test(e.description || '')) },
    { label: '作品集 / 个人主页 / 证书说明', done: !!(p.github || '').trim() }
  ];
  const done = items.filter((x) => x.done).length;
  return {
    items,
    score: Math.round((done / items.length) * 100),
    countEdu: (p.education || []).filter((e) => e.school).length,
    countIntern: (p.internships || []).filter((e) => e.name).length,
    countProj: (p.projects || []).filter((e) => e.name).length,
    countSkill: splitSkills(p.skills).length
  };
}

// ---------------- 环形仪表（SVG，带描边动画与数字滚动） ----------------
function ringGauge(percent, colorVar) {
  const R = 34, C = 2 * Math.PI * R; // 周长
  const wrap = el('div', { class: 'ring-gauge' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 84 84');
  svg.setAttribute('class', 'ring-svg');
  svg.innerHTML =
    '<circle class="ring-track" cx="42" cy="42" r="' + R + '"/>' +
    '<circle class="ring-fill" cx="42" cy="42" r="' + R + '" style="stroke:' + colorVar + '"/>';
  const fill = svg.querySelector('.ring-fill');
  fill.style.strokeDasharray = String(C);
  fill.style.strokeDashoffset = String(C);
  // 下一帧再设置目标值，触发 CSS 过渡（从 0 滚到 percent）
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fill.style.strokeDashoffset = String(C * (1 - percent / 100));
    });
  });
  const num = el('span', { class: 'score-num ring-num', style: 'color:' + colorVar }, ['0']);
  // 数字滚动
  const t0 = performance.now(), dur = 700;
  (function tick(t) {
    const k = Math.min(1, (t - t0) / dur);
    num.textContent = String(Math.round(percent * (1 - Math.pow(1 - k, 3)))); // easeOutCubic
    if (k < 1) requestAnimationFrame(tick);
  })(t0);
  wrap.append(svg, num, el('span', { class: 'ring-unit' }, ['%']));
  return wrap;
}

// ---------------- 示例档案（一键体验：技术 + 财务，展示全专业） ----------------
const DEMO_PROFILES = {
  cs: {
    name: '李明', phone: '13812345678', email: 'liming@example.com', city: '杭州',
    github: 'github.com/liming', targetRole: '后端开发工程师', summary: '',
    skills: 'Java, Go, MySQL, Redis, Kafka, 数据结构, 计算机网络, Git, Linux, Docker',
    education: [{ school: '浙江大学', major: '计算机科学与技术', degree: '本科', period: '2021.09 - 2025.06', gpa: '3.8/4.0', courses: '数据结构、操作系统、计算机网络、数据库原理' }],
    internships: [{ name: '字节跳动', role: '后端开发实习生', period: '2024.06 - 至今', tech: 'Go / MySQL / Redis', description: '负责订单系统查询优化，P99 从 800ms 降到 120ms\n参与用户模块开发，支撑日活 3 万' }],
    projects: [
      { name: '分布式短链服务', role: '核心开发', period: '2024.01 - 2024.05', tech: 'Go / Redis / Kafka', description: '设计短链算法，QPS 提升 5 倍\n使用多级缓存优化查询，P99 降到 80ms' },
      { name: '高并发秒杀系统', role: '独立开发', period: '2023.09 - 2023.12', tech: 'Java / Spring Cloud', description: '实现库存预扣与异步下单，支撑 5000 QPS\n用压测定位瓶颈，吞吐提升 3 倍' }
    ],
    awards: ['全国大学生计算机设计大赛 省级二等奖 2024', '校级一等奖学金 2023']
  },
  finance: {
    name: '王雨晴', phone: '13987654321', email: 'wangyuqing@example.com', city: '上海',
    github: '作品集：财务分析报告 3 份（面试可出示）', targetRole: '财务专员', summary: '',
    skills: 'Excel（数据透视 / 函数）, 用友 U8, CPA（已过 3 科）, 财务报表分析, 审计底稿, 英语六级',
    education: [{ school: '西南财经大学', major: '会计学', degree: '本科', period: '2021.09 - 2025.06', gpa: '3.6/4.0', courses: '中级财务会计、审计学、财务管理、税法' }],
    internships: [{ name: '天健会计师事务所', role: '审计实习生', period: '2024.06 - 2024.09', tech: 'Excel / 底稿系统', description: '参与 2 家制造业公司年审，独立完成货币资金与往来科目底稿\n盘点现金与存货，盘点差异率 0.1%' }],
    projects: [
      { name: '财务共享中心流程优化', role: '小组负责人', period: '2023.09 - 2024.01', tech: '用友 U8 / Excel', description: '梳理 12 家子公司报销流程，制作对账模板，月结周期缩短 2 天\n输出费用分析报告 4 份，被课程评为优秀案例' },
      { name: '上市公司报表分析（课程设计）', role: '独立完成', period: '2023.03 - 2023.06', tech: 'Excel / Wind', description: '拆解贵州茅台 5 年三大报表，搭建 DCF 估值模型\n小组答辩成绩 95 / 100' }
    ],
    awards: ['全国大学生会计技能大赛 省级三等奖 2024', '校级优秀学生干部 2023']
  }
};

// 档案是否基本为空（决定是否展示新手引导）
function isProfileEmpty(p) {
  return !p.name && !(p.projects || []).some((e) => e.name) && !(p.education || []).some((e) => e.school);
}

// 载入示例：非空档案先确认，并自动快照备份（回炉快照可撤销），避免覆盖后无法还原
async function loadDemoProfile(kind) {
  const demo = DEMO_PROFILES[kind] || DEMO_PROFILES.cs;
  const hasData = !isProfileEmpty(state.profile);

  // 已有真实档案时先确认，杜绝「一按示例全没了」
  if (hasData) {
    const ok = await modalConfirm('载入示例会替换当前档案',
      '你当前填的档案会被这份示例顶掉。载入前我们会自动备份一份到右侧「<b>回炉快照</b>」，误载后仍可一键还原。确定继续吗？',
      '载入示例并备份');
    if (!ok) return;
  }

  // 备份当前档案（非空才备份，作为撤销后的后悔药）
  if (hasData) {
    try {
      await call(window.api.snapshots.save(state.user.id, '载入示例前 · ' + fmtSnapshotTime(Date.now()), state.profile));
    } catch (_) { /* 备份失败不阻断载入，但提示可手动从快照恢复 */ }
  }

  try {
    state.profile = await call(window.api.profile.save(state.user.id, JSON.parse(JSON.stringify(demo))));
    toast(hasData
      ? '示例已载入；误操作可去右侧「回炉快照」一键还原'
      : '示例档案已载入，去「简历预览」看看效果 →', 'ok');
    renderProfile();
  } catch (err) {
    toast('载入失败：' + err.message, 'err');
  }
}

// 快照时间标签：与 Agent 快照风格一致（"09/07 18:09"）
function fmtSnapshotTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// ---------------- 一键导入旧简历 ----------------
async function onImportResume() {
  let result;
  try {
    result = await call(window.api.resume.importResume());
  } catch (err) {
    toast(err.message, 'err');
    return;
  }
  if (!result) return; // 用户在文件选择框点了取消

  const parsed = result.parsed || {};
  const counts = [
    parsed.name ? '姓名' : null,
    parsed.phone ? '手机' : null,
    parsed.email ? '邮箱' : null,
    parsed.city ? '城市' : null,
    parsed.github ? '作品集 / 个人主页' : null,
    parsed.targetRole ? '目标岗位' : null
  ].filter(Boolean);

  const listCounts = [
    (parsed.education || []).length ? '教育 ' + parsed.education.length + ' 段' : null,
    (parsed.internships || []).length ? '实习 ' + parsed.internships.length + ' 段' : null,
    (parsed.projects || []).length ? '项目 ' + parsed.projects.length + ' 段' : null,
    (parsed.awards || []).length ? '竞赛/奖项 ' + parsed.awards.length + ' 条' : null,
    parsed.skills ? '技能 ' + splitSkills(parsed.skills).length + ' 项' : null,
    parsed.summary ? '自我介绍' : null
  ].filter(Boolean);

  if (!counts.length && !listCounts.length) {
    toast('没能从这份文件里识别出有效内容，请手动填写', 'err');
    return;
  }

  showImportReview(result.file, parsed, counts, listCounts);
}

// 导入预览：展示识别结果，让用户选择「合并」还是「替换」
function showImportReview(fileName, parsed, counts, listCounts) {
  const overlay = el('div', { class: 'modal-overlay' });
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  const rows = [
    ['文件', fileName],
    ['基本信息', counts.join('、') || '未识别到'],
    ['经历', listCounts.join(' · ') || '未识别到'],
    (parsed.notes || []).length ? ['提示', parsed.notes.join('；')] : null
  ].filter(Boolean);

  const apply = (mode) => {
    applyImport(parsed, mode);
    close();
  };

  const box = el('div', { class: 'modal-box modal-box-wide' }, [
    el('h3', { class: 'modal-title' }, ['导入预览 · 识别到以下内容']),
    el('div', { class: 'modal-body' }, rows.map(([k, v]) =>
      el('div', { style: 'display:flex;gap:14px;font-size:13px;line-height:1.7;' }, [
        el('span', { style: 'color:var(--ink-2);min-width:64px;flex:none;' }, [k]),
        el('span', { style: 'word-break:break-all;' }, [String(v)])
      ])
    )),
    el('p', { style: 'font-size:12px;color:var(--ink-2);margin:4px 0 0;' },
      ['合并：保留现有内容，只填空缺字段、追加新条目 · 替换：用导入内容覆盖全部']),
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: close }, ['取消']),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => apply('replace') }, ['替换导入']),
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => apply('merge') }, ['合并导入'])
    ])
  ]);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// 应用导入结果：merge 只填空缺 + 追加；replace 全量覆盖
// 导入器把经历描述产出为 string[]（每条一行）：在边界就归一化成字符串，
// 免得数组渗进表单、模板、Agent 应用等下游各处（曾导致表单渲染抛错、改写错行）。
function normalizeEntry(it) {
  if (!it || typeof it !== 'object') return it;
  return Object.assign({}, it, {
    description: Array.isArray(it.description) ? it.description.join('\n') : (it.description || '')
  });
}
function normalizeParsed(parsed) {
  const p = Object.assign({}, parsed || {});
  ['education', 'internships', 'projects'].forEach((k) => {
    if (Array.isArray(p[k])) p[k] = p[k].map(normalizeEntry);
  });
  return p;
}

function applyImport(parsedRaw, mode) {
  const parsed = normalizeParsed(parsedRaw);
  const current = collectProfile(); // 读当前表单（未保存的修改也不丢）
  const target = mode === 'replace'
    ? Object.assign(blankProfile(), parsed)
    : mergeProfiles(current, parsed);

  state.profile = target;
  renderProfile();
  toast(mode === 'replace' ? '已按导入内容覆盖，请检查后保存' : '已合并导入，请检查后保存', 'ok');
}

function mergeProfiles(current, parsed) {
  const out = { ...current };
  // 基本字段：只填空缺
  ['name', 'phone', 'email', 'city', 'github', 'targetRole', 'summary'].forEach((k) => {
    if (!out[k] && parsed[k]) out[k] = parsed[k];
  });
  // 技能：合并去重（分隔符与显示、计数保持一致，否则会出现「看起来 10 项、算出来 2 项」）
  if (parsed.skills) {
    const parts = splitSkills(out.skills);
    const seen = new Set(parts.map((s) => s.toLowerCase()));
    splitSkills(parsed.skills).forEach((t) => {
      if (t && !seen.has(t.toLowerCase())) { parts.push(t); seen.add(t.toLowerCase()); }
    });
    out.skills = parts.join(', ');
  }
  // 列表：追加
  out.education = (out.education || []).concat(parsed.education || []);
  out.internships = (out.internships || []).concat(parsed.internships || []);
  out.projects = (out.projects || []).concat(parsed.projects || []);
  // 竞赛/奖项：按整行去重后追加（同名奖项重复导入不该出现两遍）
  {
    const seen = new Set((out.awards || []).map((a) => String(a).replace(/\s+/g, '')));
    const merged = (out.awards || []).slice();
    (parsed.awards || []).forEach((a) => {
      const key = String(a).replace(/\s+/g, '');
      if (key && !seen.has(key)) { merged.push(a); seen.add(key); }
    });
    out.awards = merged;
  }
  return out;
}

function collectProfile() {
  function val(scope, name) {
    const node = scope.querySelector('[name="' + name + '"]');
    return node ? node.value.trim() : '';
  }
  const basics = document.getElementById('card-basics');
  const skills = document.getElementById('card-skills');
  const awardsCard = document.getElementById('card-awards');
  // 竞赛/奖项：每行一条
  const awards = (awardsCard ? val(awardsCard, 'awards') : '')
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  // 全空条目不入档：避免「移除失败 / 误加的空白经历」随保存越积越多
  const education = [...document.querySelectorAll('#edu-list .entry')].map((s) => ({
    school: val(s, 'school'), major: val(s, 'major'), degree: val(s, 'degree'),
    period: val(s, 'period'), gpa: val(s, 'gpa'), courses: val(s, 'courses')
  })).filter((e) => e.school || e.major || e.gpa || e.courses || e.period);
  const internships = [...document.querySelectorAll('#intern-list .entry')].map((s) => ({
    name: val(s, 'name'), role: val(s, 'role'), period: val(s, 'period'),
    tech: val(s, 'tech'), description: val(s, 'description')
  })).filter((it) => it.name || it.description || it.tech || it.role || it.period);
  const projects = [...document.querySelectorAll('#proj-list .entry')].map((s) => ({
    name: val(s, 'name'), role: val(s, 'role'), period: val(s, 'period'),
    tech: val(s, 'tech'), description: val(s, 'description')
  })).filter((it) => it.name || it.description || it.tech || it.role || it.period);

  return {
    name: val(basics, 'name'), phone: val(basics, 'phone'), email: val(basics, 'email'),
    city: val(basics, 'city'), github: val(basics, 'github'), targetRole: val(basics, 'targetRole'),
    summary: val(basics, 'summary'), skills: val(skills, 'skills'),
    education, internships, projects, awards
  };
}

async function onSaveProfile(silent) {
  const profile = collectProfile();
  // 保存按钮 loading 态：防连点 + 给「正在保存」反馈
  const saveBtn = document.querySelector('.save-bar .btn-primary');
  const ghostBtn = document.querySelector('.save-bar .btn-ghost');
  const busy = (on) => {
    [saveBtn, ghostBtn].forEach((b) => { if (b) b.disabled = on; });
    if (saveBtn) saveBtn.classList.toggle('loading', on);
  };
  busy(true);
  try {
    state.profile = await call(window.api.profile.save(state.user.id, profile));
    state.profileDirty = false;
    clearSaveBarDirty();
    if (!silent) toast('信息已保存到本地', 'ok');
  } catch (err) {
    toast(err.message, 'err');
    throw err;
  } finally {
    busy(false);
  }
}

// ---------------- 页面 2：简历预览 + 体检 ----------------
// A4 纸张（794px 宽）按容器宽度自适应缩放
function fitPaperToWidth(paperWrap, paper) {
  const avail = paperWrap.clientWidth - 52;
  if (avail <= 0) return;
  const scale = Math.min(1, Math.max(0.1, avail / 794));
  paper.style.transform = 'scale(' + scale + ')';
  paper.style.marginBottom = (794 * scale * 1.414 - 794 * 1.414) + 'px';
}
let _paperResizeHandler = null;

async function renderResumePage() {
  const root = document.getElementById('route-resume');
  root.innerHTML = '';

  const head = el('div', { class: 'page-head' }, [
    el('div', { class: 'page-kicker' }, ['STEP 02 / 简历预览']),
    el('h1', { class: 'page-title' }, ['你的简历，已去 AI 味']),
    el('p', { class: 'page-desc' }, ['右侧「去 AI 味体检」实时评分：分数越高越像真人手写。切换模板、按建议打磨，然后一键导出 PDF。'])
  ]);

  // 骨架屏：生成是异步的，先撑住版面（模拟报纸版式的灰色块）
  const skeleton = el('div', { class: 'paper-wrap' }, [
    el('div', { class: 'paper paper-skeleton' }, [
      el('div', { class: 'sk-line sk-name' }),
      el('div', { class: 'sk-line w60' }),
      el('div', { class: 'sk-gap' }),
      el('div', { class: 'sk-block' }),
      el('div', { class: 'sk-line w40' }),
      el('div', { class: 'sk-line' }),
      el('div', { class: 'sk-line w80' }),
      el('div', { class: 'sk-gap' }),
      el('div', { class: 'sk-line w40' }),
      el('div', { class: 'sk-line' }),
      el('div', { class: 'sk-line w70' })
    ])
  ]);
  root.append(head, skeleton);

  // 生成失败时给出错误卡片 + 重试入口，而不是留下半空白的页面
  let result;
  try {
    result = await call(window.api.resume.generate(state.profile, {}));
  } catch (err) {
    root.innerHTML = '';
    root.append(head, el('div', { class: 'card' }, [
      el('div', { style: 'padding:34px 24px;text-align:center;' }, [
        el('p', { style: 'color:var(--danger);font-size:14px;margin-bottom:16px;' }, ['简历生成失败：' + err.message]),
        el('button', { class: 'btn btn-primary', type: 'button', onclick: () => renderResumePage() }, ['重试'])
      ])
    ]));
    return;
  }
  root.innerHTML = '';
  state.lastResume = result;

  // 模板选择器
  const picker = el('div', { class: 'template-picker' },
    [['classic', '经典'], ['minimal', '极简'], ['tech', '科技'], ['deep', '商务'], ['warm', '活力']].map(([key, label]) =>
      el('button', {
        class: 'tmpl-btn' + (state.template === key ? ' active' : ''),
        type: 'button',
        onclick: () => { state.template = key; renderResumePage(); }
      }, [label])
    )
  );

  const paper = el('div', { class: 'paper tmpl-' + state.template });
  paper.innerHTML = window.Template.renderResumeInner(result.resume, state.template);

  // 自适应缩放：初次渲染 + 窗口尺寸变化时都重新计算
  const paperWrap = el('div', { class: 'paper-wrap' }, [paper]);
  if (_paperResizeHandler) window.removeEventListener('resize', _paperResizeHandler);
  _paperResizeHandler = () => fitPaperToWidth(paperWrap, paper);
  window.addEventListener('resize', _paperResizeHandler);
  requestAnimationFrame(() => fitPaperToWidth(paperWrap, paper));

  // ---- 体检面板 ----
  const audit = result.audit;
  const color = audit.score >= 80 ? 'var(--teal)' : audit.score >= 60 ? 'var(--gold)' : 'var(--danger)';
  const issuesNodes = audit.issues.length
    ? audit.issues.slice(0, 30).map((it) => el('div', { class: 'issue' }, [
        el('span', { class: 'tag' }, [it.type]),
        el('span', {}, [it.word + (it.count > 1 ? ' ×' + it.count : '')])
      ]))
    : [el('div', { class: 'tip' }, ['未检测到套话 / AI 高频词，很干净！'])];

  const auditCard = el('div', { class: 'audit' }, [
    el('div', { class: 'card-title mb-0' }, [el('h3', {}, [window.Icons.icon('gauge'), '去 AI 味体检'])]),
    el('div', { class: 'audit-score', style: 'margin-top:12px;' }, [
      el('span', { class: 'score-num', style: 'color:' + color }, [String(audit.score)]),
      el('span', { class: 'score-max' }, ['/ 100'])
    ]),
    el('div', { class: 'score-level', style: 'color:' + color }, [audit.level]),
    el('div', { class: 'meter' }, [el('i', { style: 'width:' + audit.score + '%;background:' + color })]),
    el('div', { style: 'font-size:12.5px;color:var(--ink-2);margin-bottom:6px;' }, ['量化数据占比：' + audit.metricRatio + '%']),
    el('div', { class: 'issue-list' }, issuesNodes)
  ]);

  // ---- 优化建议 ----
  const tipsCard = el('div', { class: 'audit' }, [
    el('div', { class: 'card-title mb-0' }, [el('h3', {}, [window.Icons.icon('bulb'), '优化建议'])]),
    el('div', { class: 'tips-list', style: 'margin-top:12px;' },
      (result.tips.length ? result.tips : ['信息很完整，暂无补充建议。']).map((t) => el('div', { class: 'tip' }, [t]))
    )
  ]);

  // ---- 岗位匹配度（本地词库匹配，非大模型）----
  const match = result.match;
  const mColor = match.score >= 65 ? 'var(--teal)' : match.score >= 40 ? 'var(--gold)' : 'var(--danger)';
  const hitTags = match.hit.length
    ? match.hit.map((h) => el('span', { class: 'skill-hit' }, ['✓ ' + h.label]))
    : [el('div', { class: 'tip' }, ['暂未命中该方向核心技能，先补强再投。'])];
  const missTags = match.missing.length
    ? match.missing.map((m) => el('span', { class: 'skill-miss', title: '若掌握，建议补进技能或项目' }, [m.label]))
    : [el('span', { style: 'font-size:12.5px;color:var(--teal);' }, ['核心技能已全覆盖，很棒！'])];

  const matchCard = el('div', { class: 'audit' }, [
    el('div', { class: 'card-title mb-0' }, [
      el('h3', {}, [window.Icons.icon('target2'), '岗位匹配度']),
      el('span', { class: 'hint' }, [match.targetRole || '目标岗位'])
    ]),
    el('div', { class: 'audit-score', style: 'margin-top:12px;' }, [
      el('span', { class: 'score-num', style: 'color:' + mColor }, [String(match.score)]),
      el('span', { class: 'score-max' }, ['%'])
    ]),
    el('div', { class: 'score-level', style: 'color:' + mColor }, [match.level]),
    el('div', { class: 'meter' }, [el('i', { style: 'width:' + match.score + '%;background:' + mColor })]),
    el('div', { style: 'font-size:12.5px;color:var(--ink-2);margin:2px 0 8px;' }, ['已命中 ' + match.hitCount + ' / ' + match.total + ' 项核心技能']),
    el('div', { class: 'skill-cloud' }, hitTags),
    match.missing.length ? el('div', { style: 'font-size:12.5px;color:var(--ink-2);margin:10px 0 6px;' }, ['建议补充（招聘方常考）：']) : null,
    el('div', { class: 'skill-cloud' }, missTags)
  ]);

  // ---- JD 精准匹配（粘贴职位描述，按这份 JD 逐项比对）----
  const jdCard = buildJdCard();

  // ---- Agent 深度优化（本地 LLM，不可用时降级为引导文案）----
  const agentCard = buildAgentCard();

  const sidePanel = el('div', { class: 'side-panel' }, [
    el('div', {}, [picker]),
    agentCard,
    jdCard,
    matchCard,
    auditCard,
    tipsCard
  ]);

  const toolbar = el('div', { class: 'toolbar' }, [
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => navigate('profile') }, [window.Icons.icon('file', 15), '返回编辑']),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: openAddApplication }, [window.Icons.icon('send', 15), '记录一次投递']),
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: copyResumeText }, [window.Icons.icon('copy', 15), '复制纯文本']),
    el('button', { class: 'btn btn-primary', type: 'button', onclick: exportPdf }, [window.Icons.icon('printer', 16), '导出 PDF'])
  ]);

  const layout = el('div', { class: 'resume-layout' }, [paperWrap, sidePanel]);
  root.append(head, toolbar, layout);
}

// ---------------- JD 精准匹配 ----------------
function buildJdCard() {
  const jd = state.jdMatch;
  if (!jd) {
    // 未粘贴过 JD：展示入口引导
    return el('div', { class: 'audit' }, [
      el('div', { class: 'card-title mb-0' }, [
        el('h3', {}, [window.Icons.icon('target'), 'JD 精准匹配']),
        el('span', { class: 'hint' }, ['粘贴职位描述'])
      ]),
      el('p', { style: 'font-size:12.5px;color:var(--ink-2);line-height:1.7;margin:10px 0 12px;' },
        ['把目标岗位的 JD 原文粘贴进来，按这份 JD 实际提到的技能逐项比对，比方向泛匹配更精准。']),
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', style: 'width:100%;', onclick: openJdMatch }, ['粘贴 JD，开始匹配'])
    ]);
  }

  const color = jd.score >= 60 ? 'var(--teal)' : jd.score >= 40 ? 'var(--gold)' : 'var(--danger)';
  const hitTags = jd.hit.length
    ? jd.hit.map((h) => el('span', { class: 'skill-hit' }, ['✓ ' + h.label]))
    : [el('span', { style: 'font-size:12.5px;color:var(--ink-2);' }, ['JD 提到的技能简历均未覆盖'])];
  const missTags = jd.missing.length
    ? jd.missing.map((m) => el('span', { class: 'skill-miss' }, [m.label]))
    : [el('span', { style: 'font-size:12.5px;color:var(--teal);' }, ['JD 技能要求已全覆盖，很棒！'])];

  return el('div', { class: 'audit' }, [
    el('div', { class: 'card-title mb-0' }, [
      el('h3', {}, [window.Icons.icon('target'), 'JD 精准匹配']),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', style: 'padding:4px 10px;',
        title: state.jdText ? state.jdText.slice(0, 100) : '', onclick: openJdMatch
      }, ['换一份 JD'])
    ]),
    el('div', { class: 'audit-score', style: 'margin-top:12px;' }, [
      el('span', { class: 'score-num', style: 'color:' + color }, [String(jd.score)]),
      el('span', { class: 'score-max' }, ['%'])
    ]),
    el('div', { class: 'score-level', style: 'color:' + color }, [jd.level]),
    el('div', { class: 'meter' }, [el('i', { style: 'width:' + jd.score + '%;background:' + color })]),
    el('div', { style: 'font-size:12.5px;color:var(--ink-2);margin:2px 0 8px;' },
      ['JD 方向：' + (DOMAIN_LABELS[jd.domain] || jd.domain) + ' · 覆盖 ' + jd.hitCount + ' / ' + jd.jdSkillCount + ' 项 JD 技能'
        + (jd.rawScore != null && jd.rawScore !== jd.score ? '（纯命中率 ' + jd.rawScore + '%，加权后 ' + jd.score + '%——硬性要求权重更高）' : '')]),
    jd.mustMissing && jd.mustMissing.length
      ? el('div', { style: 'font-size:12.5px;color:var(--danger);margin:6px 0;' },
        ['硬性要求未体现（' + jd.mustMissing.length + ' 项，优先补）：' + jd.mustMissing.slice(0, 6).map((m) => m.label).join('、')])
      : null,
    el('div', { class: 'skill-cloud' }, hitTags),
    jd.missing.length ? el('div', { style: 'font-size:12.5px;color:var(--ink-2);margin:10px 0 6px;' }, ['JD 要求但简历缺失：']) : null,
    el('div', { class: 'skill-cloud' }, missTags),
    jd.tips && jd.tips.length
      ? el('div', { class: 'tips-list', style: 'margin-top:10px;' }, jd.tips.map((t) => el('div', { class: 'tip' }, [t])))
      : null
  ]);
}

async function openJdMatch() {
  if (!state.lastResume || !state.lastResume.resume) {
    toast('请先生成简历', 'err');
    return;
  }
  const jd = await modalTextarea('粘贴职位描述（JD）', {
    label: 'JD 原文',
    placeholder: '把招聘网站上的职位描述完整粘贴到这里（含「任职要求 / 技能要求」部分效果最好）…',
    value: state.jdText || '',
    submitText: '开始匹配'
  });
  if (!jd) return;

  try {
    state.jdText = jd;
    state.jdMatch = await call(window.api.resume.matchJd(state.lastResume.resume, jd));
    renderResumePage(); // 重渲染侧栏，展示匹配结果
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ---------------- Agent 深度优化（本地 LLM · Ollama） ----------------
let _agentStatus = null; // { available, models, config } | null=未检测
let _agentMode = null;        // null = 用户尚未选择（用自动默认）
let _agentModeUserSet = false; // 用户手动选过之后，自动默认不再覆盖（否则会"点不动"）
let _agentPrefsLoaded = false;  // 「上次选的通道」只恢复一次，之后尊重用户本次的选择

const AGENT_MODES = ['rules', 'pipeline', 'agentic'];

// 为什么要记住通道：不记的话，用户明确选了「零配置（规则）」——一个不调用任何模型的通道——
// 重启后自动默认会因为探测到可用模型而切回需要模型的通道，用户没注意就会把内容发给模型。
// 这属于「用户表达过的意图必须被尊重」，和「零门槛」是同一件事。
async function persistAgentMode(m) {
  try {
    const cfg = await call(window.api.settings.get('agent'));
    await call(window.api.settings.save('agent', Object.assign({}, cfg || {}, { mode: m })));
  } catch (_) { /* 偏好存不下来不影响本次选择 */ }
}

async function restoreAgentMode() {
  if (_agentPrefsLoaded) return;
  _agentPrefsLoaded = true;
  try {
    const cfg = await call(window.api.settings.get('agent'));
    if (cfg && AGENT_MODES.indexOf(cfg.mode) >= 0 && !_agentModeUserSet) {
      _agentMode = cfg.mode;
      _agentModeUserSet = true; // 记忆中的选择同样不该被自动默认覆盖
    }
  } catch (_) { /* 读不到就用自动默认 */ }
}

async function refreshAgentStatus() {
  const pref = restoreAgentMode(); // 与状态探测并行，稍后 await，保证首次渲染时通道已就位
  try {
    _agentStatus = await call(window.api.agent.status());
  } catch (_) {
    _agentStatus = { available: false, models: [], config: {} };
  }
  await pref;
  // 只在仍停留在简历页时刷新（避免离开页面后无谓重渲染）
  const route = document.getElementById('route-resume');
  if (route && route.style.display !== 'none') renderResumePage();
}

function buildAgentCard() {
  // 状态未知：先渲染占位，异步探测完 refreshAgentStatus 会重渲染
  if (!_agentStatus) {
    refreshAgentStatus();
    return el('div', { class: 'audit' }, [
      el('div', { class: 'card-title mb-0' }, [
        el('h3', {}, [window.Icons.icon('zap'), 'Agent 深度优化']),
        el('span', { class: 'hint' }, ['本地 / 云端'])
      ]),
      el('p', { style: 'font-size:12.5px;color:var(--ink-2);margin:10px 0;' }, ['正在检测模型服务…'])
    ]);
  }

  const cfg = _agentStatus.config || {};
  const isCloud = cfg.provider === 'cloud';
  const isEmbedded = cfg.provider === 'embedded';

  let statusLine;
  if (_agentStatus.available) {
    const extra = isCloud
      ? '（云端）'
      : isEmbedded
        ? '（应用内 · 离线可用）'
        : (_agentStatus.models && _agentStatus.models.length ? '（已装 ' + _agentStatus.models.length + ' 个模型）' : '');
    statusLine = el('span', { class: 'agent-dot on', title: (_agentStatus.models || []).join('\n') || '模型服务已连接' },
      ['● ' + (cfg.model || '本地模型') + extra]);
  } else {
    const hint = isEmbedded
      ? (_agentStatus.error || '模型未下载：⚙ 配置 → 应用内模型 → 下载')
      : isCloud
        ? (_agentStatus.error || '请到 ⚙ 配置填写 API 密钥')
        : '安装 Ollama 后运行：ollama pull ' + (cfg.model || 'qwen2.5:7b');
    statusLine = el('span', { class: 'agent-dot off', title: hint },
      ['○ ' + (isEmbedded ? '应用内模型未就绪（仍可用规则引擎）' : isCloud ? '云端模型未就绪（仍可用规则引擎）' : '未检测到 Ollama（仍可用规则引擎）')]);
  }

  const modelReady = !!_agentStatus.available;
  // 自动默认只在用户还没手动选过时生效：有可用模型 → 流水线，没有 → 零配置（规则）。
  // 用户一旦点过模式按钮，就始终尊重他的选择——否则每次重渲染都会把手动选择覆盖掉，
  // 表现就是「点了没反应」（配了云端/本地模型时点「零配置」正是这个症状）
  if (!_agentModeUserSet) {
    _agentMode = modelReady ? 'pipeline' : 'rules';
  }

  const runLabel = _agentMode === 'rules'
    ? '⚡ 对着这份 JD 跑一轮（零配置 · 规则引擎）'
    : modelReady
      ? '⚡ 对着这份 JD 跑一轮'
      : (isEmbedded ? '运行（需先在配置里下载模型）' : isCloud ? '运行（需先配置云端密钥）' : '运行（需先启动 Ollama）');

  const modeBtns = {
    rules: el('button', {
      class: 'seg-btn' + (_agentMode === 'rules' ? ' active' : ''), type: 'button',
      title: '不下载模型、不填密钥、不联网：改写由确定性规则引擎完成，其余步骤（JD 分析 / 体检 / 校验门）完全一致'
    }, ['零配置（规则）']),
    pipeline: el('button', {
      class: 'seg-btn' + (_agentMode === 'pipeline' ? ' active' : ''), type: 'button',
      title: '固定流程：分析 JD → 改写 → 校验 → 复测，快且稳（需模型）'
    }, ['流水线']),
    agentic: el('button', {
      class: 'seg-btn' + (_agentMode === 'agentic' ? ' active' : ''), type: 'button',
      title: 'LLM 通过原生 function calling 自主决定调用哪个工具、何时收工（需模型）'
    }, ['自主 Agent'])
  };
  // 用户点了模式按钮 → 记为「已手动选择」，此后自动默认不再覆盖
  const pickMode = (m) => {
    _agentMode = m; _agentModeUserSet = true;
    renderResumePage();
    persistAgentMode(m); // 落盘：下次启动仍然是你选的这条通道
  };
  modeBtns.rules.addEventListener('click', () => pickMode('rules'));
  modeBtns.pipeline.addEventListener('click', () => pickMode('pipeline'));
  modeBtns.agentic.addEventListener('click', () => pickMode('agentic'));

  const modeHint = _agentMode === 'rules'
    ? '零配置模式：不下载模型、不填密钥、不联网，即时完成。规则引擎擅长删套话、强化动词、保量化、按 JD 对齐技能表述；但它无法像大模型那样按 JD 语义重组句子、生成全新表述——需要那一层时再选流水线/自主模式。'
    : _agentMode === 'agentic'
      ? '自主模式：LLM 通过 function calling 自主调用分析 / 体检 / 改写工具，自己决定何时收工。产出仍过确定性校验门。'
      : '流水线模式：固定流程「分析 JD → 改写 → 校验 → 复测」，轮次少、速度快，产出过确定性校验门。';

  return el('div', { class: 'audit' }, [
    el('div', { class: 'card-title mb-0' }, [
      el('h3', {}, [window.Icons.icon('zap'), 'Agent 深度优化']),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', style: 'padding:4px 10px;',
        title: '本地 / 云端 · 模型 · 密钥', onclick: openAgentConfig
      }, [window.Icons.icon('gear', 13), '配置'])
    ]),
    statusLine,
    el('div', { class: 'seg seg-thin' }, [modeBtns.rules, modeBtns.pipeline, modeBtns.agentic]),
    el('p', { style: 'font-size:12px;color:var(--ink-2);line-height:1.7;margin:0 0 12px;' }, [modeHint]),
    el('button', {
      class: 'btn btn-primary btn-sm', type: 'button', style: 'width:100%;',
      onclick: openAgentRun
    }, [runLabel])
  ]);
}

// 云端服务商预设（全部走 OpenAI 兼容协议，密钥自备、只存本机）
const CLOUD_PRESETS = [
  { name: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'Kimi（月之暗面）', endpoint: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: '通义千问', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
];

function openAgentConfig() {
  const stored = (_agentStatus && _agentStatus.config) || {};
  const isCloudStored = stored.provider === 'cloud';
  // 零门槛默认：没配过就选「应用内模型」——首次经国内镜像下载约 281MB，之后离线；
  // Ollama / 云端 API 是进阶选项，不设为默认（这正是"零门槛"的落点）
  let provider = isCloudStored ? 'cloud' : 'embedded';

  const overlay = el('div', { class: 'modal-overlay' });
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function textInput(label, value, placeholder, type) {
    const input = el('input', { type: type || 'text', value: value || '', placeholder: placeholder || '' });
    return { row: el('label', { class: 'field' }, [el('span', {}, [label]), input]), input };
  }

  const segBtns = {
    embedded: el('button', { class: 'seg-btn', type: 'button', title: '推荐：模型下载进应用缓存，之后离线可用，零安装零密钥' }, ['应用内模型（推荐）']),
    ollama: el('button', { class: 'seg-btn', type: 'button' }, ['本地 Ollama']),
    cloud: el('button', { class: 'seg-btn', type: 'button' }, ['云端 API'])
  };
  const fieldsBox = el('div', { class: 'modal-body' }, []);
  let endpointInput, modelInput, keyInput, sessionOnlyInput, tempInput, presetSelect, embStatusLine, embDlBtn;

  // ---- 本机已有的本地模型服务：探测到就一键用，省掉「让用户自己装一个」----
  const detectBox = el('div', { class: 'detect-box' }, [
    el('p', { style: 'font-size:11.5px;color:var(--ink-2);' }, ['正在探测本机已有的本地模型服务…'])
  ]);
  (async () => {
    let found = [];
    try { found = await call(window.api.agent.detectLocal()); } catch (_) { found = []; }
    detectBox.innerHTML = '';
    if (!found.length) {
      detectBox.appendChild(el('p', { style: 'font-size:11.5px;color:var(--ink-2);line-height:1.7;' },
        ['未检测到本机模型服务。如果你已装过 LM Studio / llama.cpp / vLLM / Jan 等，启动它们后重开本弹窗即可自动识别；没有也能用——「零配置（规则）」通道不需要任何模型。']));
      return;
    }
    detectBox.appendChild(el('p', { style: 'font-size:11.5px;color:var(--teal);font-weight:600;' },
      ['检测到本机已有 ' + found.length + ' 个模型服务，可直接使用：']));
    found.forEach((s) => {
      detectBox.appendChild(el('div', { class: 'detect-row' }, [
        el('span', { class: 'dr-name' }, [s.name]),
        el('span', { class: 'dr-meta' }, [s.endpoint + (s.models.length ? ' · ' + s.models.length + ' 个模型' : '')]),
        el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: async () => {
            // 必须先切到该模式并重建字段区，输入框才存在（否则赋值打在 undefined 上）
            provider = 'ollama'; // 这些服务都是 OpenAI 兼容协议，走本地客户端即可
            renderFields();
            endpointInput.value = s.endpoint;
            modelInput.value = s.models[0] || '';
            toast('已填入 ' + s.name + '，点「保存」即生效', 'ok');
          }
        }, ['使用'])
      ]));
    });
  })();

  function renderFields() {
    ['embedded', 'ollama', 'cloud'].forEach((k) => segBtns[k].classList.toggle('active', provider === k));
    fieldsBox.innerHTML = '';

    if (provider === 'embedded') {
      embStatusLine = el('p', { class: 'emb-status' }, ['检测中…']);
      embDlBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, ['下载模型到本机（约 270-281MB · 国内镜像直连）']);
      embDlBtn.addEventListener('click', async () => {
        embDlBtn.disabled = true;
        embStatusLine.textContent = '开始下载…（首次约 270-281MB 按显卡自动选档，走国内镜像不需要科学上网；之后断网可用）';
        try {
          await window.EmbeddedLlm.ensureEngine((p) => {
            embStatusLine.textContent = (p.phase === 'download' ? '下载中 ' : '加载中 ') + p.percent + '%' + (p.text ? '（' + p.text + '）' : '（首次下载约 270-281MB，之后离线）');
          });
          const v = await window.EmbeddedLlm.getVariantInfo();
          embStatusLine.textContent = '✅ 模型已就绪（qwen2.5-0.5b ' + v.key + '档，应用内运行）';
          if (window.Sound) window.Sound.play('done');
          window.api.embedded.reportStatus({ webgpu: true, ready: true });
        } catch (err) {
          embStatusLine.textContent = '❌ ' + err.message + '（重试或改用其他方式）';
          embDlBtn.disabled = false;
          if (window.Sound) window.Sound.play('err');
        }
      });
      fieldsBox.append(
        el('p', { style: 'font-size:12.5px;color:var(--ink-1);line-height:1.7;' },
          ['模型（Qwen2.5-0.5B）下载到应用缓存后在本机运行——不装 Ollama、不填 API 密钥、之后断网可用。首次需联网下载约 270-281MB（按显卡自动选适配档位，hf-mirror / gh-proxy 国内镜像直连，一般几分钟），需要较新的显卡（WebGPU）。']),
        embStatusLine, embDlBtn
      );
      // 异步检测 WebGPU 与 wasm 编译能力（两者任一缺失都无法用应用内模型）
      (async () => {
        try {
          const has = await window.EmbeddedLlm.webgpuAvailable();
          const wasmOk = window.EmbeddedLlm.wasmCompilable();
          const ready = window.EmbeddedLlm.isEngineReady();
          if (ready) {
            const v0 = await window.EmbeddedLlm.getVariantInfo();
            embStatusLine.textContent = '✅ 模型已就绪（qwen2.5-0.5b ' + v0.key + '档，应用内运行）';
          }
          else if (!wasmOk) {
            embStatusLine.textContent = '⚠️ 应用安全策略未放行 WebAssembly，无法运行应用内模型。请选 Ollama 或云端 API';
            embDlBtn.disabled = true;
          }
          else if (has) {
            const v = await window.EmbeddedLlm.getVariantInfo();
            embStatusLine.textContent = '设备支持 WebGPU（自动选 ' + v.key + '档 · 约 ' + v.weightsMB + 'MB），模型未下载（可选）';
          }
          else {
            embStatusLine.textContent = '⚠️ 此设备不支持 WebGPU，无法使用应用内模型。请选 Ollama 或云端 API';
            embDlBtn.disabled = true;
          }
        } catch (_) { embStatusLine.textContent = '检测失败，可重试'; } // eslint-disable-line no-empty
      })();
      return;
    }

    const temp = textInput('温度（0-1，越小越稳）', String(stored.temperature != null ? stored.temperature : 0.3), '0.3');
    tempInput = temp.input;

    if (provider === 'cloud') {
      presetSelect = el('select', {},
        [el('option', { value: '' }, ['选择服务商预设（自动填地址与模型）'])].concat(
          CLOUD_PRESETS.map((p, i) => el('option', { value: String(i) }, [p.name + ' · ' + p.model]))
        ));
      presetSelect.addEventListener('change', () => {
        const p = CLOUD_PRESETS[Number(presetSelect.value)];
        if (p) { endpointInput.value = p.endpoint; modelInput.value = p.model; }
      });

      const ep = textInput('API 地址（OpenAI 兼容，一般以 /v1 结尾）', isCloudStored ? stored.endpoint : '', 'https://api.deepseek.com/v1');
      endpointInput = ep.input;
      const md = textInput('模型名称', isCloudStored ? stored.model : '', 'deepseek-chat');
      modelInput = md.input;
      // 已保存的密钥不回显（防肩窥/截屏泄漏）；留空保存 = 保留原密钥
      const hasKey = isCloudStored && (stored.hasKey || stored.apiKey); // 主进程只回传「是否已保存」，不回显密钥本身
      const sessionOnlyStored = isCloudStored && stored.sessionOnly === true;
      const key = textInput(
        sessionOnlyStored
          ? 'API 密钥（仅本次运行有效 · 重启后需重填）'
          : (hasKey ? 'API 密钥（已加密保存 · 留空保留原密钥）' : 'API 密钥（safeStorage 加密存储，只在本机）'),
        '', hasKey ? '已保存，重填可覆盖' : 'sk-…', 'password'
      );
      keyInput = key.input;

      // 「只本次运行使用」：密钥只留在主进程内存里，不写盘。
      // 给的是「明文保存」与「不保存」之外的第三个选择（评审 P3）。
      const sessionOnly = el('label', { style: 'display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--ink-2);line-height:1.6;' }, [
        el('input', { type: 'checkbox', name: 'apiKeySessionOnly', checked: sessionOnlyStored ? 'checked' : null, style: 'margin-top:3px;' }),
        el('span', {}, ['只本次运行使用，不写入本机（重启应用后需要重新填写）'])
      ]);
      sessionOnlyInput = sessionOnly.querySelector('input');

      // 系统加密不可用时，密钥只能明文落盘 —— 保存前必须让用户知道，不能默默保存
      const plainWarn = el('p', { style: 'font-size:11.5px;color:#b45309;margin:2px 0 0;line-height:1.7;display:none;' },
        ['⚠ 这台机器上没有可用的系统加密（safeStorage 不可用），密钥会以明文形式存放在本机数据文件中。共用电脑建议勾选上面的「只本次运行使用」，或改用本机模型。']);
      call(window.api.secure.status()).then((st) => {
        if (st && st.available === false) plainWarn.style.display = 'block';
      }).catch(() => { /* 探测失败就不吓唬用户 */ });

      fieldsBox.append(
        el('label', { class: 'field' }, [el('span', {}, ['服务商预设']), presetSelect]),
        ep.row, md.row, key.row, sessionOnly, plainWarn, temp.row
      );
    } else {
      const ep = textInput('Ollama 地址', !isCloudStored ? (stored.endpoint || 'http://127.0.0.1:11434') : 'http://127.0.0.1:11434');
      endpointInput = ep.input;
      const md = textInput('模型名称', !isCloudStored ? (stored.model || 'qwen2.5:7b') : 'qwen2.5:7b');
      modelInput = md.input;
      fieldsBox.append(ep.row, md.row, temp.row);
    }
  }

  segBtns.embedded.addEventListener('click', () => { provider = 'embedded'; renderFields(); });
  segBtns.ollama.addEventListener('click', () => { provider = 'ollama'; renderFields(); });
  segBtns.cloud.addEventListener('click', () => { provider = 'cloud'; renderFields(); });
  renderFields();

  async function save() {
    const value = { provider };
    if (provider === 'embedded') {
      value.endpoint = 'app://embedded';
      value.model = 'qwen2.5-0.5b';
      value.temperature = 0.3;
      if (!window.EmbeddedLlm || !window.EmbeddedLlm.isEngineReady()) {
        // 允许保存（下次点运行前会再提示），但给个提醒
        toast('已保存。提示：模型还没下载，运行前请先在配置里点「下载模型到本机」', 'notify');
      }
    } else {
      const temperature = Math.max(0, Math.min(1, parseFloat(tempInput.value) || 0.3));
      value.temperature = temperature;
      value.endpoint = (endpointInput.value || '').trim();
      value.model = (modelInput.value || '').trim();
      if (provider === 'cloud') {
        const typed = (keyInput.value || '').trim();
        if (typed) {
          value.apiKey = typed; // 新填的密钥
        }
        // 勾了「只本次运行使用」：告诉主进程别写盘（密钥只在主进程内存里活到退出）
        value.apiKeySessionOnly = !!(sessionOnlyInput && sessionOnlyInput.checked);
        // 留空 = 保留已保存的密钥：密钥不回显到渲染层，由主进程在保存时补回原值
        if (!value.endpoint || !value.model || (!value.apiKey && !hasKey && !value.apiKeySessionOnly)) {
          toast('云端模式需填写 API 地址、模型名称与 API 密钥', 'err');
          return;
        }
      } else {
        value.endpoint = value.endpoint || 'http://127.0.0.1:11434';
        value.model = value.model || 'qwen2.5:7b';
      }
    }
    try {
      if (_agentMode) value.mode = _agentMode; // 保存配置不能把「记住的通道」抹掉
      await call(window.api.settings.save('agent', value));
      _agentStatus = null; // 重新探测
      close();
      toast('配置已保存，正在检测模型服务…', 'ok');
      renderResumePage();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  const box = el('div', { class: 'modal-box modal-box-wide' }, [
    el('h3', { class: 'modal-title' }, ['Agent 模型配置']),
    el('p', { style: 'font-size:12px;color:var(--ink-2);margin-bottom:12px;line-height:1.7;' },
      ['三种模型来源：应用内模型（推荐，下载一次后离线用、零配置）、本地 Ollama 或其它本机服务（全程不出本机）、云端 API（DeepSeek / Kimi / 通义 / OpenAI，密钥自备只存本机）。无论哪种，改写都先过本地确定性校验门。不想用任何模型的话，用「零配置（规则）」通道即可。']),
    detectBox,
    el('div', { class: 'seg' }, [segBtns.embedded, segBtns.ollama, segBtns.cloud]),
    fieldsBox,
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: close }, ['取消']),
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: save }, ['保存'])
    ])
  ]);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

async function openAgentRun() {
  // 零配置（规则）通道不需要任何模型，直接开跑
  if (_agentMode !== 'rules' && (!_agentStatus || !_agentStatus.available)) {
    const prov = _agentStatus && _agentStatus.config && _agentStatus.config.provider;
    const tip = '，或切到上方「零配置（规则）」直接跑（不需要任何模型）';
    if (prov === 'embedded') {
      toast('应用内模型未就绪：' + (_agentStatus.error || '到 ⚙ 配置 → 应用内模型 → 下载模型到本机') + tip, 'err');
    } else if (prov === 'cloud') {
      toast('云端模型未就绪：' + (_agentStatus.error || '请到 ⚙ 配置填写 API 地址与密钥') + tip, 'err');
    } else {
      toast('未检测到本地模型服务。可到 ⚙ 配置一键使用本机已装的服务，或切到「零配置（规则）」' + tip, 'err');
    }
    return;
  }
  if (!state.profile) { toast('请先填写档案', 'err'); return; }

  // JD 优先用已粘贴的，否则现贴一份（Agent 有目标函数才有方向）
  let jd = state.jdText || '';
  if (!jd) {
    jd = await modalTextarea('先贴一份目标 JD', {
      label: '职位描述（Agent 将对着这份 JD 优化）',
      placeholder: '把职位描述完整粘贴到这里…',
      submitText: '开始优化'
    });
    if (!jd) return;
    state.jdText = jd;
  }

  // ---- 运行模态：步骤实时滚入 + LLM 流式打字机预览 ----
  const stepsBox = el('div', { class: 'agent-steps' }, []);
  const streamBox = el('pre', { class: 'agent-stream' }, []);
  streamBox.style.display = 'none';
  const rulesMode = _agentMode === 'rules';
  const overlay = el('div', { class: 'modal-overlay' });
  const box = el('div', { class: 'modal-box modal-box-wide' }, [
    el('h3', { class: 'modal-title' }, [rulesMode ? '按 JD 优化 · 规则引擎（无模型）' : 'Agent 深度优化 · 运行中']),
    el('p', { style: 'font-size:12px;color:var(--ink-2);margin-bottom:12px;' },
      [rulesMode
        ? '零配置模式：不调用任何模型，由确定性规则引擎完成改写，秒级完成。'
        : '本地模型推理需要一些时间，每个步骤完成后会实时出现在下面。']),
    stepsBox,
    streamBox,
    el('div', { class: 'modal-actions' }, [])
  ]);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // runId 由渲染层生成并传给主进程：用户点「取消」时主进程能立刻定位到这次运行。
  // 取消是「在安全点退出」，已完成的改写会保留（不是白跑）。
  const runId = 'run_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  const cancelBtn = el('button', {
    class: 'btn btn-ghost btn-sm', type: 'button', style: 'margin-right:auto;',
    onclick: async () => {
      cancelBtn.disabled = true;
      cancelBtn.textContent = '正在取消…';
      try {
        await call(window.api.agent.cancel(runId));
      } catch (err) {
        toast(err.message, 'err');
        cancelBtn.disabled = false;
        cancelBtn.textContent = '取消这次运行';
      }
    }
  }, ['取消这次运行']);
  const actions = box.querySelector('.modal-actions');
  if (actions && !rulesMode) actions.appendChild(cancelBtn);

  // 收集步骤轨迹：结果视图会重建 box，轨迹要保留下来（它是「这轮真的跑了什么」的证据）
  const collectedSteps = [];
  const unsub = window.api.agent.onProgress((s) => {
    collectedSteps.push(s);
    stepsBox.appendChild(el('div', { class: 'agent-step' + (s.ok ? '' : ' bad') }, [
      el('span', { class: 'st-ico' }, [s.ok ? '✓' : '✕']),
      el('span', { class: 'st-label' }, [s.label]),
      el('span', { class: 'st-detail' }, [s.detail + ' · ' + s.ms + 'ms' + (s.retryCount ? ' · 重试 ' + s.retryCount + ' 次' : '')])
    ]));
    stepsBox.scrollTop = stepsBox.scrollHeight;
  });

  // LLM 流式分片：换轮次清空重放，同轮次追加（保留最近 4000 字符）
  let lastStreamRound = 0;
  const unsubStream = window.api.agent.onStream((ev) => {
    if (!ev || typeof ev.piece !== 'string') return;
    if (ev.round !== lastStreamRound) {
      lastStreamRound = ev.round;
      streamBox.textContent = '';
      streamBox.style.display = 'block';
    }
    streamBox.textContent += ev.piece;
    if (streamBox.textContent.length > 4000) {
      streamBox.textContent = streamBox.textContent.slice(-4000);
    }
    streamBox.scrollTop = streamBox.scrollHeight;
  });

  let result = null;
  let error = null;
  try {
    result = await call(window.api.agent.run(state.profile, jd, { mode: _agentMode, runId }));
  } catch (err) {
    error = err.message;
  } finally {
    unsub();
    unsubStream();
  }

  if (window.Sound) window.Sound.play(result && result.ok ? 'done' : 'err'); // Agent 收工音
  // 用 result.steps（权威、与结果同一次返回）而不是运行期收集的事件：
  // 步骤走 agent:progress 事件通道、结果走 invoke 返回值，两条路径存在竞态——
  // 规则通道只需几毫秒，响应常比事件先到，用事件拼出来的轨迹会缺步。
  renderAgentResult(overlay, box, result, error, (result && result.steps) || collectedSteps);
}

// 运行结束：进度模态 → 结果视图（前后对比 + diff + 应用按钮）
function renderAgentResult(overlay, box, result, error, steps) {
  box.innerHTML = '';

  // 注意：ok=false 不等于「没有可用结果」。关键步骤没做完（partial）时，
  // 过了校验门的改写仍然应该给用户看并允许应用 —— 否则修一个诚实性问题反而变成让用户白跑。
  const usableCount = result && result.accepted ? result.accepted.length : 0;
  if (error || !result || (!result.ok && usableCount === 0)) {
    box.append(
      el('h3', { class: 'modal-title' }, ['Agent 优化未成功']),
      el('p', { style: 'font-size:13px;color:var(--danger);line-height:1.7;' },
        [error || (result && result.error) || '所有改写均未通过确定性校验，档案保持原样。']),
      result && result.rejected && result.rejected.length
        ? el('div', { class: 'tips-list' }, result.rejected.map((r) =>
            el('div', { class: 'tip' }, [r.id + '：' + r.reason])))
        : null,
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => overlay.remove() }, ['知道了'])
      ])
    );
    return;
  }

  const up = (a, b) => b > a ? '（↑' + (b - a) + '）' : (b < a ? '（↓' + (b - a) + '）' : '（持平）');
  // 如实标注这次结果来自哪条通道（规则通道 ≠ LLM 改写，不能让用户误以为是大模型做的）
  const isRules = result.mode === 'rules';
  box.appendChild(el('div', { class: 'agent-mode-tag' + (isRules ? ' rules' : '') },
    [isRules ? '通道：确定性规则引擎（无模型 · 可复现）' : '通道：LLM 改写（' + ((_agentStatus && _agentStatus.config && _agentStatus.config.model) || '模型') + '）']));
  if (isRules) {
    box.appendChild(el('p', { style: 'font-size:12px;color:var(--ink-2);line-height:1.7;margin:6px 0 12px;' },
      ['规则通道擅长删套话、强化动词、保量化、按 JD 对齐表述，但不会按 JD 语义重组句子或生成全新内容。想要那一层，可在上方切到「流水线 / 自主 Agent」（需模型）。']));
  }
  const stat = (label, a, b, suffix) =>
    el('div', { class: 'agent-stat' }, [
      el('span', {}, [label]),
      el('b', {}, [a + suffix + ' → ' + b + suffix + up(a, b)])
    ]);

  // 步骤轨迹（可折叠）：结果视图会重建 box，这里把刚才跑过的步骤保留下来，
  // 让「这轮到底做了什么」可核对——规则通道尤其需要它来自证可复现
  let stepsBlock = null;
  if (Array.isArray(steps) && steps.length) {
    const stepList = el('div', { class: 'agent-steps', style: 'display:none;max-height:180px;overflow:auto;' },
      steps.map((s) => el('div', { class: 'agent-step' + (s.ok ? '' : ' bad') }, [
        el('span', { class: 'st-ico' }, [s.ok ? '✓' : '✕']),
        el('span', { class: 'st-label' }, [s.label]),
        el('span', { class: 'st-detail' }, [s.detail + ' · ' + s.ms + 'ms'])
      ])));
    const toggle = el('button', { class: 'qi-toggle', type: 'button' }, ['查看步骤轨迹 ▾']);
    toggle.addEventListener('click', () => {
      const open = stepList.style.display !== 'none';
      stepList.style.display = open ? 'none' : 'block';
      toggle.textContent = open ? '查看步骤轨迹 ▾' : '收起步骤轨迹 ▴';
    });
    stepsBlock = el('div', { style: 'margin:10px 0 0;' }, [
      el('div', { style: 'display:flex;align-items:center;gap:8px;' }, [
        el('span', { style: 'font-size:12px;color:var(--ink-2);' }, ['本轮 ' + steps.length + ' 步']),
        toggle
      ]),
      stepList
    ]);
  }

  // 逐条勾选审批（human-in-the-loop）：默认全选，取消勾选的条目保留原文
  const rewriteNodes = result.accepted.map((r) =>
    el('div', { class: 'agent-rw', 'data-id': r.id }, [
      el('input', { type: 'checkbox', checked: 'checked', title: '取消勾选则保留原文' }),
      el('div', { class: 'rw-body' }, [
        el('div', { class: 'rw-old' }, [r.old]),
        el('div', { class: 'rw-arrow' }, ['↳']),
        el('div', { class: 'rw-new' }, [r.text])
      ])
    ]));

  box.append(
    el('h3', { class: 'modal-title' }, ['Agent 优化完成 · ' + result.rounds + ' 轮']),
    stat('去 AI 味体检', result.auditBefore, result.auditAfter, ' 分'),
    stat('JD 技能覆盖', result.jdBefore, result.jdAfter, '%'),
    stepsBlock,
    result.jdMissingAfter && result.jdMissingAfter.length
      ? el('p', { style: 'font-size:12px;color:var(--ink-2);margin:6px 0 0;' },
          ['仍缺失：' + result.jdMissingAfter.slice(0, 8).join('、') + '，会的话手动补进技能或项目。'])
      : null,
    result.contextOmitted
      ? el('p', { style: 'font-size:12px;color:var(--ink-2);margin:6px 0 0;' },
          ['另有 ' + result.contextOmitted + ' 段经历与该 JD 相关度低，未送入本轮改写。'])
      : null,
    // Agent 提前收工时的如实标注：做了多少说多少，不让「部分完成」看起来像完成。
    // ok=false + partial 的这次运行会走到这里（而不是失败页），所以警告要写得足够显眼。
    result.incomplete
      ? el('div', {
          style: 'margin:10px 0 0;padding:9px 12px;border-radius:6px;background:#fff7ed;' +
            'border-left:3px solid #f59e0b;font-size:12px;color:#92400e;line-height:1.7;'
        }, [
          el('b', {}, ['⚠ 这次运行不算完成']),
          el('span', {}, ['：' + result.incomplete + '。下面这些改写本身是过了校验门的，可以用；' +
            '但上面的覆盖率对比仅供参考，建议按这份 JD 再跑一轮。'])
        ])
      : null,
    el('p', { style: 'font-size:12.5px;color:var(--ink-1);margin:14px 0 0;font-weight:600;' },
      ['共 ' + result.accepted.length + ' 条改写通过校验，取消勾选可保留对应原文：']),
    el('div', { class: 'agent-rw-list' }, rewriteNodes),
    result.rejected.length
      ? el('p', { style: 'font-size:12px;color:var(--ink-2);' },
          [result.rejected.length + ' 条未通过校验被拒收，保持原文。'])
      : null,
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => overlay.remove() }, ['放弃']),
      el('button', {
        class: 'btn btn-primary btn-sm', type: 'button',
        onclick: async () => {
          const ids = new Set(
            Array.from(box.querySelectorAll('.agent-rw'))
              .filter((row) => {
                const cb = row.querySelector('input[type="checkbox"]');
                return cb && cb.checked;
              })
              .map((row) => row.dataset.id)
          );
          const selected = result.accepted.filter((r) => ids.has(r.id));
          if (!selected.length) { toast('请至少勾选一条改写', 'err'); return; }
          overlay.remove();
          await applyAgentResult(result, selected);
        }
      }, ['应用选中的改写'])
    ])
  );
}

// 应用：被勾选的改写按条目位置替换 description 行（未勾选/拒收的行保持原文）
// ---------------- Agent 快照（后悔药） ----------------
// 应用改写前自动快照当前档案；写入走主进程 settings:save 的 agentSnapshot 通道
async function saveSnapshotBeforeApply() {
  try {
    // 复用 settings 通道：主进程在 agent:run 应用侧没有专门入口，
    // 这里直接用 snapshots 表的写入能力（经 settings:save 存元数据）
    // —— 简洁起见：由主进程 saveProfile 前不做拦截，由渲染层显式调用。
    const label = 'Agent 改写前 · ' + new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    await call(window.api.snapshots.save(state.user.id, label, state.profile));
    return true;
  } catch (_) {
    return false; // 快照失败不阻断应用（用户已逐条勾选确认过）
  }
}

async function applyAgentResult(result, acceptedList) {
  const accepted = acceptedList || result.accepted;
  if (!accepted || !accepted.length) { toast('请至少勾选一条改写', 'err'); return; }

  // 切分与回填交给主进程引擎（applyRewrites）：导入器产出的 description 是 string[]，
  // 渲染层再自己实现一套切分就会和引擎漂移——错行、重复、甚至把整段描述压成一行。
  let next;
  try {
    next = await call(window.api.resume.applyRewrites(state.profile, accepted));
  } catch (err) {
    toast('应用失败：' + err.message, 'err');
    return;
  }

  // 后悔药：应用前快照当前档案（失败不阻断——用户已逐条勾选）
  const snapped = await saveSnapshotBeforeApply();

  try {
    state.profile = await call(window.api.profile.save(state.user.id, next));
    toast(snapped ? '已应用并保存（改写前档案已备份，可在信息录入页回炉）' : 'Agent 优化已应用并保存', 'ok');
    renderResumePage();
  } catch (err) {
    toast('应用失败：' + err.message, 'err');
  }
}

async function exportPdf() {
  try {
    const cssText = await fetchCss();
    const html = window.Template.renderResumeDocument(state.lastResume.resume, state.template, cssText);
    const name = (state.profile.name || 'resume') + '_' + (state.profile.targetRole || '简历');
    const res = await window.api.resume.exportPdf(html, name);
    if (res.ok) toast('PDF 已导出到：' + res.data.filePath, 'ok');
    else toast(res.error, 'err');
  } catch (err) {
    toast(err.message, 'err');
  }
}

let _cssCache = null;
async function fetchCss() {
  if (_cssCache) return _cssCache;
  const resp = await fetch('styles.css');
  _cssCache = await resp.text();
  return _cssCache;
}

// ---------------- 纯文本简历（一键复制，粘贴到招聘网站 / 邮件正文） ----------------
function buildPlainText(resume) {
  const b = resume.basics || {};
  const out = [];
  out.push(b.name || '简历');
  out.push([b.phone, b.email, b.city, window.Template.portfolioLine(b.github)].filter(Boolean).join(' | '));
  if (b.targetRole) out.push('求职意向：' + b.targetRole);
  if (resume.summary) {
    out.push('', '【个人简介】', resume.summary);
  }
  if (resume.education && resume.education.length) {
    out.push('', '【教育背景】');
    resume.education.forEach((ed) => {
      out.push([ed.school, ed.major, ed.degree].filter(Boolean).join(' · ') + (ed.period ? '（' + ed.period + '）' : ''));
      const sub = [ed.gpa ? 'GPA ' + ed.gpa : '', ed.courses ? '主修：' + ed.courses : ''].filter(Boolean).join('，');
      if (sub) out.push(sub);
    });
  }
  if (resume.skills && resume.skills.length) {
    out.push('', '【专业技能】', resume.skills.join(' / '));
  }
  [['实习经历', resume.internships], ['项目经历', resume.projects]].forEach(([title, items]) => {
    if (!items || !items.length) return;
    out.push('', '【' + title + '】');
    items.forEach((it) => {
      out.push([it.name, it.role].filter(Boolean).join(' · ') + (it.period ? '（' + it.period + '）' : ''));
      if (it.tech) out.push('技术栈：' + it.tech);
      (it.bullets || []).forEach((x) => out.push('- ' + x));
      out.push('');
    });
  });
  if (resume.awards && resume.awards.length) {
    out.push('', '【奖项与证书】');
    resume.awards.forEach((a) => out.push('- ' + a));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function copyResumeText() {
  if (!state.lastResume || !state.lastResume.resume) {
    toast('请先生成简历', 'err');
    return;
  }
  try {
    const text = buildPlainText(state.lastResume.resume);
    const res = await window.api.clipboard.writeText(text);
    if (res && res.ok) toast('纯文本简历已复制，可直接粘贴到招聘网站', 'ok');
    else toast((res && res.error) || '复制失败', 'err');
  } catch (err) {
    toast(err.message, 'err');
  }
}

// Ctrl+S：在「信息录入」页快捷保存
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || (e.key !== 's' && e.key !== 'S')) return;
  if (!state.user) return;
  const profileRoute = document.getElementById('route-profile');
  if (!profileRoute || profileRoute.style.display === 'none') return;
  e.preventDefault();
  onSaveProfile();
});

// ---------------- 页面 3：投递管理 ----------------
const STAGES = [
  { key: 'wish', label: '想投' },
  { key: 'applied', label: '已投递' },
  { key: 'interview', label: '面试中' },
  { key: 'offer', label: 'Offer / 结束' }
];

// 粘贴导入：把招聘网站上复制来的岗位信息在本机解析成投递记录。
// 刻意不做抓取 —— 那要绕过反爬，既违法也会连累用户自己的求职账号。
async function openPasteImport() {
  if (!window.JobImport) { toast('导入模块没加载成功，请重启应用', 'err'); return; }
  try {
    await window.JobImport.openImportDialog({
      userId: state.user.id,
      applications: state.applications,
      onChanged: async () => {
        try { state.applications = await call(window.api.applications.list(state.user.id)); } catch (_) { /* 忽略 */ }
        renderApps();
      }
    });
  } catch (err) {
    toast('导入失败：' + ((err && err.message) || err), 'err');
  }
}

// 从招聘平台同步投递记录：只读旁路，让平台页面自己鉴权，应用读取其返回的数据。
async function openPlatformSync() {
  if (!window.JobSync) { toast('同步模块没加载成功，请重启应用', 'err'); return; }
  try {
    await window.JobSync.openPanel({
      userId: state.user.id,
      onChanged: async () => {
        try { state.applications = await call(window.api.applications.list(state.user.id)); } catch (_) { /* 忽略 */ }
        renderApps();
      }
    });
  } catch (err) {
    toast('同步面板打开失败：' + ((err && err.message) || err), 'err');
  }
}

async function openAuthorizedImport() {
  const data = await modalForm('导入官方授权数据', [
    { name: 'source', label: '招聘平台名称', placeholder: '如：BOSS直聘 / 智联招聘' },
    { name: 'json', label: '平台官方导出 JSON', placeholder: '{"items":[{"externalId":"...","company":"...","position":"...","stage":"applied"}]}' }
  ], '导入');
  if (!data || !String(data.source || '').trim() || !String(data.json || '').trim()) return;
  let payload;
  try { payload = JSON.parse(String(data.json)); } catch (_) { toast('JSON 格式错误，请粘贴平台官方导出的 JSON', 'err'); return; }
  payload.source = String(data.source).trim();
  if (!Array.isArray(payload.items)) { toast('授权数据必须包含 items 数组', 'err'); return; }
  try {
    const res = await call(window.api.applications.importAuthorized(state.user.id, payload));
    toast('官方授权导入完成：新增 ' + res.added + ' 条 / 更新 ' + res.updated + ' 条' + (res.skipped ? ' / 跳过 ' + res.skipped + ' 条' : ''), 'ok');
    state.applications = await call(window.api.applications.list(state.user.id));
    renderApps();
  } catch (err) { toast('官方授权导入失败：' + ((err && err.message) || err), 'err'); }
}

async function openAddApplication() {
  const data = await modalForm('新增投递', [
    { name: 'company', label: '公司名称', placeholder: '如：字节跳动' },
    { name: 'position', label: '岗位名称', value: state.profile.targetRole || '软件开发工程师' },
    // 所在地只用来算「离学校多远」，从招聘平台上抄下来即可（BOSS 上写的就是「北京·朝阳区」这种）
    { name: 'place', label: '公司所在地（选填，用于算距离）', placeholder: '如：北京·朝阳区 / 深圳 南山' }
  ], '添加');
  if (!data || !data.company) return;
  saveApplication({
    company: data.company,
    position: data.position,
    place: String(data.place || '').trim(),
    stage: 'wish'
  });
}

// 打开某企业官网投递入口，并自动落一条投递记录（去重：同公司已存在则只更新时间/链接）
async function applyToCompany(company) {
  try {
    const res = await window.api.shell.openExternal(company.url);
    if (!res.ok) { toast(res.error, 'err'); return; }
    const existing = state.applications.find((a) => a.company === company.name);
    const position = state.profile.targetRole || '软件开发工程师';
    // 预填「总部所在城市」：可以直接算距离；实际岗位挂别的城市时用户能改
    const place = company.city || '';
    if (existing) {
      await saveApplication({ id: existing.id, url: company.url, place: existing.place || place, stage: existing.stage || 'applied' });
      toast('已打开「' + company.name + '」官网投递页', 'ok');
    } else {
      await saveApplication({ company: company.name, position, url: company.url, place: place, stage: 'applied' });
      toast('已打开「' + company.name + '」官网，并记入「已投递」' + (place ? '（所在地按总部预填为 ' + place + '）' : ''), 'ok');
    }
  } catch (err) {
    toast(err.message, 'err');
  }
}

// 用“目标岗位”关键词直达综合招聘平台搜索结果页（面向中小厂 / 民办本科）
async function searchOnPlatform(platform) {
  let keyword = ((state.profile && state.profile.targetRole) || '').trim();
  if (!keyword) {
    const data = await modalForm('搜索岗位', [
      { name: 'kw', label: '目标岗位关键词', placeholder: '如：Java 开发工程师' }
    ], '搜索');
    if (!data || !data.kw) return;
    keyword = data.kw.trim();
  }
  const url = platform.url.replace('{kw}', encodeURIComponent(keyword));
  try {
    const res = await window.api.shell.openExternal(url);
    if (!res.ok) { toast(res.error, 'err'); return; }
    toast('已用「' + keyword + '」在' + platform.name + '打开岗位搜索页', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function saveApplication(appData) {
  try {
    const saved = await call(window.api.applications.save(state.user.id, appData));
    const idx = state.applications.findIndex((a) => a.id === saved.id);
    if (idx >= 0) state.applications[idx] = saved;
    else state.applications.unshift(saved);
    toast('投递记录已更新', 'ok');
    if (document.getElementById('route-apps').style.display !== 'none') renderApps();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function renderApps() {
  const root = document.getElementById('route-apps');
  root.innerHTML = '';

  const head = el('div', { class: 'page-head' }, [
    el('div', { class: 'page-kicker' }, ['STEP 03 / 投递管理']),
    el('h1', { class: 'page-title' }, ['把每一次投递管起来']),
    el('p', { class: 'page-desc' }, ['像看板一样跟踪投递进度，随时更新状态。所有记录只保存在你本机。'])
  ]);

  // 顶部统计条：投递管线一览（取代干巴巴的「共 N 条」）
  const stageCount = (key) => state.applications.filter((a) => (a.stage || 'wish') === key).length;
  const pipeline = el('div', { class: 'pipeline' }, STAGES.map((stage, i) => {
    const n = stageCount(stage.key);
    return [
      i ? el('span', { class: 'pl-arrow' }, ['▸']) : null,
      el('div', { class: 'pl-node s-' + stage.key }, [
        el('b', {}, [String(n)]),
        el('span', {}, [stage.label])
      ])
    ];
  }).flat().filter(Boolean));

  const toolbar = el('div', { class: 'toolbar' }, [
    el('button', { class: 'btn btn-primary', type: 'button', onclick: openAddApplication }, [window.Icons.icon('plus', 15), '新增投递']),
    // 粘贴导入：把招聘网站上复制来的岗位信息在本机解析成记录（不联网、不抓取）
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: openPasteImport }, ['粘贴导入']),
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: openPlatformSync }, ['从平台同步']),
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: openAuthorizedImport }, ['官方授权导入']),
    el('div', { class: 'spacer' }),
    pipeline
  ]);

  // 主入口：按目标岗位关键词搜中小厂（民办本科 / 非大厂更友好，岗位集中在综合招聘平台）
  const keyword = (state.profile && state.profile.targetRole) || '';
  const city = (state.profile && state.profile.city) || '';
  const platforms = (window.SuggestData && window.SuggestData.platforms) || [];
  const platformHead = el('div', { class: 'direct-head' }, [
    el('h3', {}, [window.Icons.icon('search', 15), '按岗位搜中小厂']),
    el('span', { class: 'direct-tip' }, [
      keyword
        ? '当前岗位：' + keyword + (city ? ' · ' + city : '') + ' · 点平台直达搜索结果'
        : '先到「基本信息」填写目标岗位，或点击平台后手动输入关键词'
    ])
  ]);
  const platformGrid = el('div', { class: 'direct-grid' }, platforms.map((p) => {
    return el('button', {
      class: 'platform-chip' + (p.hot ? ' hot' : ''),
      type: 'button',
      title: '在 ' + p.name + ' 搜索' + (keyword ? '「' + keyword + '」' : '岗位'),
      onclick: () => searchOnPlatform(p)
    }, [
      el('span', { class: 'c-name' }, [p.name, p.hot ? el('span', { class: 'hot-dot' }, ['荐']) : null]),
      el('span', { class: 'c-tag' }, [p.tag]),
      el('span', { class: 'c-go' }, ['搜索 →'])
    ]);
  }));
  const platformPanel = el('div', { class: 'direct-panel primary' }, [platformHead, platformGrid]);

  // 次要入口：名企一键直投（多卡学校 / 学历，作为补充）
  const readyResume = !!state.lastResume;
  const companies = (window.SuggestData && window.SuggestData.companies) || [];
  const directHead = el('div', { class: 'direct-head' }, [
    el('h3', {}, [window.Icons.icon('building', 15), '名企一键直投']),
    el('span', { class: 'direct-tip' }, [
      readyResume ? '简历已就绪 · 冲一冲大厂也可' : '大厂多卡学校 / 学历，可作为补充选择'
    ])
  ]);
  const directGrid = el('div', { class: 'direct-grid' }, companies.map((c) => {
    const applied = state.applications.some((a) => a.company === c.name);
    return el('button', {
      class: 'company-chip' + (applied ? ' applied' : ''),
      type: 'button',
      title: '打开 ' + c.name + ' 官方招聘页',
      onclick: () => applyToCompany(c)
    }, [
      el('span', { class: 'c-name' }, [c.name]),
      el('span', { class: 'c-tag' }, [applied ? '已投 ✓' : c.tag]),
      el('span', { class: 'c-go' }, ['投递 →'])
    ]);
  }));
  const directPanel = el('div', { class: 'direct-panel' }, [directHead, directGrid]);

  const STAGE_ICONS = { wish: 'target', applied: 'send', interview: 'rocket', offer: 'check' };
  const board = el('div', { class: 'board' }, STAGES.map((stage) => {
    const cards = state.applications.filter((a) => (a.stage || 'wish') === stage.key);
    return el('div', { class: 'column stage-' + stage.key }, [
      el('h4', {}, [
        el('span', { class: 'h4-label' }, [window.Icons.icon(STAGE_ICONS[stage.key], 14), stage.label]),
        el('span', { class: 'count' }, [String(cards.length)])
      ]),
      ...(cards.length ? cards.map(appCard) : [el('div', { class: 'empty', style: 'padding:20px;font-size:13px;' }, ['暂无'])])
    ]);
  }));

  // 投递地点与距离：离线直线距离对比 + 可选在线地图。
  // 放在看板下面——先看进度，再看「这些公司离我多远」。
  const mvHost = el('div', { class: 'mv-root' });
  root.append(head, toolbar, platformPanel, directPanel, board, mvHost);
  // 能走到投递页就说明已登录，state.user 正常一定存在；但少一次判空就是一次未捕获异常，
  // 而 renderApps 抛错会连带打断它后面的渲染（真实冒烟里就复现过：只走 IPC 登录的
  // 测试进程 state.user 为空，这里直接抛 TypeError）。
  if (window.MapView && state.user && state.user.id) {
    window.MapView.render(mvHost, {
      applications: state.applications,
      userId: state.user.id,
      onChanged: async () => {
        try { state.applications = await call(window.api.applications.list(state.user.id)); } catch (_) { /* 忽略 */ }
        renderApps();
      }
    });
  } else if (window.MapView) {
    console.warn('[map] 没有登录态（state.user 为空），跳过距离面板');
  }
}

// 相对时间：投递卡片上显示「多久前更新」，方便回溯跟进节奏
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - Number(ts);
  if (!(diff >= 0)) return '';
  const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  if (diff < MIN) return '刚刚更新';
  if (diff < HOUR) return Math.floor(diff / MIN) + ' 分钟前更新';
  if (diff < DAY) return Math.floor(diff / HOUR) + ' 小时前更新';
  if (diff < 30 * DAY) return Math.floor(diff / DAY) + ' 天前更新';
  const d = new Date(Number(ts));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function appCard(a) {
  const meta = extractAppJobMeta(a);
  const select = el('select', {
    onchange: (e) => saveApplication({ id: a.id, stage: e.target.value })
  }, STAGES.map((s) => el('option', { value: s.key, selected: (a.stage || 'wish') === s.key ? 'selected' : null }, [s.label])));

  const actions = [select];
  // 有官网链接时，提供“打开官网”快捷入口
  if (a.url) {
    actions.push(el('button', {
      class: 'open', type: 'button', title: '打开官网投递页',
      onclick: async () => {
        const res = await window.api.shell.openExternal(a.url);
        if (!res.ok) toast(res.error, 'err');
      }
    }, ['官网']));
  }
  // 存进岗位池：把投递记录里从官网/平台拿到的公司、岗位、地点、链接一并带过去，
  // 方便在池子里横向比较、记 JD、打分，而不是只能躺在看板里。
  actions.push(el('button', {
    class: 'to-pool', type: 'button', title: '把这条记录存进岗位池',
    onclick: async (e) => {
      e.stopPropagation();
      await saveApplicationToJobPool(a);
    }
  }, ['存池']));
  // 编辑：补齐薪资/学历/经验等从官网拿到的字段，再存池时一并带走
  actions.push(el('button', {
    class: 'edit', type: 'button', title: '编辑这条投递记录',
    onclick: (e) => { e.stopPropagation(); openEditApplication(a); }
  }, ['编辑']));
  actions.push(el('button', { class: 'del', type: 'button', onclick: async () => {
    try {
      await call(window.api.applications.remove(state.user.id, a.id));
      // 这条投递来自岗位池时，清掉岗位侧关联，否则岗位会一直显示「已转投递」
      if (a.jobId) {
        try {
          const updated = await call(window.api.jobs.save(state.user.id, {
            id: a.jobId, company: a.company, applicationId: '', status: 'candidate'
          }));
          const jIdx = state.jobs.findIndex((j) => j.id === a.jobId);
          if (jIdx >= 0) state.jobs[jIdx] = updated;
        } catch (_) { /* 岗位可能已被删除，忽略 */ }
      }
      state.applications = state.applications.filter((x) => x.id !== a.id);
      renderApps();
    } catch (err) {
      toast(err.message, 'err');
    }
  } }, ['删除']));

  // 笔试提醒：有 examAt 就在卡片上直出，逾期标灰
  let examHint = null;
  if (a.examAt) {
    const t = Date.parse(String(a.examAt).replace(/-/g, '/'));
    const overdue = !isNaN(t) && t < Date.now();
    examHint = el('div', { class: 'app-exam-hint' + (overdue ? ' overdue' : '') }, [
      overdue ? '📝 笔试时间已过 · ' + a.examAt : '📝 笔试待完成 · ' + a.examAt
    ]);
  }

  return el('div', { class: 'app-card' }, [
    el('div', { class: 'co' }, [a.company]),
    el('div', { class: 'po' }, [a.position || '—']),
    // 地点 / 薪资 / 来源：都是从官网或平台抄下来的原文
    (a.place || a.source || meta.salary) ? el('div', { class: 'meta-line' }, [
      a.place ? el('span', {}, ['📍 ' + a.place]) : null,
      meta.salary ? el('span', { class: 'salary' }, ['💰 ' + meta.salary]) : null,
      a.source ? el('span', {}, [a.source]) : null
    ]) : null,
    examHint,
    el('div', { class: 'time' }, [timeAgo(a.updatedAt || a.createdAt)]),
    el('div', { class: 'row' }, actions)
  ]);
}

// 编辑投递记录：把官网上的薪资/学历/经验补齐，存池时就能一起带过去
async function openEditApplication(a) {
  const meta = extractAppJobMeta(a);
  const data = await modalForm('编辑投递记录', [
    { name: 'company', label: '公司名称（必填）', value: a.company, placeholder: '如：赞同科技' },
    { name: 'position', label: '岗位名称', value: a.position || '', placeholder: '如：大模型算法工程师' },
    { name: 'place', label: '工作地点', value: a.place || '', placeholder: '如：绵阳' },
    { name: 'salary', label: '薪资', value: meta.salary, placeholder: '如:12k-18k·14薪' },
    { name: 'education', label: '学历要求', value: meta.education, placeholder: '如：本科' },
    { name: 'experience', label: '经验要求', value: meta.experience, placeholder: '如：应届' },
    { name: 'url', label: '官网链接', value: a.url || '', placeholder: 'https://…' }
  ], '保存');
  if (!data) return;
  const company = String(data.company || '').trim();
  if (!company) { toast('公司名称必填', 'err'); return; }
  await saveApplication({
    id: a.id,
    company: company,
    position: String(data.position || '').trim(),
    place: String(data.place || '').trim(),
    salary: String(data.salary || '').trim(),
    education: String(data.education || '').trim(),
    experience: String(data.experience || '').trim(),
    url: String(data.url || '').trim()
  });
}

// 从岗位直接组卷：切到笔试中心并按该岗位的 JD/技能抽题
async function examFromJob(job) {
  navigate('exam');
  await startExam({ jobId: job.id, count: 20, durationSec: 1800, passScore: 60 });
}

// 设置笔试时间：写入投递记录的 examAt / nextAction（投递看板会显示「笔试待完成」）
async function setJobExamTime(job) {
  const app = (state.applications || []).find((a) => a.id === job.applicationId);
  if (!app) {
    toast('先点「转投递」，笔试时间会记在对应的投递记录上', 'err');
    return;
  }
  const data = await modalForm('设置笔试时间', [
    { name: 'examAt', label: '笔试时间（YYYY-MM-DD HH:mm）', value: app.examAt || '', placeholder: '如：2026-11-02 14:00' },
    { name: 'nextAction', label: '下一步行动', value: app.nextAction || '参加在线笔试', placeholder: '如：参加在线笔试' }
  ], '保存');
  if (!data) return;
  try {
    const updated = await call(window.api.applications.save(state.user.id, {
      id: app.id,
      company: app.company,
      examAt: String(data.examAt || '').trim(),
      nextAction: String(data.nextAction || '').trim()
    }));
    const i = state.applications.findIndex((x) => x.id === app.id);
    if (i >= 0) state.applications[i] = updated;
    toast(data.examAt ? '已记录笔试时间：' + data.examAt : '已清除笔试时间', 'ok');
    renderJobs();
  } catch (err) {
    toast(err.message, 'err');
  }
}

// 查看该岗位的组卷与成绩：直接切到笔试中心，历史成绩在那里统一看
async function showJobExamHistory(job) {
  try {
    const papers = await call(window.api.exam.listPapers());
    const mine = (papers || []).filter((p) => p.jobId === job.id);
    if (!mine.length) {
      toast('该岗位还没有组过卷，先点「按此岗位组卷」', 'err');
      return;
    }
    const attempts = await call(window.api.exam.listAttempts());
    const done = (attempts || []).filter((a) => a.status === 'submitted' && mine.some((p) => p.id === a.paperId));
    const best = done.length ? Math.max.apply(null, done.map((a) => a.score)) : null;
    toast('该岗位已组卷 ' + mine.length + ' 份 · 已考 ' + done.length + ' 次'
      + (best != null ? ' · 最高 ' + best + ' 分' : '') + '（历史见笔试中心）', 'ok', 4200);
    navigate('exam');
  } catch (err) {
    toast(err.message, 'err');
  }
}

// 从投递记录里提取岗位结构化信息。
// 新数据直接有 salary/education/experience 字段；老数据这些信息压在 notes
// 的「薪资：12k · 学历：本科 · 经验：应届」文本里，这里做一次回退解析。
function extractAppJobMeta(a) {
  const meta = {
    salary: String(a.salary || '').trim(),
    education: String(a.education || '').trim(),
    experience: String(a.experience || '').trim(),
    skills: String(a.skills || '').trim()
  };
  const notes = String(a.notes || '');
  if (notes) {
    const pick = (label) => {
      const m = notes.match(new RegExp(label + '\\s*[:：]\\s*([^·|,，;；\\n]+)'));
      return m ? String(m[1]).trim() : '';
    };
    if (!meta.salary) meta.salary = pick('薪资');
    if (!meta.education) meta.education = pick('学历');
    if (!meta.experience) meta.experience = pick('经验');
    if (!meta.skills) meta.skills = pick('技能');
  }
  return meta;
}

// 投递记录 → 岗位池：把看板上已有的公司/岗位/地点/链接搬进候选池。
// 去重口径：公司+岗位 相同，或 URL 相同，都算同一条。
async function saveApplicationToJobPool(a) {
  if (!state.jobs) state.jobs = [];
  const sameCoPo = (j) => (j.company || '') === (a.company || '')
    && (j.position || '') === (a.position || '');
  const sameUrl = (j) => !!a.url && j.url === a.url;
  if (state.jobs.some((j) => sameCoPo(j) || sameUrl(j))) {
    toast('「' + a.company + '」已在岗位池里', 'err');
    return;
  }
  const meta = extractAppJobMeta(a);
  try {
    const saved = await call(window.api.jobs.save(state.user.id, {
      company: a.company,
      position: a.position || '',
      city: a.place || '',
      url: a.url || '',
      source: a.source || '投递记录',
      salary: meta.salary,
      education: meta.education,
      experience: meta.experience,
      skills: meta.skills
    }));
    if (!state.jobs) state.jobs = [];
    const jIdx = state.jobs.findIndex((j) => j.id === saved.id);
    if (jIdx >= 0) state.jobs[jIdx] = saved; else state.jobs.unshift(saved);
    // 双向关联：投递记录回写 jobId（后端部分更新，不会清空其它字段）
    if (a.id) {
      try {
        const linked = await call(window.api.applications.save(state.user.id, {
          id: a.id, company: a.company, jobId: saved.id
        }));
        const aIdx = state.applications.findIndex((x) => x.id === a.id);
        if (aIdx >= 0) state.applications[aIdx] = linked;
      } catch (_) { /* 关联失败不影响入池本身 */ }
    }
    toast('已存入岗位池：' + saved.company, 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ---------------- 页面 3.5：岗位池 ----------------
// 本地化的「看中的岗子」。收藏浏览中发现的岗位 → 打分 → 择优转投递看板，
// 全程走本机 db.json，不联网、不上传。
// 与同步导入的分工：job-sync 导入的记录直接落到投递看板（已代表投递意向），
// 这里沉淀的是「还在犹豫要不要投」的候选池。

async function loadJobsIntoState() {
  state.jobs = await call(window.api.jobs.list(state.user.id));
}

// 把 Job 转成投递记录并落库；成功后岗位打上 applicationId（用 save 更新，不动其它字段）
// 岗位池 → 投递看板。三重防重：
// 1) 岗位已带 applicationId 且该投递记录仍存在 → 直接拒绝（避免重复转）；
// 2) 投递看板里已存在同公司+同岗位 → 拒绝并提示；
// 3) 后端 saveJob 统一去重兜底。
// 成功后双向写入：Application.jobId ←→ Job.applicationId。
async function applyFromJob(job) {
  if (!state.applications) state.applications = [];

  if (job.applicationId) {
    const linked = state.applications.find((a) => a.id === job.applicationId);
    if (linked) {
      toast('「' + job.company + '」已转投递（' + stageLabel(linked.stage) + '），无需重复转入', 'err');
      return;
    }
    // 关联的投递记录被删了：允许重新转入，旧 applicationId 会被覆盖
  }

  const position = job.position || (state.profile && state.profile.targetRole) || '';
  const dup = state.applications.find((a) =>
    String(a.company || '').trim() === String(job.company || '').trim()
    && String(a.position || '').trim() === String(position || '').trim());
  if (dup) {
    toast('投递看板里已有「' + job.company + ' · ' + (position || '未填岗位') + '」，未重复创建', 'err');
    return;
  }

  try {
    const created = await call(window.api.applications.save(state.user.id, {
      company: job.company,
      position: position,
      url: job.url || '',
      place: job.city || '',
      salary: job.salary || '',
      education: job.education || '',
      experience: job.experience || '',
      jobId: job.id, // 双向关联：投递记录指回岗位
      stage: 'wish'
    }));
    // 岗位侧写回 applicationId + 状态；saveJob 现在是部分更新，不会清空 JD/薪资
    const updated = await call(window.api.jobs.save(state.user.id, {
      id: job.id,
      company: job.company,
      applicationId: created.id,
      status: 'applied'
    }));
    const idx = state.jobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) state.jobs[idx] = updated;
    state.applications.unshift(created);
    toast('「' + job.company + '」已转入投递看板「想投」栏', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

// 阶段中文名：卡片提示与转投递校验都要用
function stageLabel(key) {
  const hit = STAGES.find((s) => s.key === (key || 'wish'));
  return hit ? hit.label : '想投';
}

// 点击岗位卡展开/收起 JD 全文，并浮出操作按钮
function toggleJobDetail(job, card) {
  if (card.dataset.expanded === '1') {
    card.querySelector('.job-detail').remove();
    card.dataset.expanded = '0';
    return;
  }
  card.dataset.expanded = '1';
  const detail = el('div', { class: 'job-detail' });
  if (job.benefits) {
    detail.appendChild(el('div', { class: 'jd-head' }, ['福利待遇']));
    detail.appendChild(el('div', { class: 'jd-benefits' }, [job.benefits]));
  }
  if (job.jdText) {
    detail.appendChild(el('div', { class: 'jd-head' }, ['JD 全文']));
    detail.appendChild(el('pre', { class: 'job-detail-jd' }, [job.jdText]));
  } else if (!job.benefits) {
    detail.appendChild(el('div', { class: 'jd-empty' }, ['（未保存 JD 文本）']));
  }
  // 笔试相关操作：组卷 / 设置笔试时间 / 看记录
  detail.appendChild(el('div', { class: 'job-detail-actions' }, [
    el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button',
      onclick: (e) => { e.stopPropagation(); examFromJob(job); }
    }, ['按此岗位组卷']),
    el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button',
      onclick: (e) => { e.stopPropagation(); setJobExamTime(job); }
    }, ['设置笔试时间']),
    el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button',
      onclick: (e) => { e.stopPropagation(); showJobExamHistory(job); }
    }, ['笔试记录'])
  ]));
  card.appendChild(detail);
}

// 新增/编辑岗位：基础信息用表单模态，JD 长文本单独用 textarea 模态。
// 编辑前先经 jobs:get 拉取库内最新数据，避免用过期的本地副本覆盖保存。
async function openJobEditor(job) {
  if (job && job.id) {
    try {
      const fresh = await call(window.api.jobs.get(state.user.id, job.id));
      if (fresh) job = fresh;
    } catch (err) {
      toast(err.message, 'err');
      return;
    }
  }
  if (!job) job = {};
  const data = await modalForm('岗位信息', [
    { name: 'company', label: '公司名称（必填）', value: job.company, placeholder: '如：字节跳动' },
    { name: 'position', label: '岗位名称', value: job.position, placeholder: '如：后端开发工程师' },
    { name: 'salary', label: '薪资（选填）', value: job.salary, placeholder: '如:12k-18k·14薪' },
    { name: 'city', label: '城市（选填）', value: job.city, placeholder: '如：北京' },
    { name: 'education', label: '学历要求（选填）', value: job.education, placeholder: '如：本科' },
    { name: 'experience', label: '经验要求（选填）', value: job.experience, placeholder: '如：应届' },
    { name: 'skills', label: '技能要求（选填）', value: job.skills, placeholder: '如：Java / Spring / Redis' },
    { name: 'jobType', label: '工作性质（选填）', value: job.jobType, placeholder: '如：校招 / 全职 / 实习' },
    { name: 'companySize', label: '公司规模（选填）', value: job.companySize, placeholder: '如：500-999人' },
    { name: 'deadline', label: '投递截止日期（选填）', value: job.deadline, placeholder: '如：2026-11-30' },
    { name: 'benefits', label: '福利待遇（选填）', value: job.benefits, placeholder: '如：六险一金 / 免费三餐 / 租房补贴' }
  ], '下一步');
  if (!data) return;
  const company = String(data.company || '').trim();
  if (!company) { toast('公司名称必填', 'err'); return; }

  // JD 长文本单独一次模态；跳过则保留原 JD 文本
  const jdText = await modalTextarea('岗位描述 JD（可留空跳过）', {
    label: '岗位描述 JD',
    value: job.jdText || '',
    placeholder: '粘贴招聘页面上复制来的岗位描述（可留空跳过）'
  });

  const payload = {
    company: company,
    position: String(data.position || '').trim(),
    salary: String(data.salary || '').trim(),
    city: String(data.city || '').trim(),
    education: String(data.education || '').trim(),
    experience: String(data.experience || '').trim(),
    skills: String(data.skills || '').trim(),
    jobType: String(data.jobType || '').trim(),
    companySize: String(data.companySize || '').trim(),
    deadline: String(data.deadline || '').trim(),
    benefits: String(data.benefits || '').trim(),
    source: job.source || '',
    url: String(job.url || '').trim(),
    starred: !!job.starred,
    rejected: !!job.rejected,
    rejectReason: job.rejectReason || '',
    priority: job.priority || 3,
    applicationId: job.applicationId || ''
  };
  if (jdText != null) payload.jdText = jdText;
  if (job && job.id) payload.id = job.id;

  try {
    const saved = await call(window.api.jobs.save(state.user.id, payload));
    const idx = state.jobs.findIndex((j) => j.id === saved.id);
    if (idx >= 0) state.jobs[idx] = saved;
    else state.jobs.unshift(saved);
    toast('岗位已保存：' + saved.company, 'ok');
    renderJobs();
  } catch (err) {
    toast(err.message, 'err');
  }
}

// 截止日期提示：7 天内标红，已过期标灰
function deadlineInfo(deadline) {
  if (!deadline) return null;
  const raw = String(deadline).trim();
  if (!raw) return null;
  const t = Date.parse(raw.replace(/-/g, '/'));
  if (isNaN(t)) return { text: '截止 ' + raw, urgent: false, expired: false };
  const days = Math.ceil((t - Date.now()) / 86400000);
  if (days < 0) return { text: '已截止', urgent: true, expired: true };
  if (days === 0) return { text: '今天截止', urgent: true, expired: false };
  if (days <= 7) return { text: days + ' 天后截止', urgent: true, expired: false };
  return { text: '截止 ' + raw.slice(0, 10), urgent: false, expired: false };
}

function jobCard(job) {
  const card = el('div', { class: 'job-card' + (job.starred ? ' starred' : '') });
  // 头部：公司与岗位名
  card.appendChild(el('div', { class: 'job-head' }, [
    el('span', { class: 'job-co' }, [job.company]),
    el('span', { class: 'job-po' }, [job.position || '—'])
  ]));
  // 信息标签行
  const dl = deadlineInfo(job.deadline);
  card.appendChild(el('div', { class: 'job-meta' }, [
    job.salary ? el('span', { class: 'chip' }, [job.salary]) : null,
    job.city ? el('span', { class: 'chip' }, [job.city]) : null,
    job.education ? el('span', { class: 'chip' }, [job.education]) : null,
    job.experience ? el('span', { class: 'chip' }, [job.experience]) : null,
    job.jobType ? el('span', { class: 'chip' }, [job.jobType]) : null,
    job.companySize ? el('span', { class: 'chip' }, [job.companySize]) : null,
    dl ? el('span', { class: 'chip deadline' + (dl.urgent ? ' urgent' : '') + (dl.expired ? ' expired' : '') }, [dl.text]) : null,
    job.jdScore != null ? el('span', { class: 'chip jd-score' }, ['JD匹配 ' + job.jdScore]) : null,
    job.applicationId ? el('span', { class: 'chip linked' }, ['已转投递']) : null
  ]));
  // 点击展开详情
  card.addEventListener('click', () => toggleJobDetail(job, card));
  // 操作按钮
  const row = el('div', { class: 'row job-actions' });
  row.appendChild(el('button', {
    class: 'star' + (job.starred ? ' active' : ''),
    type: 'button', title: '收藏 / 取消收藏',
    onclick: async (e) => {
      e.stopPropagation();
      const saved = await call(window.api.jobs.mark(state.user.id, job.id, { starred: !job.starred }));
      job.starred = saved.starred;
      renderJobs();
    }
  }, [job.starred ? '★' : '☆']));
  row.appendChild(el('button', {
    class: 'prio', type: 'button', title: '优先级（1-5，点击切换）',
    onclick: async (e) => {
      e.stopPropagation();
      const next = ((job.priority || 3) % 5) + 1;
      const saved = await call(window.api.jobs.mark(state.user.id, job.id, { priority: next }));
      job.priority = saved.priority;
      renderJobs();
    }
  }, ['P' + (job.priority || 3)]));
  row.appendChild(el('button', {
    class: 'to-bd', type: 'button', title: '转入投递看板',
    onclick: (e) => {
      e.stopPropagation();
      applyFromJob(job).then(renderJobs);
    }
  }, ['转投递']));
  // 有来源链接时可直接回到原招聘页看 JD / 投递
  if (job.url) {
    row.appendChild(el('button', {
      class: 'job-open', type: 'button', title: '打开原招聘页面',
      onclick: async (e) => {
        e.stopPropagation();
        const res = await window.api.shell.openExternal(job.url);
        if (!res.ok) toast(res.error, 'err');
      }
    }, ['官网']));
  }
  row.appendChild(el('button', {
    class: 'edit', type: 'button', title: '编辑',
    onclick: (e) => { e.stopPropagation(); openJobEditor(job); }
  }, ['编辑']));
  row.appendChild(el('button', {
    class: 'del', type: 'button', title: '删除该岗位',
    onclick: async (e) => {
      e.stopPropagation();
      const sure = await modalConfirm('删除岗位', '确认删除「' + (job.company || '') + '」这条岗位吗？', '删除');
      if (!sure) return;
      try {
        await call(window.api.jobs.remove(state.user.id, job.id));
        state.jobs = state.jobs.filter((x) => x.id !== job.id);
        renderJobs();
      } catch (err) {
        toast(err.message, 'err');
      }
    }
  }, ['删除']));
  card.appendChild(row);
  return card;
}

// 多岗位候选选择框：粘贴一整页搜索结果时，让用户勾选要入池的岗位
function openJobCandidatePicker(candidates) {
  return new Promise((resolve) => {
    const picked = new Set(candidates.map((_, i) => i));
    const overlay = el('div', { class: 'modal-overlay' });
    function close(res) {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(res);
    }
    function onKey(e) { if (e.key === 'Escape') close(null); }

    const countEl = el('span', { class: 'hint', style: 'font-size:11.5px;margin-right:auto;' },
      ['已选 ' + picked.size + ' / ' + candidates.length]);

    const rows = candidates.map((c, i) => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = true;
      cb.addEventListener('change', () => {
        if (cb.checked) picked.add(i); else picked.delete(i);
        countEl.textContent = '已选 ' + picked.size + ' / ' + candidates.length;
      });
      const metaBits = [c.salary, c.place || c.city, c.education, c.experience].filter(Boolean);
      return el('label', { class: 'job-pick-row' }, [
        cb,
        el('div', { class: 'job-pick-body' }, [
          el('div', { class: 'job-pick-main' }, [
            (c.company || '未识别公司') + ' · ' + (c.position || '未识别岗位')
          ]),
          el('div', { class: 'job-pick-meta' }, [metaBits.length ? metaBits.join(' · ') : '无更多信息'])
        ])
      ]);
    });

    const box = el('div', { class: 'modal-box modal-box-wide' }, [
      el('h3', { class: 'modal-title' }, ['识别到 ' + candidates.length + ' 个岗位']),
      el('div', { class: 'modal-body job-pick-list' }, rows),
      el('div', { class: 'modal-actions' }, [
        countEl,
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => close(null) }, ['取消']),
        el('button', {
          class: 'btn btn-primary btn-sm', type: 'button',
          onclick: () => {
            const out = candidates.filter((_, i) => picked.has(i));
            if (!out.length) return;
            close(out);
          }
        }, ['存入所选'])
      ])
    ]);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    document.addEventListener('keydown', onKey);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

// 从招聘官网/APP 复制整段岗位文本 → 解析出公司/岗位/薪资/学历/经验 → 存进岗位池。
// 复用粘贴导入的解析器（纯本地正则，不联网）：单个候选走确认表单，
// 多个候选（整页搜索结果）走勾选列表，一次批量入池。
async function openPasteJobImport() {
  if (!window.JobImport) { toast('导入模块没加载成功，请重启应用', 'err'); return; }
  const text = await modalTextarea('粘贴岗位信息', {
    label: '从招聘页复制的岗位文本（公司、岗位、薪资、地点等一起复制）',
    placeholder: '把招聘官网/APP 上的岗位信息整段复制粘贴到这里…',
    rows: 12,
    submitText: '解析'
  });
  if (!text) return;

  let parsed;
  try {
    parsed = window.JobImport.parse(text);
  } catch (err) {
    toast('解析失败：' + err.message, 'err');
    return;
  }
  const candidates = (parsed.candidates || []).filter((c) => c && (c.company || c.position));
  if (!candidates.length) {
    toast(parsed.warning || '没识别出岗位，请把公司名、岗位名、薪资一起复制', 'err');
    return;
  }

  // ---- 单个岗位：确认表单（字段可编辑）----
  if (candidates.length === 1) {
    const c = candidates[0];
    const data = await modalForm('确认岗位信息', [
      { name: 'company', label: '公司名称（必填）', value: c.company, placeholder: '如：字节跳动' },
      { name: 'position', label: '岗位名称', value: c.position, placeholder: '如：大模型算法工程师' },
      { name: 'salary', label: '薪资', value: c.salary, placeholder: '如:12k-18k·14薪' },
      { name: 'city', label: '城市', value: c.place || c.city, placeholder: '如：北京' },
      { name: 'education', label: '学历要求', value: c.education, placeholder: '如：本科' },
      { name: 'experience', label: '经验要求', value: c.experience, placeholder: '如：应届' }
    ], '存入岗位池');
    if (!data) return;
    const company = String(data.company || '').trim();
    if (!company) { toast('公司名称必填', 'err'); return; }

    try {
      const saved = await call(window.api.jobs.save(state.user.id, {
        company: company,
        position: String(data.position || '').trim(),
        salary: String(data.salary || '').trim(),
        city: String(data.city || '').trim(),
        education: String(data.education || '').trim(),
        experience: String(data.experience || '').trim(),
        jdText: text,
        url: c.url || '',
        source: c.platform || '粘贴导入'
      }));
      if (!state.jobs) state.jobs = [];
      const idx = state.jobs.findIndex((j) => j.id === saved.id);
      if (idx >= 0) state.jobs[idx] = saved; else state.jobs.unshift(saved);
      toast('已存入岗位池：' + saved.company, 'ok');
      renderJobs();
    } catch (err) {
      toast(err.message, 'err');
    }
    return;
  }

  // ---- 多个岗位：勾选后批量入池 ----
  const picked = await openJobCandidatePicker(candidates);
  if (!picked || !picked.length) return;
  if (!state.jobs) state.jobs = [];
  const beforeIds = new Set(state.jobs.map((j) => j.id));
  let added = 0, merged = 0, failed = 0;
  for (const c of picked) {
    try {
      const saved = await call(window.api.jobs.save(state.user.id, {
        company: c.company || '未命名公司',
        position: c.position || '',
        salary: c.salary || '',
        city: c.place || c.city || '',
        education: c.education || '',
        experience: c.experience || '',
        // 每个岗位只保存自己那段原文，避免把别人的 JD 混进来
        jdText: c.raw || '',
        url: c.url || '',
        source: c.platform || '粘贴导入'
      }));
      if (beforeIds.has(saved.id)) merged++;
      else { state.jobs.unshift(saved); beforeIds.add(saved.id); added++; }
    } catch (_) {
      failed++;
    }
  }
  toast('已存入 ' + added + ' 条' + (merged ? ' · 合并 ' + merged + ' 条已有' : '') + (failed ? ' · 失败 ' + failed + ' 条' : ''), 'ok');
  renderJobs();
}

// 投递看板 → 岗位池：一次性把还没进池的投递记录批量搬过来。
// 这样在官网/平台上投过、或同步导入的记录，也能在池子里统一比较与补 JD。
async function importApplicationsToJobs() {
  if (!state.jobs) state.jobs = [];
  const keyOf = (x) => (x.company || '') + '\u0001' + (x.position || '');
  const have = new Set(state.jobs.map(keyOf));
  const todo = state.applications.filter((a) => !have.has(keyOf(a)));
  if (!todo.length) {
    toast('投递记录都已在岗位池里', 'err');
    return;
  }
  let ok = 0, fail = 0;
  for (const a of todo) {
    try {
      const meta = extractAppJobMeta(a);
      const saved = await call(window.api.jobs.save(state.user.id, {
        company: a.company,
        position: a.position || '',
        city: a.place || '',
        url: a.url || '',
        source: a.source || '投递记录',
        salary: meta.salary,
        education: meta.education,
        experience: meta.experience,
        skills: meta.skills
      }));
      state.jobs.unshift(saved);
      ok++;
    } catch (_) {
      fail++;
    }
  }
  toast('已从投递记录导入 ' + ok + ' 条' + (fail ? '（' + fail + ' 条失败）' : ''), 'ok');
  renderJobs();
}

// 岗位池的筛选与排序（模块级状态：切页回来还保持上次选择）
let jobFilter = 'all';    // all | starred | candidate | applied | closed
let jobSort = 'priority'; // priority | updated | score | deadline

const JOB_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'starred', label: '星标' },
  { key: 'candidate', label: '未转投递' },
  { key: 'applied', label: '已转投递' },
  { key: 'closed', label: '已关闭' }
];
const JOB_SORTS = [
  { key: 'priority', label: '按优先级' },
  { key: 'updated', label: '按更新时间' },
  { key: 'score', label: '按匹配分' },
  { key: 'deadline', label: '按截止日期' }
];

// 老数据没有 status 字段时，按 rejected / applicationId 推导
function jobStatusOf(j) {
  if (j.status) return j.status;
  if (j.rejected) return 'closed';
  return j.applicationId ? 'applied' : 'candidate';
}

function viewJobs(jobs) {
  let out = (jobs || []).slice();
  if (jobFilter === 'starred') out = out.filter((j) => j.starred);
  else if (jobFilter !== 'all') out = out.filter((j) => jobStatusOf(j) === jobFilter);

  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : -1);
  const ts = (v) => Number(v) || 0;
  if (jobSort === 'updated') {
    out.sort((a, b) => ts(b.updatedAt) - ts(a.updatedAt));
  } else if (jobSort === 'score') {
    out.sort((a, b) => num(b.jdScore) - num(a.jdScore));
  } else if (jobSort === 'deadline') {
    const at = (v) => {
      if (!v) return Infinity;
      const t = Date.parse(String(v).replace(/-/g, '/'));
      return isNaN(t) ? Infinity : t;
    };
    out.sort((a, b) => at(a.deadline) - at(b.deadline));
  } else {
    out.sort((a, b) => (num(b.priority) - num(a.priority)) || (ts(b.updatedAt) - ts(a.updatedAt)));
  }
  return out;
}

async function renderJobs() {
  const root = document.getElementById('route-jobs');
  root.innerHTML = '';

  const head = el('div', { class: 'page-head' }, [
    el('div', { class: 'page-kicker' }, ['STEP 03 / 岗位池']),
    el('h1', { class: 'page-title' }, ['把看中的岗位攒起来']),
    el('p', { class: 'page-desc' }, ['收藏浏览中发现的岗位先放进池里挑一挑，合适的再转进投递看板。所有记录只保存在你本机。'])
  ]);

  // 每次渲染都从本地库刷新一遍，保证与磁盘状态一致
  try { await loadJobsIntoState(); } catch (err) { toast(err.message, 'err'); }
  const jobs = state.jobs || [];

  const toolbar = el('div', { class: 'toolbar' }, [
    el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openJobEditor(null) },
      [window.Icons.icon('plus', 15), '添加岗位']),
    // 从官网整段复制粘贴，自动解析薪资/学历/经验等，确认后入池
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: openPasteJobImport },
      ['粘贴岗位']),
    // 把投递看板里从官网/平台拿到的记录批量搬进池子
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: importApplicationsToJobs },
      ['从投递记录导入']),
    el('div', { class: 'spacer' }),
    el('div', { class: 'pipeline' }, [
      el('div', { class: 'pl-node' }, [
        el('b', {}, [String(jobs.length)]),
        el('span', {}, ['岗位总数'])
      ]),
      el('span', { class: 'pl-arrow' }, ['▸']),
      el('div', { class: 'pl-node starred' }, [
        el('b', {}, [String(jobs.filter((j) => j.starred).length)]),
        el('span', {}, ['星标'])
      ]),
      el('span', { class: 'pl-arrow' }, ['▸']),
      el('div', { class: 'pl-node linked' }, [
        el('b', {}, [String(jobs.filter((j) => j.applicationId).length)]),
        el('span', {}, ['已转投递'])
      ])
    ])
  ]);

  // 筛选 + 排序：岗位一多就需要，否则只能靠滚动找
  const filterbar = el('div', { class: 'jobs-filterbar' },
    JOB_FILTERS.map((f) => {
      const n = f.key === 'all' ? jobs.length
        : f.key === 'starred' ? jobs.filter((j) => j.starred).length
          : jobs.filter((j) => jobStatusOf(j) === f.key).length;
      return el('button', {
        class: 'filter-chip' + (jobFilter === f.key ? ' active' : ''),
        type: 'button',
        onclick: () => { jobFilter = f.key; renderJobs(); }
      }, [f.label + ' ' + n]);
    }).concat([
      el('div', { class: 'spacer' }),
      el('span', { class: 'sort-label' }, ['排序']),
      el('select', {
        class: 'sort-select',
        onchange: (e) => { jobSort = e.target.value; renderJobs(); }
      }, JOB_SORTS.map((s) => el('option', {
        value: s.key, selected: jobSort === s.key ? 'selected' : null
      }, [s.label])))
    ])
  );

  const shown = viewJobs(jobs);
  const list = el('div', { class: 'job-list' });
  if (shown.length) {
    shown.forEach((job) => list.appendChild(jobCard(job)));
  } else {
    const tip = jobs.length
      ? '当前筛选下没有岗位，换个筛选条件看看。'
      : '池子里还没有岗位。看到心动的机会，点「添加岗位」先记下来。';
    list.appendChild(el('div', {
      class: 'empty', style: 'padding:48px 24px;text-align:center;color:var(--fg2,#666);font-size:14px;'
    }, [tip]));
  }

  root.append(head, toolbar, filterbar, list);
  // 渲染后异步补算 JD 匹配分（本地正则引擎，不联网、不调用大模型）
  scheduleJobScores();
}

// JD 匹配分：只算「有 JD 但还没算过」的岗位，算完写回 jdScore 并刷新一次。
// 重入保护：算分过程中会再触发 renderJobs → scheduleJobScores，靠 _scoring 挡掉。
let _scoring = false;
async function scheduleJobScores() {
  if (_scoring) return;
  const resume = state.lastResume && state.lastResume.resume;
  if (!resume) return; // 还没生成简历时不算分，卡片显示「JD匹配 —」
  const jobs = state.jobs || [];
  const pending = jobs.filter((j) => j.jdText && (j.jdScore === null || j.jdScore === undefined));
  if (!pending.length) return;

  _scoring = true;
  let changed = 0;
  try {
    for (const job of pending) {
      try {
        const r = await call(window.api.resume.matchJd(resume, job.jdText));
        const score = Math.round(Number(r && r.score) || 0);
        const saved = await call(window.api.jobs.save(state.user.id, {
          id: job.id, company: job.company, jdScore: score
        }));
        const idx = state.jobs.findIndex((x) => x.id === job.id);
        if (idx >= 0) state.jobs[idx] = saved;
        changed++;
      } catch (_) { /* 单条失败不影响其它岗位 */ }
    }
  } finally {
    _scoring = false;
  }
  if (changed) {
    // 用状态里的最新数据重绘，避免再读一次磁盘
    renderJobsFromState();
  }
}

// 只重绘列表（不重新拉库、不再触发算分），算分完成后调用
function renderJobsFromState() {
  const root = document.getElementById('route-jobs');
  if (!root) return;
  const list = root.querySelector('.job-list');
  if (!list) { renderJobs(); return; }
  list.innerHTML = '';
  const jobs = state.jobs || [];
  const shown = viewJobs(jobs);
  if (shown.length) shown.forEach((job) => list.appendChild(jobCard(job)));
  else {
    list.appendChild(el('div', {
      class: 'empty', style: 'padding:48px 24px;text-align:center;color:var(--fg2,#666);font-size:14px;'
    }, [jobs.length ? '当前筛选下没有岗位，换个筛选条件看看。' : '池子里还没有岗位。看到心动的机会，点「添加岗位」先记下来。']));
  }
  // 统计条里的「已转投递」等数字也可能变了，简单起见整块刷新统计
  const pipeline = root.querySelector('.pipeline');
  if (pipeline) {
    pipeline.innerHTML = '';
    const nodes = [
      { cls: '', n: jobs.length, label: '岗位总数' },
      { cls: 'starred', n: jobs.filter((j) => j.starred).length, label: '星标' },
      { cls: 'linked', n: jobs.filter((j) => j.applicationId).length, label: '已转投递' }
    ];
    nodes.forEach((x, i) => {
      if (i) pipeline.appendChild(el('span', { class: 'pl-arrow' }, ['▸']));
      pipeline.appendChild(el('div', { class: 'pl-node ' + x.cls }, [
        el('b', {}, [String(x.n)]),
        el('span', {}, [x.label])
      ]));
    });
  }
}

// ============================================================
//  页面 5：笔试中心
//  四个视图：开始笔试 / 答题 / 成绩 / 错题本与学习计划。
//  题目随应用分发，作答与成绩只落本机 db.json，不联网。
// ============================================================
const EXAM_TYPE_LABEL = { single: '单选', multiple: '多选', judge: '判断', fill: '填空' };

// 组卷方向：留空表示按岗位 JD 自动判定
const EXAM_DOMAINS = [
  { key: '', label: '不限（按岗位 JD 自动）' },
  { key: 'backend', label: '后端 / Java' },
  { key: 'frontend', label: '前端' },
  { key: 'algorithm', label: '算法' },
  { key: 'data', label: '数据' },
  { key: 'product', label: '产品' },
  { key: 'operation', label: '运营' },
  { key: 'finance', label: '金融财务' },
  { key: 'hr', label: '人力资源' },
  { key: 'admin', label: '行政' },
  { key: 'english', label: '英语' },
  { key: 'aptitude', label: '行测' },
  { key: 'general', label: '通用能力' }
];

const examState = {
  view: 'home',       // home | answering | result | wrongs
  paper: null,
  questions: [],
  attempt: null,
  answers: {},
  index: 0,
  result: null,
  wrongs: [],
  plan: null,
  timer: null,
  remaining: 0,
  saveTimer: null,
  autoSaveTimer: null,
  deadline: 0
};

function stopExamTimer() {
  if (examState.timer) { clearInterval(examState.timer); examState.timer = null; }
  if (examState.saveTimer) { clearTimeout(examState.saveTimer); examState.saveTimer = null; }
  // 每 20 秒的兜底保存也要停：切走/交卷后不该再往后端写
  if (examState.autoSaveTimer) { clearInterval(examState.autoSaveTimer); examState.autoSaveTimer = null; }
}

function setSaveHint(text, isErr) {
  const hint = document.getElementById('exam-save-hint');
  if (!hint) return;
  hint.textContent = text;
  hint.classList.toggle('err', !!isErr);
}

// 除「改动后防抖保存」外的兜底：每 20 秒存一次。
// 用户可能长时间盯着题不动笔，只靠 debounce 会一直不落盘。
function startAutoSaveLoop() {
  if (examState.autoSaveTimer) clearInterval(examState.autoSaveTimer);
  examState.autoSaveTimer = setInterval(async () => {
    if (examState.view !== 'answering' || !examState.attempt) return;
    try {
      await call(window.api.exam.saveDraft(examState.attempt.id, examState.answers));
      setSaveHint('草稿已保存 · ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    } catch (err) {
      setSaveHint('草稿保存失败：' + err.message, true);
    }
  }, 20000);
}

function examAnsweredCount() {
  return examState.questions.filter((q) => {
    const a = examState.answers[q.id];
    if (a == null) return false;
    if (Array.isArray(a)) return a.length > 0;
    return String(a).trim() !== '';
  }).length;
}

function fmtClock(sec) {
  const s = Math.max(0, Math.round(sec));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

async function renderExamCenter() {
  const root = document.getElementById('route-exam');
  if (!root) return;
  root.innerHTML = '';

  if (examState.view === 'answering' && examState.paper && examState.attempt) {
    renderExamAnswering(root);
    return;
  }
  if (examState.view === 'result' && examState.result) {
    renderExamResult(root);
    return;
  }
  if (examState.view === 'wrongs') {
    await renderExamWrongs(root);
    return;
  }
  if (examState.view === 'code') {
    await renderCodeView(root);
    return;
  }
  await renderExamHome(root);
}

// ---------------- 视图 1：开始笔试 ----------------
async function renderExamHome(root) {
  stopExamTimer();

  const head = el('div', { class: 'page-head' }, [
    el('div', { class: 'page-kicker' }, ['STEP 05 / 笔试中心']),
    el('h1', { class: 'page-title' }, ['按岗位组一套卷子，限时练一遍']),
    el('p', { class: 'page-desc' }, ['题目来自本机题库，按岗位 JD 的知识点抽题。交卷后自动评分、归档错题，并给出下一轮练习建议。'])
  ]);

  if (!state.jobs || !state.jobs.length) {
    try { await loadJobsIntoState(); } catch (_) { /* 岗位池为空也能组通用卷 */ }
  }
  const jobs = (state.jobs || []).filter((j) => !j.rejected);

  const jobSelect = el('select', { class: 'exam-select', id: 'exam-job-select' },
    [el('option', { value: '' }, ['不限岗位（通用卷）'])].concat(
      jobs.map((j) => el('option', { value: j.id }, [
        j.company + ' · ' + (j.position || '未填岗位') + (j.jdScore != null ? '（匹配 ' + j.jdScore + '）' : '')
      ]))
    )
  );
  const countSelect = el('select', { class: 'exam-select', id: 'exam-count-select' },
    [10, 20, 30].map((n) => el('option', { value: String(n), selected: n === 20 ? 'selected' : null }, [n + ' 题']))
  );
  const durationSelect = el('select', { class: 'exam-select', id: 'exam-duration-select' },
    [15, 30, 45, 60].map((m, i) => el('option', { value: String(m), selected: i === 1 ? 'selected' : null }, [m + ' 分钟']))
  );
  // 方向：不选则按岗位 JD 自动判定；显式选择可强制考某个方向（跨专业求职常用）
  const directionSelect = el('select', { class: 'exam-select', id: 'exam-domain-select' },
    EXAM_DOMAINS.map((d) => el('option', { value: d.key }, [d.label]))
  );

  const startCard = el('div', { class: 'exam-card' }, [
    el('h3', {}, ['开始一套新卷']),
    el('div', { class: 'exam-form-row' }, [
      el('label', {}, ['目标岗位', jobSelect]),
      el('label', {}, ['方向', directionSelect]),
      el('label', {}, ['题量', countSelect]),
      el('label', {}, ['限时', durationSelect])
    ]),
    el('div', { class: 'exam-form-tip' }, [
      '按岗位 JD 自动配比：60% 岗位知识点 · 30% 方向基础 · 10% 通用；无 JD 时按所选方向组卷'
    ]),
    el('button', {
      class: 'btn btn-primary', type: 'button',
      onclick: () => startExam({
        jobId: jobSelect.value || undefined,
        domain: directionSelect.value || undefined,
        count: Number(countSelect.value),
        durationSec: Number(durationSelect.value) * 60,
        passScore: 60
      })
    }, ['开始答题 →'])
  ]);

  let attempts = [];
  let wrongs = [];
  let plan = null;
  let bankInfo = null;
  let papers = [];
  let plans = [];
  let trends = [];
  try {
    [attempts, wrongs, plan, bankInfo, papers, plans, trends] = await Promise.all([
      call(window.api.exam.listAttempts()),
      call(window.api.exam.wrongs()),
      call(window.api.exam.getPlan()),
      call(window.api.exam.bank()),
      call(window.api.exam.listPapers()),
      call(window.api.exam.listPlans()),
      call(window.api.exam.trends(3))
    ]);
  } catch (err) {
    toast(err.message, 'err');
  }
  examState.wrongs = wrongs || [];
  examState.plan = plan;
  // 首页优先展示「最近在练的岗位」的计划：岗位维度的进度比通用计划更有参考价值
  const latestJobPlan = (plans || [])
    .filter((p) => p && p.jobId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
  const homePlan = latestJobPlan || plan;
  examState.homePlan = homePlan;

  // 题库规模：让用户知道这套卷子从多大规模的题库里抽的
  if (bankInfo) {
    head.appendChild(el('div', { class: 'exam-bank-line' }, [
      '本地题库 ' + bankInfo.count + ' 题 · ' + bankInfo.tags.length + ' 个知识点 · '
      + (bankInfo.domains || []).length + ' 个方向 · 离线可用'
    ]));
  }

  // 有未完成的草稿时，给出「继续答题」入口（关闭应用后也不会丢）
  const drafts = (attempts || []).filter((a) => a.status === 'draft');
  const resumeCard = drafts.length
    ? el('div', { class: 'exam-card exam-resume-card' }, [
        el('h3', {}, ['上次的卷子还没交']),
        el('div', { class: 'exam-stat-line' }, [
          el('span', {}, ['已答 ' + Object.keys(drafts[0].answers || {}).length + ' / ' + (drafts[0].totalCount || '?') + ' 题']),
          el('span', {}, [timeAgo(drafts[0].startedAt)])
        ]),
        el('div', { class: 'exam-actions' }, [
          el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => resumeDraft(drafts[0]) }, ['继续答题 →'])
        ])
      ])
    : null;

  const submitted = (attempts || []).filter((a) => a.status === 'submitted').slice(0, 8);
  const activeWrongs = (wrongs || []).filter((w) => !w.mastered);
  const paperMap = new Map((papers || []).map((p) => [p.id, p]));

  // 投递记录里的笔试时间：首页给一张「即将参加」清单，配合主进程的系统通知
  if (!state.applications || !state.applications.length) {
    try { state.applications = await call(window.api.applications.list(state.user.id)); } catch (_) { /* 忽略 */ }
  }
  const upcomingCard = buildUpcomingCard(state.applications);

  const historyCard = el('div', { class: 'exam-card' }, [
    el('h3', {}, ['最近成绩']),
    submitted.length
      ? el('div', { class: 'exam-history' }, submitted.map((a) => {
          const p = paperMap.get(a.paperId);
          const passScore = p ? p.passScore : 60;
          // 岗位快照优先：岗位被删/改名后，历史成绩仍能看出当时投的是哪个岗
          const title = p
            ? (p.jobCompany ? p.jobCompany + ' · ' + (p.jobPosition || '未填岗位') : p.title)
            : '（试卷已删除）';
          return el('div', { class: 'exam-history-row' }, [
            el('span', { class: 'eh-score' + (a.score >= passScore ? ' ok' : ' bad') }, [String(a.score)]),
            el('div', { class: 'eh-body' }, [
              el('div', { class: 'eh-title' }, [
                title,
                a.score >= passScore
                  ? el('span', { class: 'eh-pass' }, ['通过'])
                  : el('span', { class: 'eh-fail' }, ['未通过'])
              ]),
              el('div', { class: 'eh-meta' }, [
                a.correctCount + '/' + a.totalCount + ' 题正确 · 用时 ' + fmtClock(a.durationSec)
                + (p && p.domain ? ' · ' + (DOMAIN_LABELS[p.domain] || p.domain) : '')
              ])
            ]),
            el('span', { class: 'eh-time' }, [timeAgo(a.submittedAt || a.startedAt)])
          ]);
        }))
      : el('div', { class: 'exam-empty' }, ['还没有考试记录，先做一套试试。'])
  ]);

  const wrongCard = el('div', { class: 'exam-card' }, [
    el('h3', {}, ['错题本']),
    el('div', { class: 'exam-stat-line' }, [
      el('span', {}, ['未掌握 ' + activeWrongs.length + ' 题']),
      el('span', {}, ['累计 ' + (wrongs || []).length + ' 题']),
      // 每个岗位一份学习计划：这里显示一共在练几个岗位
      plans.length > 1 ? el('span', {}, [plans.length + ' 个岗位独立进度']) : null,
      homePlan && homePlan.targetRole ? el('span', {}, ['当前岗位：' + homePlan.targetRole]) : null,
      homePlan && homePlan.weekStartedAt
        ? el('span', {}, ['本周 ' + (homePlan.weekCompletedCount || 0) + ' / ' + (homePlan.weeklyQuestionGoal || 30) + ' 题'])
        : null,
      homePlan && homePlan.weakTags && homePlan.weakTags.length
        ? el('span', {}, ['薄弱：' + homePlan.weakTags.slice(0, 4).join(' / ')])
        : null
    ]),
    el('div', { class: 'exam-actions' }, [
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: () => { examState.view = 'wrongs'; renderExamCenter(); }
      }, ['查看错题本']),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        disabled: activeWrongs.length ? null : 'disabled',
        onclick: () => startReviewExam()
      }, ['错题强化练习'])
    ])
  ]);

  root.append(head);
  if (resumeCard) root.append(resumeCard);
  if (upcomingCard) root.append(upcomingCard);
  root.append(startCard);
  // 编程题入口：独立进程判题，和客观题分开
  root.append(el('div', { class: 'exam-card code-entry' }, [
    el('h3', {}, ['编程题（ACM 模式）']),
    el('div', { class: 'exam-stat-line' }, [
      el('span', {}, ['支持 JavaScript / Python']),
      el('span', {}, ['独立子进程判题 · 超时强杀 · 输出截断'])
    ]),
    el('div', { class: 'exam-actions' }, [
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: () => { examState.view = 'code'; renderExamCenter(); }
      }, ['进入编程题 →'])
    ])
  ]));
  root.append(el('div', { class: 'exam-grid' }, [historyCard, wrongCard]));
  root.append(buildTrendCard(trends));
}

// 即将参加的笔试：来自投递记录的 examAt（岗位池「设置笔试时间」写入）
function fmtExamWhen(t) {
  const d = new Date(t);
  const now = new Date();
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
  const tomorrow = new Date(now.getTime() + 86400000);
  if (d.toDateString() === tomorrow.toDateString()) return '明天 ' + hm;
  return (d.getMonth() + 1) + '-' + String(d.getDate()).padStart(2, '0') + ' ' + hm;
}

function buildUpcomingCard(applications) {
  const now = Date.now();
  const soon = (applications || [])
    .filter((a) => a.examAt)
    .map((a) => ({ a, t: Date.parse(String(a.examAt).replace(/-/g, '/')) }))
    .filter((x) => !isNaN(x.t) && x.t > now && x.t < now + 7 * 86400000)
    .sort((x, y) => x.t - y.t);
  if (!soon.length) return null;
  return el('div', { class: 'exam-card exam-upcoming' }, [
    el('h3', {}, ['即将参加的笔试（7 天内）']),
    el('div', { class: 'upcoming-list' }, soon.slice(0, 5).map((x) => el('div', { class: 'upcoming-row' }, [
      el('span', { class: 'up-when' }, [fmtExamWhen(x.t)]),
      el('span', { class: 'up-co' }, [(x.a.company || '') + ' · ' + (x.a.position || '未填岗位')]),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: () => startExam({
          targetRole: x.a.position || '',
          count: 20,
          durationSec: 1800,
          passScore: 60
        })
      }, ['练一套'])
    ])))
  ]);
}

// 知识点趋势：数据由主进程 exam:trends 计算（纯逻辑在 exam-core，可单测），
// 渲染层只负责画图。
const TREND_COLORS = ['#d6a84a', '#59b98a', '#6aa8d6'];

function trendSvg(series) {
  const W = 560;
  const H = 150;
  const pad = { l: 36, r: 12, t: 12, b: 20 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const len = Math.max(Math.max.apply(null, series.map((s) => s.points.length)), 2);
  const px = (i) => pad.l + (len <= 1 ? iw / 2 : (i / (len - 1)) * iw);
  const py = (v) => pad.t + (1 - v) * ih;
  const parts = [];
  [0, 0.5, 1].forEach((v) => {
    parts.push('<line x1="' + pad.l + '" y1="' + py(v) + '" x2="' + (W - pad.r) + '" y2="' + py(v) + '" stroke="#2a3550" stroke-width="1"/>');
    parts.push('<text x="' + (pad.l - 6) + '" y="' + (py(v) + 3) + '" text-anchor="end" fill="#7b869c" font-size="9">' + Math.round(v * 100) + '%</text>');
  });
  series.forEach((s, si) => {
    if (!s.points.length) return;
    const color = TREND_COLORS[si % TREND_COLORS.length];
    parts.push('<polyline fill="none" stroke="' + color + '" stroke-width="2" points="'
      + s.points.map((v, i) => px(i) + ',' + py(v)).join(' ') + '"/>');
    s.points.forEach((v, i) => {
      parts.push('<circle cx="' + px(i) + '" cy="' + py(v) + '" r="2.5" fill="' + color + '"/>');
    });
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="trend-svg" preserveAspectRatio="none">' + parts.join('') + '</svg>';
}

function buildTrendCard(trends) {
  return el('div', { class: 'exam-card' }, [
    el('h3', {}, ['知识点趋势']),
    trends && trends.length
      ? el('div', { class: 'trend-wrap' }, [
          el('div', { html: trendSvg(trends) }),
          el('div', { class: 'trend-legend' }, trends.map((t, i) => el('span', { class: 'trend-item' }, [
            el('i', { style: 'background:' + TREND_COLORS[i % TREND_COLORS.length] }),
            t.tag + ' · ' + Math.round(t.rate * 100) + '%'
          ]))),
          el('div', { class: 'trend-note' }, ['按最薄弱的知识点排序，只统计出现 2 次以上的知识点'])
        ])
      : el('div', { class: 'exam-empty' }, ['再交一两套卷子，这里就会出现知识点正确率的变化曲线。'])
  ]);
}

// 继续未完成的草稿：重新取回试卷题目并恢复已存作答。
// 剩余时间按「开始时间 + 限时」算；已经超时的话直接自动交卷，不给补答的机会。
async function resumeDraft(attempt) {
  try {
    const data = await call(window.api.exam.getPaper(attempt.paperId));
    const started = await call(window.api.exam.startAttempt(attempt.paperId));
    examState.paper = data.paper;
    examState.questions = data.questions || [];
    examState.attempt = started.attempt;
    examState.answers = Object.assign({}, started.attempt.answers || {});
    examState.index = 0;
    examState.result = null;

    const remain = examRemainingSec(data.paper, started.attempt.startedAt);
    if (remain <= 0) {
      toast('这份卷子已超过限时，正在自动交卷', 'err');
      examState.view = 'answering';
      await submitExam(true);
      return;
    }

    examState.view = 'answering';
    startExamTimer(data.paper, started.attempt.startedAt);
    await renderExamCenter();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function startExam(opts) {
  try {
    const created = await call(window.api.exam.createPaper(opts));
    const started = await call(window.api.exam.startAttempt(created.paper.id));
    examState.paper = created.paper;
    examState.questions = created.questions || [];
    examState.attempt = started.attempt;
    examState.answers = Object.assign({}, started.attempt.answers || {});
    examState.index = 0;
    examState.result = null;
    examState.view = 'answering';
    // 先起计时（写入剩余秒数），再渲染，答题页首帧就有正确倒计时
    startExamTimer(created.paper, started.attempt.startedAt);
    await renderExamCenter();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function startReviewExam() {
  try {
    const created = await call(window.api.exam.createReview(10));
    const started = await call(window.api.exam.startAttempt(created.paper.id));
    examState.paper = created.paper;
    examState.questions = created.questions || [];
    examState.attempt = started.attempt;
    examState.answers = Object.assign({}, started.attempt.answers || {});
    examState.index = 0;
    examState.result = null;
    examState.view = 'answering';
    // 先起计时（写入剩余秒数），再渲染，答题页首帧就有正确倒计时
    startExamTimer(created.paper, started.attempt.startedAt);
    await renderExamCenter();
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ---------------- 视图 2：答题 ----------------
// 倒计时基于「开始时间 + 限时」的绝对截止时刻，每秒用 Date.now() 重算。
// 这样刷新页面 / 恢复草稿 / 系统休眠后都不会白送时间——
// 之前每次进入答题页都从满时长重新计时，关掉再进等于无限续杯。
function examRemainingSec(paper, startedAt) {
  const durationSec = Math.max(60, Number(paper && paper.durationSec) || 1800);
  const start = Number(startedAt) || Date.now();
  return Math.max(0, Math.ceil((start + durationSec * 1000 - Date.now()) / 1000));
}

function startExamTimer(paper, startedAt) {
  stopExamTimer();
  const durationSec = Math.max(60, Number(paper && paper.durationSec) || 1800);
  const start = Number(startedAt) || Date.now();
  const deadline = start + durationSec * 1000;
  examState.deadline = deadline;
  examState.remaining = examRemainingSec(paper, start);

  const tick = () => {
    const remain = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    examState.remaining = remain;
    const clock = document.getElementById('exam-clock');
    if (clock) {
      clock.textContent = fmtClock(remain);
      clock.classList.toggle('urgent', remain <= 60);
    }
    if (remain <= 0) {
      stopExamTimer();
      toast('时间到，已自动交卷', 'err');
      submitExam(true);
    }
  };
  tick();
  examState.timer = setInterval(tick, 1000);
}

function scheduleDraftSave() {
  if (examState.saveTimer) clearTimeout(examState.saveTimer);
  examState.saveTimer = setTimeout(async () => {
    if (!examState.attempt) return;
    try {
      await call(window.api.exam.saveDraft(examState.attempt.id, examState.answers));
      setSaveHint('草稿已保存 · ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    } catch (err) {
      // 失败必须留在界面上：只弹一个 2.6 秒就消失的 toast，等于没提示
      setSaveHint('草稿保存失败：' + err.message, true);
    }
  }, 700);
}

function renderExamAnswering(root) {
  const paper = examState.paper;
  const questions = examState.questions;

  const head = el('div', { class: 'exam-bar' }, [
    el('div', { class: 'exam-bar-title' }, [
      paper.title || '模拟笔试',
      // 真实组卷构成：没有 JD 时这里会显示 0 道 JD 题，而不是笼统的「60%」
      paper.composition
        ? el('span', { class: 'exam-comp' }, [
            'JD ' + paper.composition.jd + ' · 方向 ' + paper.composition.domain + ' · 通用 ' + paper.composition.general
            // 题库某一段不足时会从全库兜底补题：明说，别让用户以为「方向题怎么这么少」
            + (paper.composition.fallback ? ' · 兜底 ' + paper.composition.fallback : '')
          ])
        : null
    ]),
    el('div', { class: 'exam-bar-stat' }, [
      el('span', { id: 'exam-progress' }, ['已答 ' + examAnsweredCount() + ' / ' + questions.length]),
      el('span', { id: 'exam-clock', class: 'exam-clock' }, [fmtClock(examState.remaining)])
    ]),
    el('div', { class: 'exam-bar-actions' }, [
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: async () => {
          if (examState.attempt) {
            try { await call(window.api.exam.saveDraft(examState.attempt.id, examState.answers)); } catch (_) {}
          }
          stopExamTimer();
          examState.view = 'home';
          renderExamCenter();
        }
      }, ['暂存退出']),
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => submitExam(false) }, ['交卷'])
    ])
  ]);

  const navBox = el('div', { class: 'exam-nav', id: 'exam-nav' });
  const qBox = el('div', { class: 'exam-q-box', id: 'exam-q-box' });
  const saveHint = el('div', { class: 'exam-save-hint', id: 'exam-save-hint' }, ['草稿自动保存']);

  const footer = el('div', { class: 'exam-footer' }, [
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => gotoQuestion(examState.index - 1) }, ['← 上一题']),
    saveHint,
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => gotoQuestion(examState.index + 1) }, ['下一题 →'])
  ]);

  root.append(head, navBox, qBox, footer);
  renderExamNav();
  renderExamQuestionBox();
  startAutoSaveLoop();
}

function gotoQuestion(i) {
  if (i < 0 || i >= examState.questions.length) return;
  examState.index = i;
  renderExamNav();
  renderExamQuestionBox();
}

function renderExamNav() {
  const nav = document.getElementById('exam-nav');
  if (!nav) return;
  nav.innerHTML = '';
  examState.questions.forEach((q, i) => {
    const a = examState.answers[q.id];
    const answered = a != null && (Array.isArray(a) ? a.length > 0 : String(a).trim() !== '');
    nav.appendChild(el('button', {
      class: 'exam-nav-btn' + (i === examState.index ? ' current' : '') + (answered ? ' answered' : ''),
      type: 'button',
      onclick: () => gotoQuestion(i)
    }, [String(i + 1)]));
  });
  const prog = document.getElementById('exam-progress');
  if (prog) prog.textContent = '已答 ' + examAnsweredCount() + ' / ' + examState.questions.length;
}

function renderExamQuestionBox() {
  const box = document.getElementById('exam-q-box');
  if (!box) return;
  const q = examState.questions[examState.index];
  if (!q) return;
  box.innerHTML = '';

  box.appendChild(el('div', { class: 'exam-q-head' }, [
    el('span', { class: 'exam-q-no' }, ['第 ' + (examState.index + 1) + ' 题']),
    el('span', { class: 'exam-q-type' }, [EXAM_TYPE_LABEL[q.type] || q.type]),
    el('span', { class: 'exam-q-diff' }, ['★'.repeat(q.difficulty || 1)]),
    el('span', { class: 'exam-q-tags' }, [(q.tags || []).slice(0, 3).join(' · ')])
  ]));
  box.appendChild(el('div', { class: 'exam-q-stem' }, [q.stem]));

  const cur = examState.answers[q.id];

  if (q.type === 'fill') {
    const input = el('input', { class: 'exam-fill', type: 'text', placeholder: '填写答案（忽略大小写与空格）' });
    input.value = cur || '';
    input.addEventListener('input', () => {
      examState.answers[q.id] = input.value;
      renderExamNav();
      scheduleDraftSave();
    });
    box.appendChild(input);
    return;
  }

  const options = q.options || [];
  const multi = q.type === 'multiple';
  const chosen = new Set(multi ? (Array.isArray(cur) ? cur : []) : (cur ? [cur] : []));

  options.forEach((opt, i) => {
    const input = el('input', { type: multi ? 'checkbox' : 'radio', name: 'exam-opt-' + q.id });
    input.checked = chosen.has(opt);
    input.addEventListener('change', () => {
      if (multi) {
        if (input.checked) chosen.add(opt); else chosen.delete(opt);
        examState.answers[q.id] = [...chosen];
      } else {
        examState.answers[q.id] = opt;
        box.querySelectorAll('.exam-opt').forEach((lab) => lab.classList.remove('checked'));
        const lab = input.closest('.exam-opt');
        if (lab) lab.classList.add('checked');
      }
      renderExamNav();
      scheduleDraftSave();
    });
    const label = el('label', { class: 'exam-opt' + (input.checked ? ' checked' : '') }, [
      input,
      el('span', { class: 'exam-opt-key' }, [String.fromCharCode(65 + i)]),
      el('span', { class: 'exam-opt-text' }, [opt])
    ]);
    box.appendChild(label);
  });
}

async function submitExam(auto) {
  if (!examState.attempt) return;
  if (!auto) {
    const unanswered = examState.questions.length - examAnsweredCount();
    const sure = await modalConfirm(
      '确认交卷',
      unanswered > 0 ? '还有 ' + unanswered + ' 题未作答，未作答按错处理。确认交卷？' : '确认交卷？',
      '交卷'
    );
    if (!sure) return;
  }
  try {
    const res = await call(window.api.exam.submit(examState.attempt.id, examState.answers));
    stopExamTimer();
    examState.result = res.result;
    examState.view = 'result';
    renderExamCenter();
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ---------------- 视图 3：成绩 ----------------
function renderExamResult(root) {
  stopExamTimer();
  const r = examState.result;
  const pass = !!r.passed;

  const head = el('div', { class: 'exam-result-head' + (pass ? ' pass' : ' fail') }, [
    el('div', { class: 'exam-score' }, [String(r.score)]),
    el('div', { class: 'exam-score-meta' }, [
      el('div', { class: 'exam-verdict' }, [pass ? '通过' : '未通过']),
      el('div', { class: 'exam-sub' }, [
        '正确 ' + r.correctCount + ' / ' + r.totalCount + ' 题 · 用时 ' + fmtClock(r.durationSec) + ' · 及格线 ' + r.passScore
      ])
    ])
  ]);

  const tagRows = Object.entries(r.tagStats || {})
    .map(([tag, st]) => ({ tag, ...st, rate: st.total ? st.correct / st.total : 0 }))
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 12);

  const tagCard = el('div', { class: 'exam-card' }, [
    el('h3', {}, ['知识点掌握度']),
    tagRows.length
      ? el('div', { class: 'exam-tags' }, tagRows.map((t) => el('div', { class: 'exam-tag-row' }, [
          el('span', { class: 'et-name' }, [t.tag]),
          el('span', { class: 'et-bar' }, [
            el('i', { style: 'width:' + Math.round(t.rate * 100) + '%;background:' + (t.rate >= 0.8 ? '#59b98a' : t.rate >= 0.5 ? '#d6a84a' : '#d4695f') })
          ]),
          el('span', { class: 'et-num' }, [t.correct + '/' + t.total])
        ])))
      : el('div', { class: 'exam-empty' }, ['本卷没有可统计的知识点。'])
  ]);

  const wrongDetails = (r.details || []).filter((d) => !d.correct);
  const detailCard = el('div', { class: 'exam-card' }, [
    el('h3', {}, ['错题解析（' + wrongDetails.length + ' 题）']),
    wrongDetails.length
      ? el('div', { class: 'exam-details' }, wrongDetails.map((d) => {
          const q = examState.questions.find((x) => x.id === d.questionId);
          return el('div', { class: 'exam-detail-item' }, [
            el('div', { class: 'ed-stem' }, [q ? q.stem : d.questionId]),
            el('div', { class: 'ed-reason' + (d.reason === 'unanswered' ? ' unanswered' : '') }, [
              d.reason === 'unanswered' ? '⚠ 未作答（只扣分，不进错题本）' : '✕ 答错'
            ]),
            el('div', { class: 'ed-row' }, [
              el('span', { class: 'ed-label bad' }, ['你的答案']),
              el('span', {}, [fmtAnswer(d.userAnswer)])
            ]),
            el('div', { class: 'ed-row' }, [
              el('span', { class: 'ed-label ok' }, ['正确答案']),
              el('span', {}, [fmtAnswer(d.correctAnswer)])
            ]),
            el('div', { class: 'ed-exp' }, [d.explanation])
          ]);
        }))
      : el('div', { class: 'exam-empty' }, ['全部答对，没有错题。'])
  ]);

  const actions = el('div', { class: 'exam-actions' }, [
    el('button', {
      class: 'btn btn-primary btn-sm', type: 'button',
      onclick: () => { examState.view = 'home'; examState.result = null; renderExamCenter(); }
    }, ['返回笔试中心']),
    el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button',
      onclick: () => { examState.view = 'wrongs'; renderExamCenter(); }
    }, ['查看错题本']),
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => startReviewExam() }, ['立刻强化练习'])
  ]);

  root.append(head, tagCard, detailCard, actions);
}

function fmtAnswer(a) {
  if (a == null) return '（未作答）';
  if (Array.isArray(a)) return a.length ? a.join(' / ') : '（未作答）';
  return String(a) || '（未作答）';
}

// ---------------- 视图 4：错题本与学习计划 ----------------
let examWrongFilter = 'active'; // active | all | mastered

async function renderExamWrongs(root) {
  stopExamTimer();
  let items = [];
  let plan = null;
  try {
    [items, plan] = await Promise.all([
      call(window.api.exam.wrongs()),
      call(window.api.exam.getPlan())
    ]);
  } catch (err) {
    toast(err.message, 'err');
  }
  examState.wrongs = items || [];

  const shown = (items || []).filter((w) =>
    examWrongFilter === 'all' ? true : examWrongFilter === 'mastered' ? w.mastered : !w.mastered);

  const head = el('div', { class: 'page-head' }, [
    el('div', { class: 'page-kicker' }, ['STEP 05 / 错题本']),
    el('h1', { class: 'page-title' }, ['把错过的题吃透']),
    el('p', { class: 'page-desc' }, ['按知识点复习错题，标记已掌握后不再进入下一轮练习。'])
  ]);

  const filterbar = el('div', { class: 'jobs-filterbar' },
    [['active', '未掌握'], ['mastered', '已掌握'], ['all', '全部']].map(([key, label]) =>
      el('button', {
        class: 'filter-chip' + (examWrongFilter === key ? ' active' : ''),
        type: 'button',
        onclick: () => { examWrongFilter = key; renderExamCenter(); }
      }, [label + ' ' + (key === 'all' ? items.length
        : key === 'mastered' ? items.filter((w) => w.mastered).length
          : items.filter((w) => !w.mastered).length)])
    ).concat([
      el('div', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: () => { examState.view = 'home'; renderExamCenter(); }
      }, ['← 返回笔试中心'])
    ])
  );

  const planCard = el('div', { class: 'exam-card' }, [
    el('h3', {}, ['学习计划']),
    el('div', { class: 'exam-stat-line' }, [
      el('span', {}, ['本周完成 ' + ((plan && plan.weekCompletedCount) || 0) + ' / ' + ((plan && plan.weeklyQuestionGoal) || 30) + ' 题']),
      el('span', {}, ['累计完成 ' + ((plan && plan.completedCount) || 0) + ' 题']),
      plan && plan.weakTags && plan.weakTags.length
        ? el('span', {}, ['薄弱知识点：' + plan.weakTags.slice(0, 6).join(' / ')])
        : el('span', {}, ['做完一套卷子后自动分析薄弱项'])
    ]),
    el('div', { class: 'exam-actions' }, [
      el('button', {
        class: 'btn btn-primary btn-sm', type: 'button',
        disabled: items.filter((w) => !w.mastered).length ? null : 'disabled',
        onclick: () => startReviewExam()
      }, ['按薄弱项生成下一轮']),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: async () => {
          const data = await modalForm('学习计划', [
            { name: 'weeklyQuestionGoal', label: '每周目标题量', value: String((plan && plan.weeklyQuestionGoal) || 30), placeholder: '如：30' }
          ], '保存');
          if (!data) return;
          try {
            await call(window.api.exam.savePlan({
              weeklyQuestionGoal: Number(data.weeklyQuestionGoal) || 30,
              completedCount: (plan && plan.completedCount) || 0,
              targetRole: (plan && plan.targetRole) || ((state.profile && state.profile.targetRole) || ''),
              weakTags: (plan && plan.weakTags) || []
            }));
            toast('周目标已更新', 'ok');
            renderExamCenter();
          } catch (err) { toast(err.message, 'err'); }
        }
      }, ['设置周目标'])
    ])
  ]);

  const list = el('div', { class: 'exam-card' }, [
    el('h3', {}, ['错题（' + shown.length + '）']),
    shown.length
      ? el('div', { class: 'wrong-list' }, shown.map((w) => {
          const q = w.question || {};
          return el('div', { class: 'wrong-item' + (w.mastered ? ' mastered' : '') }, [
            el('div', { class: 'wrong-head' }, [
              el('span', { class: 'wrong-tags' }, [(q.tags || []).slice(0, 3).join(' · ')]),
              el('span', { class: 'wrong-count' }, ['错 ' + w.errorCount + ' 次'])
            ]),
            el('div', { class: 'wrong-stem' }, [q.stem || w.questionId]),
            el('div', { class: 'ed-row' }, [
              el('span', { class: 'ed-label ok' }, ['正确答案']),
              el('span', {}, [fmtAnswer(q.answer)])
            ]),
            el('div', { class: 'ed-exp' }, [q.explanation || '']),
            el('div', { class: 'wrong-actions' }, [
              el('button', {
                class: 'btn btn-ghost btn-sm', type: 'button',
                onclick: async () => {
                  try {
                    await call(window.api.exam.masterWrong(w.questionId, !w.mastered));
                    renderExamCenter();
                  } catch (err) { toast(err.message, 'err'); }
                }
              }, [w.mastered ? '标记为未掌握' : '标记已掌握'])
            ])
          ]);
        }))
      : el('div', { class: 'exam-empty' }, ['这个分类下没有错题。'])
  ]);

  root.append(head, filterbar, planCard, list);
}

// ============================================================
//  编程题（ACM 标准输入输出）
//  代码由主进程在独立子进程里执行，渲染层只负责编辑与展示结果。
// ============================================================
const CODE_VERDICT_LABEL = {
  AC: '通过', WA: '答案错误', TLE: '超时', RE: '运行错误',
  OLE: '输出超限', MLE: '内存超限', CE: '编译 / 启动失败'
};

const codeState = {
  list: null,
  env: null,
  question: null,
  lang: 'javascript',
  drafts: { javascript: '', python: '', cpp: '' },
  draftFor: null,
  draftLoaded: {},   // questionId+lang → 是否已从本地加载过草稿
  saveTimer: null,   // 草稿防抖保存定时器
  subs: null,        // 当前题的提交记录
  subsFor: null,
  solvedIds: {},     // questionId → 是否 AC 过（侧栏打勾）
  customInputs: {},  // questionId → 自定义测试输入（仅本次会话内保留）
  flushDraft: null,  // 当前编辑器的「立即落盘」函数（切后台/关窗口用）
  flushHooksBound: false,
  result: null,
  busy: false
};

async function renderCodeView(root) {
  stopExamTimer();

  if (!codeState.list) {
    try {
      const [list, env] = await Promise.all([
        call(window.api.code.list()),
        call(window.api.code.env())
      ]);
      codeState.list = list || [];
      codeState.env = env || { javascript: true, python: false };
      await loadSolvedIds();
    } catch (err) {
      toast(err.message, 'err');
      codeState.list = [];
    }
  }

  if (!codeState.question && codeState.list.length) {
    await selectCodeQuestion(codeState.list[0].id);
    return;
  }

  const q = codeState.question;
  const head = el('div', { class: 'page-head' }, [
    el('div', { class: 'page-kicker' }, ['STEP 05 / 编程题']),
    el('h1', { class: 'page-title' }, ['ACM 模式：读标准输入，写标准输出']),
    el('p', { class: 'page-desc' }, [
      q
        ? '当前题限时 ' + q.timeLimitMs + 'ms · 内存 ' + q.memoryLimitMb + 'MB · 代码在独立子进程执行，超时会强制结束'
        : '从左侧选一道题开始'
    ])
  ]);

  const list = codeState.list || [];
  const solved = codeState.solvedIds || {};
  const sidebar = el('div', { class: 'code-side' }, [
    el('div', { class: 'code-side-title' }, ['题目 · ' + list.length]),
    el('div', { class: 'code-side-list' }, list.map((item) => el('button', {
      class: 'code-item' + (q && q.id === item.id ? ' active' : ''),
      type: 'button',
      onclick: () => selectCodeQuestion(item.id)
    }, [
      el('span', { class: 'ci-title' }, [(solved[item.id] ? '✓ ' : '') + item.title]),
      el('span', { class: 'ci-meta' }, ['★'.repeat(item.difficulty) + ' · ' + item.timeLimitMs + 'ms'])
    ])))
  ]);

  if (!q) {
    root.append(head, el('div', { class: 'exam-card' }, [el('div', { class: 'exam-empty' }, ['题库为空'])]));
    return;
  }

  const pyReady = !!(codeState.env && codeState.env.python);
  const cppReady = !!(codeState.env && codeState.env.cpp);
  const langSelect = el('select', { class: 'exam-select', id: 'code-lang' }, [
    el('option', { value: 'javascript', selected: codeState.lang === 'javascript' ? 'selected' : null }, ['JavaScript']),
    el('option', { value: 'python', selected: codeState.lang === 'python' ? 'selected' : null }, [
      pyReady ? 'Python 3' : 'Python 3（未检测到）'
    ]),
    el('option', { value: 'cpp', selected: codeState.lang === 'cpp' ? 'selected' : null }, [
      cppReady ? 'C++ 17' : 'C++ 17（未检测到编译器）'
    ])
  ]);
  langSelect.addEventListener('change', () => {
    const v = langSelect.value;
    codeState.lang = (v === 'python' || v === 'cpp') ? v : 'javascript';
    if (codeState.lang === 'python' && !pyReady) {
      toast('本机未检测到 Python 3，请安装后重试，或改用 JavaScript', 'err', 4200);
    }
    if (codeState.lang === 'cpp' && !cppReady) {
      toast('本机未检测到 C++ 编译器（g++/clang++）。请安装 MinGW-w64 并把 bin 目录加入 PATH', 'err', 6000);
    }
    renderExamCenter();
  });

  const toolbar = el('div', { class: 'code-toolbar' }, [
    el('label', { class: 'code-lang-wrap' }, ['语言', langSelect]),
    el('div', { class: 'spacer' }),
    el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', id: 'code-btn-run',
      onclick: () => runCode('run')
    }, ['运行样例']),
    el('button', {
      class: 'btn btn-primary btn-sm', type: 'button', id: 'code-btn-submit',
      onclick: () => runCode('submit')
    }, ['提交判题'])
  ]);

  // 题面
  const problem = el('div', { class: 'code-problem' }, [
    el('h3', {}, [q.title]),
    el('div', { class: 'code-meta-row' }, [
      el('span', {}, ['★'.repeat(q.difficulty)]),
      el('span', {}, [(q.tags || []).join(' · ')]),
      el('span', {}, ['限时 ' + q.timeLimitMs + 'ms']),
      el('span', {}, ['内存 ' + q.memoryLimitMb + 'MB'])
    ]),
    el('div', { class: 'code-statement' }, [q.statement]),
    el('div', { class: 'code-io' }, [
      el('div', {}, [el('b', {}, ['输入格式']), el('div', {}, [q.inputFormat])]),
      el('div', {}, [el('b', {}, ['输出格式']), el('div', {}, [q.outputFormat])])
    ]),
    el('div', { class: 'code-samples' }, (q.samples || []).map((s, i) => el('div', { class: 'code-sample' }, [
      el('div', { class: 'cs-title' }, ['样例 ' + (i + 1)]),
      el('div', { class: 'cs-row' }, [el('span', {}, ['输入']), el('pre', {}, [s.input])]),
      el('div', { class: 'cs-row' }, [el('span', {}, ['输出']), el('pre', {}, [s.output])]),
      s.explain ? el('div', { class: 'cs-explain' }, [s.explain]) : null
    ]))),
    q.hint ? el('div', { class: 'code-hint' }, ['提示：' + q.hint]) : null
  ]);

  // 编辑器
  const editor = el('textarea', { class: 'code-editor', spellcheck: 'false', placeholder: '在此编写代码…' });
  editor.value = codeState.drafts[codeState.lang] || '';
  const draftKey = () => (codeState.question ? codeState.question.id + '|' + codeState.lang : null);
  const saveDraft = () => {
    if (codeState.saveTimer) { clearTimeout(codeState.saveTimer); codeState.saveTimer = null; }
    codeState.saveTimer = setTimeout(() => {
      codeState.saveTimer = null;
      const key = draftKey();
      if (!key) return;
      const code = codeState.drafts[codeState.lang] || '';
      window.api.code.saveDraft(codeState.question.id, codeState.lang, code)
        .catch(() => { /* 存不上不打扰用户 */ });
    }, 800);
  };
  editor.addEventListener('input', () => {
    codeState.drafts[codeState.lang] = editor.value;
    saveDraft();
  });
  editor.addEventListener('keydown', (e) => {
    // Tab 不要跳出编辑器：插入两个空格
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = editor.selectionStart;
      const en = editor.selectionEnd;
      editor.value = editor.value.slice(0, s) + '  ' + editor.value.slice(en);
      editor.selectionStart = editor.selectionEnd = s + 2;
      codeState.drafts[codeState.lang] = editor.value;
      saveDraft();
    }
  });
  // 立即落盘（不等防抖）：失焦、切后台、关闭窗口都要用
  const flushDraft = () => {
    if (codeState.saveTimer) { clearTimeout(codeState.saveTimer); codeState.saveTimer = null; }
    const key = draftKey();
    if (!key) return;
    window.api.code.saveDraft(codeState.question.id, codeState.lang, codeState.drafts[codeState.lang] || '')
      .catch(() => {});
  };
  editor.addEventListener('blur', flushDraft);
  // 页面级兜底：编辑器还没失焦就被切后台/关窗口时，防抖里的内容会丢。
  // 事件只绑一次；每次重建编辑器时更新 flushDraft 指向最新实例。
  codeState.flushDraft = flushDraft;
  if (!codeState.flushHooksBound) {
    codeState.flushHooksBound = true;
    const flush = () => { if (codeState.flushDraft) codeState.flushDraft(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('blur', flush);
    window.addEventListener('beforeunload', flush);
  }

  const resultBox = el('div', { class: 'code-result', id: 'code-result' });
  const subsBox = el('div', { class: 'code-subs', id: 'code-subs' });
  const customBox = buildCustomInputBox();

  const main = el('div', { class: 'code-main' }, [problem, toolbar, editor, customBox, resultBox, subsBox]);
  const layout = el('div', { class: 'code-layout' }, [sidebar, main]);
  root.append(head, layout);
  renderCodeResult();
  renderCodeSubs();
}

/** 自定义测试输入：不比对答案，只看程序拿到这份输入后的真实输出 */
function buildCustomInputBox() {
  const q = codeState.question;
  const qid = q ? q.id : '';
  if (!codeState.customInputs) codeState.customInputs = {};
  const saved = codeState.customInputs[qid] || '';

  const ta = el('textarea', {
    class: 'code-custom-input',
    spellcheck: 'false',
    placeholder: '在这里写测试数据，会作为标准输入喂给程序（例如边界值、空输入、特殊形状）'
  });
  ta.value = saved;
  ta.addEventListener('input', () => { codeState.customInputs[qid] = ta.value; });

  const outBox = el('div', { class: 'code-custom-out', id: 'code-custom-out' });
  const btn = el('button', {
    class: 'btn btn-ghost btn-sm', type: 'button', id: 'code-btn-custom'
  }, ['用这份输入运行']);

  btn.addEventListener('click', async () => {
    if (!codeState.question || codeState.busy) return;
    const code = codeState.drafts[codeState.lang] || '';
    if (!code.trim()) { toast('先写点代码再运行', 'err'); return; }
    const stdin = ta.value;
    if (stdin.length > 65536) { toast('自定义输入不能超过 64KB', 'err'); return; }

    codeState.busy = true;
    btn.disabled = true;
    btn.textContent = '运行中…';
    outBox.innerHTML = '';
    try {
      const r = await call(window.api.code.runCustom({
        questionId: codeState.question.id,
        lang: codeState.lang,
        code: code,
        stdin: stdin
      }));
      renderCustomOutput(outBox, r);
    } catch (err) {
      outBox.appendChild(el('div', { class: 'code-msg' }, [err.message]));
    } finally {
      codeState.busy = false;
      btn.disabled = false;
      btn.textContent = '用这份输入运行';
    }
  });

  const body = el('div', { class: 'code-custom-body', style: 'display:none;' }, [ta, outBox]);

  const head = el('div', { class: 'code-custom-head' }, [
    el('b', {}, ['自定义测试输入']),
    el('span', { class: 'hint' }, ['不比对答案，只看程序输出']),
    el('div', { class: 'spacer' }),
    btn
  ]);
  head.addEventListener('click', (e) => {
    // 点标题行空白处展开/收起；点按钮不触发
    if (e.target.closest('button')) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    head.classList.toggle('open', !open);
  });

  return el('div', { class: 'code-custom' }, [head, body]);
}

/** 渲染自定义输入的执行结果 */
function renderCustomOutput(host, r) {
  host.innerHTML = '';
  const LABEL = { OK: '运行完成', RE: '运行错误', TLE: '超时', OLE: '输出超限', CE: '编译失败' };
  host.appendChild(el('div', { class: 'code-verdict ' + String(r.verdict).toLowerCase() }, [
    el('b', {}, [LABEL[r.verdict] || r.verdict]),
    el('span', {}, ['耗时 ' + r.timeMs + 'ms'])
  ]));
  if (r.message) host.appendChild(el('div', { class: 'code-msg' }, [r.message]));
  host.appendChild(el('div', { class: 'cc-line' }, [
    el('span', {}, ['标准输出']),
    el('pre', {}, [r.stdout && r.stdout.length ? r.stdout : '（无输出）'])
  ]));
  if (r.stderr) {
    host.appendChild(el('div', { class: 'cc-line' }, [
      el('span', {}, ['标准错误']),
      el('pre', { class: 'cc-err' }, [r.stderr])
    ]));
  }
}

/** 渲染当前题的提交记录（只展示最近 10 条） */
function renderCodeSubs() {
  const host = document.getElementById('code-subs');
  if (!host) return;
  host.innerHTML = '';
  const q = codeState.question;
  if (!q || codeState.subsFor !== q.id) return;
  const subs = codeState.subs || [];
  if (!subs.length) {
    host.appendChild(el('div', { class: 'code-hint' }, ['本题还没有提交记录。点「提交判题」后会记在这里。']));
    return;
  }
  const LANG_NAME = { javascript: 'JS', python: 'Python', cpp: 'C++' };
  host.appendChild(el('div', { class: 'cs-head' }, [
    el('b', {}, ['提交记录']),
    el('span', {}, ['最近 ' + Math.min(subs.length, 10) + ' 条 · 共 ' + subs.length + ' 条'])
  ]));
  subs.slice(0, 10).forEach((s) => {
    const label = CODE_VERDICT_LABEL[s.verdict] || s.verdict;
    host.appendChild(el('div', { class: 'cs-row-item ' + String(s.verdict).toLowerCase() }, [
      el('span', { class: 'cs-v' }, [label]),
      el('span', { class: 'cs-detail' }, [(LANG_NAME[s.lang] || s.lang) + ' · ' + s.passed + '/' + s.total + ' · ' + s.timeMs + 'ms']),
      el('span', { class: 'cs-time' }, [timeAgo(s.createdAt)])
    ]));
  });
}

async function selectCodeQuestion(id) {
  try {
    const q = await call(window.api.code.get(id));
    codeState.question = q;
    // 换题才重置草稿；同一题切语言不覆盖
    if (codeState.draftFor !== id) {
      codeState.draftFor = id;
      codeState.draftLoaded = {};
      codeState.subs = null;
      codeState.subsFor = null;
      await Promise.all([loadCodeDrafts(q), loadCodeSubmissions(id)]);
    }
    codeState.result = null;
    await renderExamCenter();
  } catch (err) {
    toast(err.message, 'err');
  }
}

/** 拉全部提交记录，算哪些题 AC 过（侧栏打勾） */
async function loadSolvedIds() {
  try {
    // call() 返回 data 本身（数组）
    const all = await call(window.api.code.submissions());
    const list = Array.isArray(all) ? all : [];
    const map = {};
    for (const s of list) {
      if (s && s.verdict === 'AC') map[s.questionId] = true;
    }
    codeState.solvedIds = map;
  } catch (_) { /* 拉不到就不打勾 */ }
}

/** 从本地存储恢复草稿；没有存过才用起始代码 */
async function loadCodeDrafts(q) {
  const langs = ['javascript', 'python', 'cpp'];
  await Promise.all(langs.map(async (lang) => {
    const key = q.id + '|' + lang;
    if (codeState.draftLoaded[key]) return;
    codeState.draftLoaded[key] = true;
    try {
      // call() 返回的是 data 本身（草稿对象或 null），不是 {ok,data} 包装
      const draft = await call(window.api.code.getDraft(q.id, lang));
      const saved = draft && typeof draft.code === 'string' ? draft.code : null;
      codeState.drafts[lang] = saved != null
        ? saved
        : ((q.starterCode && q.starterCode[lang]) || '');
    } catch (_) {
      codeState.drafts[lang] = (q.starterCode && q.starterCode[lang]) || '';
    }
  }));
}

/** 拉当前题的提交记录（只记「提交判题」） */
async function loadCodeSubmissions(id) {
  try {
    // call() 返回 data 本身（数组）
    const list = await call(window.api.code.submissions(id));
    codeState.subs = Array.isArray(list) ? list : [];
    codeState.subsFor = id;
    if (!codeState.solvedIds) codeState.solvedIds = {};
    if (codeState.subs.some((s) => s.verdict === 'AC')) {
      codeState.solvedIds[id] = true;
      // 侧栏即时打勾，不用重进页面
      const btns = document.querySelectorAll('.code-item');
      for (const btn of btns) {
        const title = btn.querySelector('.ci-title');
        if (title && !title.textContent.startsWith('✓')) {
          const q2 = (codeState.list || []).find((x) => x.id === id);
          if (q2 && btn.textContent.includes(q2.title)) title.textContent = '✓ ' + q2.title;
        }
      }
    }
    renderCodeSubs();
  } catch (_) { /* 拉不到不影响答题 */ }
}

async function runCode(mode) {
  if (!codeState.question || codeState.busy) return;
  const code = codeState.drafts[codeState.lang] || '';
  if (!code.trim()) { toast('先写点代码再运行', 'err'); return; }

  codeState.busy = true;
  const btnRun = document.getElementById('code-btn-run');
  const btnSubmit = document.getElementById('code-btn-submit');
  if (btnRun) btnRun.disabled = true;
  if (btnSubmit) btnSubmit.disabled = true;
  const busyText = mode === 'run' ? '运行中…' : '判题中…';
  const busyBtn = mode === 'run' ? btnRun : btnSubmit;
  if (busyBtn) busyBtn.textContent = busyText;

  try {
    const fn = mode === 'run' ? window.api.code.run : window.api.code.submit;
    const res = await call(fn({
      questionId: codeState.question.id,
      lang: codeState.lang,
      code: code
    }));
    codeState.result = res;
    renderCodeResult();
    // 提交判题才刷新记录；运行样例不记
    if (mode === 'submit' && codeState.question) {
      await loadCodeSubmissions(codeState.question.id);
    }
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    codeState.busy = false;
    if (btnRun) { btnRun.disabled = false; btnRun.textContent = '运行样例'; }
    if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = '提交判题'; }
  }
}

function renderCodeResult() {
  const host = document.getElementById('code-result');
  if (!host) return;
  host.innerHTML = '';
  const r = codeState.result;
  if (!r) {
    host.appendChild(el('div', { class: 'code-hint' }, ['点「运行样例」先自测，确认无误再「提交判题」跑全部用例。']));
    return;
  }

  const label = CODE_VERDICT_LABEL[r.verdict] || r.verdict;
  host.appendChild(el('div', { class: 'code-verdict ' + String(r.verdict).toLowerCase() }, [
    el('b', {}, [label]),
    el('span', {}, ['通过 ' + r.passed + ' / ' + r.total + ' · 最慢 ' + r.timeMs + 'ms'])
  ]));
  if (r.message) host.appendChild(el('div', { class: 'code-msg' }, [r.message]));

  (r.cases || []).forEach((c) => {
    host.appendChild(el('div', { class: 'code-case ' + String(c.verdict).toLowerCase() }, [
      el('div', { class: 'cc-head' }, [
        el('span', { class: 'cc-idx' }, ['#' + (c.index + 1)]),
        el('span', { class: 'cc-v' }, [c.verdict]),
        el('span', { class: 'cc-t' }, [c.timeMs + 'ms']),
        c.isSample ? el('span', { class: 'cc-tag' }, ['样例']) : null
      ]),
      c.input != null ? el('div', { class: 'cc-detail' }, [
        el('div', { class: 'cc-line' }, [el('span', {}, ['输入']), el('pre', {}, [c.input])]),
        el('div', { class: 'cc-line' }, [el('span', {}, ['期望']), el('pre', {}, [c.expected])]),
        el('div', { class: 'cc-line' }, [el('span', {}, ['实际']), el('pre', {}, [c.actual])])
      ]) : null,
      c.stderr ? el('pre', { class: 'cc-err' }, [c.stderr]) : null
    ]));
  });
}

(async () => {
  if (!window.EmbeddedLlm) return; // embedded-llm.js 加载失败不影响其他功能
  // 启动即上报 WebGPU 能力；模型就绪状态变化时再报
  const report = async () => {
    try {
      const webgpu = await window.EmbeddedLlm.webgpuAvailable();
      window.api.embedded.reportStatus({ webgpu, ready: window.EmbeddedLlm.isEngineReady() });
    } catch (_) {} // eslint-disable-line no-empty
  };
  await report();

  // 诊断模式：GRF_EMBEDDED_SELFTEST=1 启动时自检嵌入式链路（模块加载 / WebGPU / 镜像连通），
  // 结果打到主进程日志（main 会转发 renderer console），用于打包版验证与用户自查
  if (window.api.env && window.api.env.embeddedSelfTest) {
    try {
      const st = await window.EmbeddedLlm.moduleSelfTest();
      const gpu = await window.EmbeddedLlm.webgpuAvailable();
      let mirror = 'n/a';
      try {
        const r = await fetch(window.EmbeddedLlm.modelInfo.mirrorModelUrl + 'mlc-chat-config.json', { headers: { Range: 'bytes=0-99' } });
        mirror = r.status + '';
        try { if (r.body) await r.body.cancel(); } catch (_) {} // eslint-disable-line no-empty
      } catch (e) { mirror = 'ERR ' + (e && e.message); }
      console.log('[embedded-selftest] module exports=' + st.exports +
        ' prebuilt=' + st.prebuiltModels + ' createMLCEngine=' + st.hasCreateMLCEngine +
        ' wasm=' + st.wasmCompilable + ' webgpu=' + gpu +
        ' variant=' + st.variant + '(' + st.variantTotalMB + 'MB) mirror=' + mirror);
    } catch (err) {
      console.log('[embedded-selftest] FAIL ' + (err && err.message));
    }
  }

  // 响应主进程的推理请求（Agent embedded 通道）
  window.api.embedded.onRequest(async (req) => {
    try {
      await window.EmbeddedLlm.ensureEngine(); // 若未加载则现加载（用户已在配置里点过下载）
      const content = await window.EmbeddedLlm.embeddedChat(req.messages);
      window.api.embedded.respond(req.id, { content });
      report();
    } catch (err) {
      window.api.embedded.respond(req.id, { error: err.message });
    }
  });
})();

// ============================================================
//  全局小助手（悬浮球 + 问答面板）
// ============================================================
(function initAssistant() {
  const fab = document.getElementById('assistant-fab');
  const panel = document.getElementById('assistant-panel');
  const body = document.getElementById('as-body');
  const quick = document.getElementById('as-quick');
  const form = document.getElementById('as-form');
  const input = document.getElementById('as-input');
  const closeBtn = document.getElementById('assistant-close');
  if (!fab || !panel || !body || !form) return;

  // 上下文方向：用当前档案的目标岗位帮知识库加权
  const domainHint = () => (state.profile && state.profile.targetRole) || '';

  // ---- 滚动：平滑 + 贴底检测（用户上翻历史时不强行拽回底部） ----
  function isNearBottom() {
    return body.scrollHeight - body.scrollTop - body.clientHeight < 60;
  }
  function scrollToBottom(force) {
    if (!force && !isNearBottom()) return; // 用户正在看历史，不打扰
    body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
  }
  // 用户手动滚动时记录（新消息来了只在原本就贴底时跟随）
  body.addEventListener('scroll', () => { /* isNearBottom() 动态计算，无需状态 */ }, { passive: true });

  // ---- 打字机：答案逐字浮现（约 14 字/拍，单条 ≤ 2.4s） ----
  function typeInto(bubbleEl, text, done) {
    const chars = Array.from(text); // 按码点切（中文安全）
    let i = 0;
    const step = Math.max(1, Math.ceil(chars.length / 34)); // 长文加速
    (function tick() {
      if (i >= chars.length) { done && done(); return; }
      bubbleEl.textContent = chars.slice(0, i + step).join('');
      i += step;
      scrollToBottom(false); // 打字期间跟随（除非用户上翻）
      setTimeout(tick, 65);
    })();
  }

  function bubble(text, who, opts) {
    const o = opts || {};
    const bubbleEl = el('div', { class: 'as-bubble' + (o.matched === false ? ' as-fallback' : '') }, [o.typewriter ? '' : text]);
    const node = el('div', { class: 'as-msg as-' + who }, [bubbleEl]);
    body.appendChild(node);
    if (o.typewriter) {
      typeInto(bubbleEl, text, () => {
        // 打字完成后再挂操作按钮与候选（避免边打字边跳动）
        appendExtras(node, o);
        scrollToBottom(true);
      });
    } else {
      appendExtras(node, o);
      scrollToBottom(true);
    }
    return node;
  }

  function appendExtras(node, o) {
    if (o.action) {
      node.appendChild(el('div', { class: 'as-actions' }, [
        el('button', {
          class: 'btn btn-primary btn-sm', type: 'button',
          onclick: () => {
            panel.style.display = 'none';
            navigate(o.action.route);
          }
        }, [o.action.label])
      ]));
    }
    if (o.alts && o.alts.length) {
      node.appendChild(el('div', { class: 'as-alts' },
        o.alts.filter(Boolean).slice(0, 3).map((q) =>
          el('button', { class: 'as-alt', type: 'button', onclick: () => { input.value = q; form.dispatchEvent(new Event('submit')); } }, [q])
        )
      ));
    }
  }

  // typing 指示器：三点呼吸（替代单调的「…」）
  function showTyping() {
    const node = el('div', { class: 'as-msg as-bot' }, [
      el('div', { class: 'as-bubble as-typing' }, [
        el('i', {}, ['·']), el('i', {}, ['·']), el('i', {}, ['·'])
      ])
    ]);
    body.appendChild(node);
    scrollToBottom(true);
    return node;
  }

  async function ask(q) {
    bubble(q, 'user');
    const typing = showTyping();
    try {
      const r = await call(window.api.assistant.ask(q, domainHint()));
      typing.remove();
      if (window.Sound) window.Sound.play(r.matched ? 'ok' : 'notify');
      bubble(r.answer, 'bot', { matched: r.matched, action: r.action, alts: r.alternatives, typewriter: true });
    } catch (err) {
      typing.remove();
      if (window.Sound) window.Sound.play('err');
      bubble('出错了：' + err.message, 'bot', { matched: false });
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = (input.value || '').trim();
    if (!q) return;
    input.value = '';
    ask(q);
  });

  fab.addEventListener('click', async () => {
    const hidden = panel.style.display === 'none' || !panel.style.display;
    if (hidden) {
      panel.style.display = 'flex'; // 必须是 flex：CSS 的列布局依赖它，block 会废掉 as-body 的滚动
      if (window.Sound) window.Sound.play('click');
      if (!body.children.length) {
        bubble('你好，我是求职小助手。简历怎么写、经历怎么凑、求职流程不懂的都可以问；答不上来的我会直接给你指到对应功能。', 'bot');
        // 热门问题快捷条
        try {
          const hot = await call(window.api.assistant.hot());
          quick.innerHTML = '';
          hot.slice(0, 6).forEach((q) => {
            quick.appendChild(el('button', {
              class: 'as-alt', type: 'button',
              onclick: () => { input.value = q; form.dispatchEvent(new Event('submit')); }
            }, [q]));
          });
        } catch (_) {} // eslint-disable-line no-empty
      }
      setTimeout(() => input.focus(), 60);
    } else {
      panel.style.display = 'none';
    }
  });
  closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
})();

// ============================================================
//  页面 4：面试准备（全本地、零模型）
//  自我介绍由档案确定性生成；题库按方向给；每题带考察点与回答框架，
//  「讲自己经历」类的问题自动指向你档案里最合适的那条素材。
// ============================================================
// ============================================================
//  简历版本（多版本：一个岗位一版）
//  与「回炉快照」的分工：快照是自动产生的后悔药（5 份、只有标签）；
//  版本是用户主动命名、长期保留的定制稿，带它针对的 JD 与保存时评分。
// ============================================================
function fmtVersionTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

async function fillVersionList(card) {
  const list = card.querySelector('.ver-list');
  if (!list) return;
  try {
    const versions = await call(window.api.versions.list(state.user.id));
    list.innerHTML = '';
    if (!versions.length) {
      list.appendChild(el('p', { style: 'font-size:12px;color:var(--ink-2);padding:4px 0;line-height:1.7;' },
        ['还没有版本。给不同岗位各存一版（比如「字节-后端」「国企-数据」），下次同一岗位直接载入，不用重填。']));
      return;
    }
    versions.forEach((v) => {
      const scoreBits = [];
      if (v.auditScore != null) scoreBits.push('体检 ' + v.auditScore);
      if (v.jdScore != null) scoreBits.push('JD ' + v.jdScore + '%');
      list.appendChild(el('div', { class: 'ver-item' }, [
        el('div', { class: 'ver-meta' }, [
          el('span', { class: 'ver-name' }, [v.name]),
          v.hasJd ? el('span', { class: 'ver-jd' }, ['带 JD']) : null,
          el('span', { class: 'ver-time' }, [fmtVersionTime(v.updatedAt)])
        ]),
        v.note ? el('div', { class: 'ver-note' }, [v.note]) : null,
        scoreBits.length ? el('div', { class: 'ver-score' }, [scoreBits.join(' · ')]) : null,
        el('div', { class: 'ver-ops' }, [
          el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            title: '把这个版本载入当前档案（会先备份当前档案到回炉快照）',
            onclick: () => loadVersion(v)
          }, ['载入']),
          el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: () => renameVersionDialog(v)
          }, ['改名']),
          el('button', {
            class: 'btn btn-ghost btn-sm ver-del', type: 'button',
            onclick: async () => {
              const ok = await modalConfirm('删除版本「' + v.name + '」？',
                '删除后无法恢复（回炉快照里可能还有当时的档案，但不保证）。', '删除');
              if (!ok) return;
              try {
                await call(window.api.versions.remove(state.user.id, v.id));
                toast('版本已删除', 'ok');
                renderProfile();
              } catch (err) { toast(err.message, 'err'); }
            }
          }, ['删除'])
        ])
      ]));
    });
  } catch (_) {
    list.innerHTML = '';
    list.appendChild(el('p', { style: 'font-size:12px;color:var(--ink-2);' }, ['版本读取失败']));
  }
}

// 保存当前档案为新版本：带名称/备注，并顺带记下体检分与（若贴过）JD 覆盖率
async function openSaveVersion() {
  if (!state.profile) { toast('请先填写档案', 'err'); return; }

  // 先算好分数存进版本，便于以后横向比较「哪版更贴这个岗位」
  let auditScore = null, jdScore = null, jdHit = 0, jdTotal = 0;
  try {
    const gen = await call(window.api.resume.generate(state.profile, {}));
    auditScore = gen && gen.audit ? gen.audit.score : null;
  } catch (_) { /* 分数算不出来不影响保存 */ }
  const jd = (state.jdText || '').trim();
  if (jd) {
    try {
      const m = state.lastResume && state.lastResume.resume
        ? await call(window.api.resume.matchJd(state.lastResume.resume, jd))
        : null;
      if (m) { jdScore = m.score; jdHit = m.hitCount; jdTotal = m.jdSkillCount; }
    } catch (_) { /* 忽略 */ }
  }

  const d = new Date();
  const defaultName = (state.profile.targetRole || '通用') + ' · ' + (d.getMonth() + 1) + '/' + d.getDate();
  const form = await modalForm('存为新版本', [
    { name: 'name', label: '版本名称', value: defaultName, placeholder: '如：字节-后端 / 国企-数据' },
    { name: 'note', label: '备注（选填）', value: '', placeholder: '如：强调项目量化，投基础架构岗' }
  ], '保存版本');
  if (!form || !form.name) return;

  try {
    await call(window.api.versions.save(state.user.id, {
      name: form.name,
      note: form.note,
      profile: state.profile,
      jdText: jd,
      targetRole: state.profile.targetRole || '',
      template: state.template,
      auditScore, jdScore, jdHit, jdTotal
    }));
    toast('已存为版本「' + form.name + '」' + (jd ? '（含当前 JD）' : ''), 'ok');
    renderProfile();
  } catch (err) {
    toast('保存失败：' + err.message, 'err');
  }
}

// 载入版本：先确保当前档案有后悔药（自动快照），再整体替换
async function loadVersion(v) {
  try {
    const full = await call(window.api.versions.get(state.user.id, v.id));
    const hasData = !isProfileEmpty(state.profile);
    if (hasData) {
      const ok = await modalConfirm('载入版本「' + v.name + '」？',
        '当前档案会被这个版本替换。载入前我们会自动把当前档案备份到右侧「<b>回炉快照</b>」，可随时还原。', '载入并备份');
      if (!ok) return;
      try {
        await call(window.api.snapshots.save(state.user.id, '载入版本前 · ' + fmtSnapshotTime(Date.now()), state.profile));
      } catch (_) { /* 备份失败不阻断 */ }
    }
    state.profile = await call(window.api.profile.save(state.user.id, full.profile));
    // 版本里带着它针对的 JD，一并恢复，方便继续做匹配/优化
    if (full.jdText) {
      state.jdText = full.jdText;
      state.jdMatch = null;
    }
    if (full.template) state.template = full.template;
    toast('已载入版本「' + v.name + '」' + (full.jdText ? '（含它针对的 JD）' : ''), 'ok');
    renderProfile();
  } catch (err) {
    toast('载入失败：' + err.message, 'err');
  }
}

async function renameVersionDialog(v) {
  const form = await modalForm('修改版本', [
    { name: 'name', label: '版本名称', value: v.name, placeholder: '如：字节-后端' },
    { name: 'note', label: '备注', value: v.note || '', placeholder: '选填' }
  ], '保存');
  if (!form || !form.name) return;
  try {
    await call(window.api.versions.rename(state.user.id, v.id, form.name, form.note));
    toast('已更新', 'ok');
    renderProfile();
  } catch (err) { toast(err.message, 'err'); }
}

let _interviewData = null;

async function renderInterviewPage() {
  const root = document.getElementById('route-interview');
  root.innerHTML = '';
  const ico = (n, s) => window.Icons.icon(n, s);

  const head = el('div', { class: 'page-head' }, [
    el('div', { class: 'page-kicker' }, ['STEP 04 / 面试准备']),
    el('h1', { class: 'page-title' }, ['面试前，把这些准备好']),
    el('p', { class: 'page-desc' }, [
      '全部本地生成、不需要任何模型：自我介绍按你的档案自动拼稿（不会编造你没写过的经历和数字），',
      '题库按你的目标岗位方向筛过，每道题给出考察点、回答框架，以及「用你简历里的哪条来答」。'
    ])
  ]);

  if (!state.profile || !(state.profile.name || (state.profile.projects || []).some((x) => x.name))) {
    root.append(head, el('div', { class: 'card' }, [
      el('div', { style: 'padding:28px 22px;text-align:center;color:var(--ink-2);font-size:13px;' },
        ['档案还是空的——面试素材要从你的真实经历里来。先去「信息录入」把档案填上（或载入示例看看效果）。']),
      el('div', { style: 'text-align:center;padding-bottom:20px;' }, [
        el('button', {
          class: 'btn btn-primary btn-sm', type: 'button',
          onclick: () => navigate('profile')
        }, ['去填档案 →'])
      ])
    ]));
    return;
  }

  root.append(head, el('div', { class: 'card' }, [
    el('div', { style: 'padding:22px;text-align:center;color:var(--ink-2);font-size:13px;' }, ['正在生成面试材料…'])
  ]));

  let data = null;
  try {
    data = await call(window.api.interview.prep(JSON.parse(JSON.stringify(state.profile)), {}));
  } catch (err) {
    root.innerHTML = '';
    root.append(head, el('div', { class: 'card' }, [
      el('div', { style: 'padding:22px;color:var(--danger);font-size:13px;' }, ['生成失败：' + err.message])
    ]));
    return;
  }
  _interviewData = data;
  root.innerHTML = '';
  root.append(head, buildIntroCard(data, ico), buildQuestionCards(data, ico), buildOpenCard(data, ico), buildAskBackCard(data, ico));
}

// ---- 自我介绍：生成稿 + 一键复制 ----
function buildIntroCard(data, ico) {
  let secs = 30;
  const textBox = el('div', { class: 'intro-text' });
  const partsBox = el('div', { class: 'intro-parts' });
  const sourcesBox = el('div', { class: 'intro-sources' });

  function paint() {
    const pick = secs === 60 ? data.intro60 : data.intro30;
    textBox.textContent = pick.text;
    partsBox.innerHTML = '';
    pick.parts.forEach((p) => {
      partsBox.appendChild(el('div', { class: 'intro-part' }, [
        el('span', { class: 'ip-label' }, [p.label]),
        el('span', { class: 'ip-text' }, [p.text])
      ]));
    });
    sourcesBox.textContent = pick.sources.length
      ? '取材于你档案里的：' + pick.sources.join('；')
      : '提示：档案里补充项目和实习后，这里会自动换成更具体的经历。';
  }

  const segBtns = {
    30: el('button', { class: 'seg-btn active', type: 'button' }, ['30 秒版']),
    60: el('button', { class: 'seg-btn', type: 'button' }, ['60 秒版'])
  };
  const paintSeg = () => {
    segBtns[30].classList.toggle('active', secs === 30);
    segBtns[60].classList.toggle('active', secs === 60);
    paint();
  };
  segBtns[30].addEventListener('click', () => { secs = 30; paintSeg(); });
  segBtns[60].addEventListener('click', () => { secs = 60; paintSeg(); });
  paint();

  return el('div', { class: 'card' }, [
    el('div', { class: 'card-title' }, [
      el('h3', {}, [ico('user', 15), '自我介绍（面试第一问）']),
      el('span', { class: 'hint' }, ['按你的档案自动生成 · 不含你没写过的内容'])
    ]),
    el('div', { class: 'seg seg-thin', style: 'margin-bottom:10px;' }, [segBtns[30], segBtns[60]]),
    textBox,
    el('div', { class: 'row', style: 'margin:10px 0 6px;' }, [
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: async () => {
          const res = await window.api.clipboard.writeText(textBox.textContent);
          if (res && res.ok) toast('已复制，可直接背/改', 'ok');
        }
      }, [ico('doc', 13), '复制全文'])
    ]),
    partsBox,
    sourcesBox
  ]);
}

// ---- 题库：考察点 + 框架 + 素材指向 ----
function questionCard(q, ico) {
  const body = el('div', { class: 'qi-body', style: 'display:none;' }, [
    el('div', { class: 'qi-focus' }, [el('b', {}, ['考察点：']), q.focus]),
    el('div', { class: 'qi-frame' }, [
      el('b', {}, ['回答框架：']),
      el('ol', {}, q.frame.map((f) => el('li', {}, [f])))
    ]),
    q.pitfall ? el('div', { class: 'qi-pitfall' }, [el('b', {}, ['常见坑：']), q.pitfall]) : null,
    q.material ? el('div', { class: 'qi-material' }, [el('b', {}, ['用你的素材答：']), q.material]) : null
  ]);
  const toggle = el('button', { class: 'qi-toggle', type: 'button' }, ['展开 ▾']);
  toggle.addEventListener('click', () => {
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    toggle.textContent = open ? '展开 ▾' : '收起 ▴';
  });
  return el('div', { class: 'q-item' }, [
    el('div', { class: 'q-head' }, [
      el('span', { class: 'q-text' }, [q.q]),
      q.material ? el('span', { class: 'q-badge' }, ['有素材']) : null,
      toggle
    ]),
    body
  ]);
}

function buildQuestionCards(data, ico) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-title' }, [
      el('h3', {}, [ico('briefcase', 15), '高频问题']),
      el('span', { class: 'hint' }, ['按你的方向（' + (DOMAIN_LABELS[data.domain] || data.domain) + '）筛过'])
    ]),
    el('div', { class: 'q-group-label' }, ['方向专属 · ' + (DOMAIN_LABELS[data.domain] || data.domain)]),
    el('div', {}, data.domainSpecific.map((q) => questionCard(q, ico))),
    el('div', { class: 'q-group-label' }, ['通用 · 任何岗位都会问']),
    el('div', {}, data.general.map((q) => questionCard(q, ico)))
  ]);
}

// ---- 网申开放题模板 ----
function buildOpenCard(data, ico) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-title' }, [
      el('h3', {}, [ico('doc', 15), '网申开放题模板']),
      el('span', { class: 'hint' }, ['框架 + 填空句，照着写就不空'])
    ]),
    el('div', {}, data.openTemplates.map((t) => {
      const body = el('div', { class: 'qi-body', style: 'display:none;' }, [
        el('div', { class: 'qi-frame' }, [el('b', {}, ['写作框架：']), el('ol', {}, t.frame.map((f) => el('li', {}, [f])))]),
        el('div', { class: 'qi-material' }, [el('b', {}, ['起手句（括号里换成你的事）：']), t.starter]),
        t.pitfall ? el('div', { class: 'qi-pitfall' }, [el('b', {}, ['常见坑：']), t.pitfall]) : null
      ]);
      const toggle = el('button', { class: 'qi-toggle', type: 'button' }, ['展开 ▾']);
      toggle.addEventListener('click', () => {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        toggle.textContent = open ? '展开 ▾' : '收起 ▴';
      });
      return el('div', { class: 'q-item' }, [
        el('div', { class: 'q-head' }, [el('span', { class: 'q-text' }, [t.title]), toggle]),
        body
      ]);
    }))
  ]);
}

// ---- 反问清单 ----
function buildAskBackCard(data, ico) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-title' }, [
      el('h3' , {}, [ico('spark', 15), '面试最后的反问']),
      el('span', { class: 'hint' }, ['这一问算分 · 挑 2 个问即可'])
    ]),
    el('div', { class: 'ask-list' }, data.askBack.map((q) =>
      el('div', { class: 'ask-item' }, [el('span', { class: 'ask-dot' }, ['?']), el('span', {}, [q])])
    ))
  ]);
}
