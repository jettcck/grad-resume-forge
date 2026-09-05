'use strict';

window.addEventListener('error', (e) => {
  console.error('[app.js error] ' + (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || ''));
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[app.js unhandledrejection] ' + ((e.reason && e.reason.message) || e.reason || ''));
});

const { el, esc, toast, call, modalForm, modalTextarea } = window.UI;

// 本地会话凭证的存储键
const TOKEN_KEY = 'gradResume.sessionToken';

const state = {
  user: null,
  token: null,
  profile: null,
  applications: [],
  template: 'classic',
  lastResume: null,
  jdText: '',
  jdMatch: null
};

function blankProfile() {
  return {
    name: '', phone: '', email: '', city: '', github: '',
    targetRole: '', summary: '', skills: '',
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

// ---------------- 关于 / 自动更新 ----------------
let _updState = { status: null, downloaded: null }; // 更新运行时状态（供横幅）

function setFurnace(text, hot) {
  const txt = document.getElementById('furnace-txt');
  const dot = document.getElementById('furnace-dot');
  if (txt) txt.textContent = text;
  if (dot) dot.classList.toggle('hot', !!hot);
}

// 全局订阅更新事件（登录前后都生效）
window.api.updater.onEvent((ev) => {
  const { ev: kind, payload } = ev || {};
  if (kind === 'checking') {
    setFurnace('检查更新中…', true);
  } else if (kind === 'available') {
    setFurnace('发现新版本 v' + (payload && payload.version || '?') + '，下载中…', true);
  } else if (kind === 'progress') {
    setFurnace('下载更新 ' + (payload && payload.percent || 0) + '%', true);
  } else if (kind === 'downloaded') {
    _updState.downloaded = (payload && payload.version) || '?';
    setFurnace('新版本已就绪 · v' + _updState.downloaded, true);
    if (window.Sound) window.Sound.play('done'); // 更新就绪：琶音
    showUpdateReady(_updState.downloaded);
  } else if (kind === 'not-available') {
    setFurnace('炉温就绪 · FORGE READY', false);
  } else if (kind === 'error') {
    setFurnace('炉温就绪 · FORGE READY', false);
    // 网络失败不打扰：仅当用户主动打开「关于」弹窗时可见
    _updState.lastError = payload && payload.message;
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

// 「关于」弹窗：版本 / 检查更新 / 镜像设置 / 手动下载链接
async function openAbout() {
  const overlay = el('div', { class: 'modal-overlay' });
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  let st = null;
  try { st = await call(window.api.updater.status()); } catch (_) {} // eslint-disable-line no-empty

  const statusText = el('div', { class: 'about-status' }, ['读取中…']);
  const checkBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, ['检查更新']);
  const mirrorInput = el('input', {
    type: 'text', value: (st && st.mirror) || '',
    placeholder: '留空直连 GitHub；例：https://ghproxy.cn'
  });

  async function runCheck() {
    checkBtn.disabled = true;
    statusText.textContent = '正在检查…';
    try {
      await call(window.api.updater.check());
      // 结果经 updater:event 异步回来；这里先给出中间反馈
      setTimeout(() => {
        checkBtn.disabled = false;
        if (statusText.textContent === '正在检查…') {
          statusText.textContent = '检查请求已发出（结果见左下角炉温提示）';
        }
      }, 4000);
    } catch (err) {
      checkBtn.disabled = false;
      statusText.textContent = '检查失败：' + err.message;
    }
  }
  checkBtn.addEventListener('click', runCheck);

  if (_updState.downloaded) {
    statusText.textContent = '✓ 新版本 v' + _updState.downloaded + ' 已下载，等待安装';
  } else if (_updState.lastError) {
    statusText.textContent = '⚠ 上次检查失败：' + _updState.lastError + '（可尝试填写下载镜像）';
  } else if (st && !st.updaterActive) {
    statusText.textContent = '当前为开发模式，更新仅在安装版（打包后）生效';
  } else {
    statusText.textContent = '当前版本 v' + ((st && st.version) || '1.0.0');
  }

  const repo = (st && st.repo) || '';
  const box = el('div', { class: 'modal-box' }, [
    el('h3', { class: 'modal-title' }, ['关于 简历锻造炉']),
    el('div', { class: 'modal-body' }, [
      el('div', { class: 'about-status-wrap' }, [statusText]),
      el('label', { class: 'field' }, [
        el('span', {}, ['下载镜像（国内加速，选填）']),
        mirrorInput
      ]),
      el('p', { style: 'font-size:11.5px;color:var(--ink-2);line-height:1.7;' },
        ['更新包托管在 GitHub Releases；国内网络不通时可填写加速镜像前缀（如 https://ghproxy.cn），保存后重试检查。'])
    ]),
    el('div', { class: 'modal-actions' }, [
      repo ? el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: () => window.api.shell.openExternal('https://github.com/' + repo + '/releases')
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
      checkBtn
    ])
  ]);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
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
  ['profile', 'resume', 'apps'].forEach((r) => {
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
  if (route === 'apps') renderApps();
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
  return el('label', { class: 'field' }, [
    el('span', {}, [label]),
    el('textarea', { name, placeholder: placeholder || '' }, [value || ''])
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
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: onImportResume }, ['导入旧简历'])
  ]);

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
      inputField('GitHub / 作品集', 'github', p.github, 'github.com/yourname 或作品集 / 证书链接'),
      autocompleteField('目标岗位', 'targetRole', p.targetRole, '输入关键词选择，如：后端', 'targetRole')
    ]),
    areaField('一句话自我介绍（选填，留空则自动生成）', 'summary', p.summary, '留空即可，引擎会根据你的经历自动拼一句朴实、无套话的简介')
  ]);

  const skillsCard = el('div', { class: 'card', id: 'card-skills' }, [
    cardTitle('wrench', '专业技能', '逗号 / 顿号分隔'),
    areaField('技能清单', 'skills', p.skills, '技能 / 工具 / 证书都可以：Python, Excel, SQL, 文案策划, 教师资格证…'),
    (p.skills || '').trim() ? el('div', { class: 'skill-chip-row' },
      p.skills.split(/[,，、;；\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 24)
        .map((s) => el('span', { class: 'r-skill' }, [s]))
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

  // ---- 右列：锻造侧栏（完成度仪表 + 档案统计 + 摘要卡）----
  const stats = buildProfileStats(p);
  const sideCol = el('div', { class: 'profile-side' }, [
    el('div', { class: 'card side-card completeness' }, [
      cardTitle('gauge', '档案完成度'),
      el('div', { class: 'audit-score' }, [
        el('span', { class: 'score-num', style: 'color:' + (stats.score >= 80 ? 'var(--teal)' : stats.score >= 50 ? 'var(--gold)' : 'var(--danger)') }, [String(stats.score)]),
        el('span', { class: 'score-max' }, ['%'])
      ]),
      el('div', { class: 'meter' }, [el('i', { style: 'width:' + stats.score + '%;background:' + (stats.score >= 80 ? 'var(--teal)' : stats.score >= 50 ? 'var(--gold)' : 'var(--danger)') })]),
      el('div', { class: 'check-list' }, stats.items.map((it) =>
        el('div', { class: 'check-item' + (it.done ? ' done' : '') }, [
          el('span', { class: 'ci-ico' }, [it.done ? '✓' : '○']),
          el('span', { class: 'ci-label' }, [it.label])
        ])
      ))
    ]),
    el('div', { class: 'card side-card' }, [
      cardTitle('doc', '档案速览'),
      el('div', { class: 'stat-rows' }, [
        ['教育', stats.countEdu + ' 段', 'cap'],
        ['实习', stats.countIntern + ' 段', 'briefcase'],
        ['项目', stats.countProj + ' 段', 'code'],
        ['技能', stats.countSkill + ' 项', 'wrench']
      ].map(([k, v, ic]) =>
        el('div', { class: 'stat-row' }, [ico(ic, 15), el('span', { class: 'sk' }, [k]), el('b', {}, [v])])
      ))
    ]),
    el('div', { class: 'card side-card', id: 'card-snapshots' }, [
      cardTitle('refresh', '回炉快照', 'Agent 改写前自动备份'),
      el('div', { class: 'snap-list' }, [el('p', { style: 'font-size:12px;color:var(--ink-2);padding:4px 0;' }, ['读取中…'])])
    ])
  ]);

  // 快照列表异步填充（不阻塞首屏渲染）
  (async () => {
    const card = document.getElementById('card-snapshots');
    const list = card && card.querySelector('.snap-list');
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

  const twoCols = el('div', { class: 'profile-layout' }, [
    el('div', { class: 'profile-main' }, [basicsCard, skillsCard, eduCard, internCard, projCard]),
    sideCol
  ]);

  root.append(head, importBar, twoCols, saveBar);
}

// 档案完成度：8 项检查（用于录入页侧栏仪表 + 保存条）
function buildProfileStats(p) {
  const items = [
    { label: '基本信息（姓名/手机/邮箱）', done: !!(p.name && p.phone && p.email) },
    { label: '城市与目标岗位', done: !!(p.city && p.targetRole) },
    { label: '一句话自我介绍', done: !!((p.summary || '').trim()) },
    { label: '技能 ≥ 4 项', done: (p.skills || '').split(/[,，、;；\n]/).filter((s) => s.trim()).length >= 4 },
    { label: '教育经历 ≥ 1 段', done: (p.education || []).some((e) => e.school) },
    { label: '项目经历 ≥ 1 段', done: (p.projects || []).some((e) => e.name) },
    { label: '项目描述有量化', done: (p.projects || []).some((e) => /\d/.test(e.description || '')) },
    { label: 'GitHub / 作品集 / 证书链接', done: !!(p.github || '').trim() }
  ];
  const done = items.filter((x) => x.done).length;
  return {
    items,
    score: Math.round((done / items.length) * 100),
    countEdu: (p.education || []).filter((e) => e.school).length,
    countIntern: (p.internships || []).filter((e) => e.name).length,
    countProj: (p.projects || []).filter((e) => e.name).length,
    countSkill: (p.skills || '').split(/[,，、;；\n]/).filter((s) => s.trim()).length
  };
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
    parsed.github ? 'GitHub' : null,
    parsed.targetRole ? '目标岗位' : null
  ].filter(Boolean);

  const listCounts = [
    (parsed.education || []).length ? '教育 ' + parsed.education.length + ' 段' : null,
    (parsed.internships || []).length ? '实习 ' + parsed.internships.length + ' 段' : null,
    (parsed.projects || []).length ? '项目 ' + parsed.projects.length + ' 段' : null,
    parsed.skills ? '技能 ' + parsed.skills.split(/[,，、;；]/).filter(Boolean).length + ' 项' : null,
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
function applyImport(parsed, mode) {
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
  // 技能：合并去重（按逗号类分隔符切开）
  if (parsed.skills) {
    const parts = String(out.skills || '')
      .split(/[,，、;；\n]/).map((s) => s.trim()).filter(Boolean);
    const seen = new Set(parts.map((s) => s.toLowerCase()));
    String(parsed.skills).split(/[,，、;；\n]/).forEach((s) => {
      const t = s.trim();
      if (t && !seen.has(t.toLowerCase())) { parts.push(t); seen.add(t.toLowerCase()); }
    });
    out.skills = parts.join(', ');
  }
  // 列表：追加
  out.education = (out.education || []).concat(parsed.education || []);
  out.internships = (out.internships || []).concat(parsed.internships || []);
  out.projects = (out.projects || []).concat(parsed.projects || []);
  return out;
}

function collectProfile() {
  function val(scope, name) {
    const node = scope.querySelector('[name="' + name + '"]');
    return node ? node.value.trim() : '';
  }
  const basics = document.getElementById('card-basics');
  const skills = document.getElementById('card-skills');

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
    education, internships, projects
  };
}

async function onSaveProfile(silent) {
  const profile = collectProfile();
  try {
    state.profile = await call(window.api.profile.save(state.user.id, profile));
    if (!silent) toast('信息已保存到本地', 'ok');
  } catch (err) {
    toast(err.message, 'err');
    throw err;
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

  // 生成失败时给出错误卡片 + 重试入口，而不是留下半空白的页面
  let result;
  try {
    result = await call(window.api.resume.generate(state.profile, {}));
  } catch (err) {
    root.append(head, el('div', { class: 'card' }, [
      el('div', { style: 'padding:34px 24px;text-align:center;' }, [
        el('p', { style: 'color:var(--danger);font-size:14px;margin-bottom:16px;' }, ['简历生成失败：' + err.message]),
        el('button', { class: 'btn btn-primary', type: 'button', onclick: () => renderResumePage() }, ['重试'])
      ])
    ]));
    return;
  }
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
  const DOMAIN_LABELS = {
    backend: '后端', frontend: '前端', algorithm: '算法', data: '数据', llm: '大模型 / Agent',
    finance: '金融财务', marketing: '市场运营', design: '创意设计', eng: '机械电气',
    civil: '土木建筑', education: '教育培训', medical: '医药卫生', business: '人力行政',
    general: '通用'
  };
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
      ['JD 方向：' + (DOMAIN_LABELS[jd.domain] || jd.domain) + ' · 覆盖 ' + jd.hitCount + ' / ' + jd.jdSkillCount + ' 项 JD 技能']),
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
let _agentMode = 'pipeline'; // 'pipeline' 确定性编排 | 'agentic' LLM 自主选工具

async function refreshAgentStatus() {
  try {
    _agentStatus = await call(window.api.agent.status());
  } catch (_) {
    _agentStatus = { available: false, models: [], config: {} };
  }
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

  let statusLine;
  if (_agentStatus.available) {
    const extra = isCloud
      ? '（云端）'
      : (_agentStatus.models && _agentStatus.models.length ? '（已装 ' + _agentStatus.models.length + ' 个模型）' : '');
    statusLine = el('span', { class: 'agent-dot on', title: (_agentStatus.models || []).join('\n') || '模型服务已连接' },
      ['● ' + (cfg.model || '本地模型') + extra]);
  } else {
    const hint = isCloud
      ? (_agentStatus.error || '请到 ⚙ 配置填写 API 密钥')
      : '安装 Ollama 后运行：ollama pull ' + (cfg.model || 'qwen2.5:7b');
    statusLine = el('span', { class: 'agent-dot off', title: hint },
      ['○ ' + (isCloud ? '云端模型未就绪（仍可用规则引擎）' : '未检测到 Ollama（仍可用规则引擎）')]);
  }

  const runLabel = _agentStatus.available
    ? '⚡ 对着这份 JD 跑一轮'
    : (isCloud ? '运行（需先配置云端密钥）' : '运行（需先启动 Ollama）');

  const modeBtns = {
    pipeline: el('button', { class: 'seg-btn' + (_agentMode === 'pipeline' ? ' active' : ''), type: 'button', title: '固定流程：分析 JD → 改写 → 校验 → 复测，快且稳' }, ['流水线']),
    agentic: el('button', { class: 'seg-btn' + (_agentMode === 'agentic' ? ' active' : ''), type: 'button', title: 'LLM 通过原生 function calling 自主决定调用哪个工具、何时收工' }, ['自主 Agent'])
  };
  modeBtns.pipeline.addEventListener('click', () => { _agentMode = 'pipeline'; renderResumePage(); });
  modeBtns.agentic.addEventListener('click', () => { _agentMode = 'agentic'; renderResumePage(); });

  return el('div', { class: 'audit' }, [
    el('div', { class: 'card-title mb-0' }, [
      el('h3', {}, [window.Icons.icon('zap'), 'Agent 深度优化']),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', style: 'padding:4px 10px;',
        title: '本地 / 云端 · 模型 · 密钥', onclick: openAgentConfig
      }, [window.Icons.icon('gear', 13), '配置'])
    ]),
    statusLine,
    el('div', { class: 'seg seg-thin' }, [modeBtns.pipeline, modeBtns.agentic]),
    el('p', { style: 'font-size:12px;color:var(--ink-2);line-height:1.7;margin:0 0 12px;' }, [
      _agentMode === 'agentic'
        ? '自主模式：LLM 通过 function calling 自主调用分析 / 体检 / 改写工具，自己决定何时收工。产出仍过确定性校验门。'
        : '流水线模式：固定流程「分析 JD → 改写 → 校验 → 复测」，轮次少、速度快，产出过确定性校验门。'
    ]),
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
  let provider = isCloudStored ? 'cloud' : 'ollama';

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
    ollama: el('button', { class: 'seg-btn', type: 'button' }, ['本地 Ollama']),
    cloud: el('button', { class: 'seg-btn', type: 'button' }, ['云端 API'])
  };
  const fieldsBox = el('div', { class: 'modal-body' }, []);
  let endpointInput, modelInput, keyInput, tempInput, presetSelect;

  function renderFields() {
    segBtns.ollama.classList.toggle('active', provider === 'ollama');
    segBtns.cloud.classList.toggle('active', provider === 'cloud');
    fieldsBox.innerHTML = '';

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
      const hasKey = isCloudStored && stored.apiKey;
      const key = textInput(
        hasKey ? 'API 密钥（已加密保存 · 留空保留原密钥）' : 'API 密钥（safeStorage 加密存储，只在本机）',
        '', hasKey ? '已保存，重填可覆盖' : 'sk-…', 'password'
      );
      keyInput = key.input;

      fieldsBox.append(
        el('label', { class: 'field' }, [el('span', {}, ['服务商预设']), presetSelect]),
        ep.row, md.row, key.row, temp.row
      );
    } else {
      const ep = textInput('Ollama 地址', !isCloudStored ? (stored.endpoint || 'http://127.0.0.1:11434') : 'http://127.0.0.1:11434');
      endpointInput = ep.input;
      const md = textInput('模型名称', !isCloudStored ? (stored.model || 'qwen2.5:7b') : 'qwen2.5:7b');
      modelInput = md.input;
      fieldsBox.append(ep.row, md.row, temp.row);
    }
  }

  segBtns.ollama.addEventListener('click', () => { provider = 'ollama'; renderFields(); });
  segBtns.cloud.addEventListener('click', () => { provider = 'cloud'; renderFields(); });
  renderFields();

  async function save() {
    const temperature = Math.max(0, Math.min(1, parseFloat(tempInput.value) || 0.3));
    const value = {
      provider,
      endpoint: (endpointInput.value || '').trim(),
      model: (modelInput.value || '').trim(),
      temperature
    };
    if (provider === 'cloud') {
      const typed = (keyInput.value || '').trim();
      if (typed) {
        value.apiKey = typed; // 新填的密钥
      } else if (isCloudStored && stored.apiKey) {
        value.apiKey = stored.apiKey; // 留空 = 保留已保存密钥（主进程侧是解密态明文）
      }
      if (!value.endpoint || !value.model || !value.apiKey) {
        toast('云端模式需填写 API 地址、模型名称与 API 密钥', 'err');
        return;
      }
    } else {
      value.endpoint = value.endpoint || 'http://127.0.0.1:11434';
      value.model = value.model || 'qwen2.5:7b';
    }
    try {
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
      ['本地 Ollama 全程不出本机；云端走 OpenAI 兼容接口（DeepSeek / Kimi / 通义 / OpenAI），密钥自备、只存本机。无论哪种模型，改写都先过本地确定性校验门。']),
    el('div', { class: 'seg' }, [segBtns.ollama, segBtns.cloud]),
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
  if (!_agentStatus || !_agentStatus.available) {
    const isCloud = _agentStatus && _agentStatus.config && _agentStatus.config.provider === 'cloud';
    if (isCloud) {
      toast('云端模型未就绪：' + (_agentStatus.error || '请到 ⚙ 配置填写 API 地址与密钥'), 'err');
    } else {
      toast('未检测到 Ollama。安装后执行 ollama pull ' + ((_agentStatus && _agentStatus.config && _agentStatus.config.model) || 'qwen2.5:7b') + '，或到 ⚙ 配置切换云端 API', 'err');
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
  const overlay = el('div', { class: 'modal-overlay' });
  const box = el('div', { class: 'modal-box modal-box-wide' }, [
    el('h3', { class: 'modal-title' }, ['Agent 深度优化 · 运行中']),
    el('p', { style: 'font-size:12px;color:var(--ink-2);margin-bottom:12px;' },
      ['本地模型推理需要一些时间，每个步骤完成后会实时出现在下面。']),
    stepsBox,
    streamBox,
    el('div', { class: 'modal-actions' }, [])
  ]);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const unsub = window.api.agent.onProgress((s) => {
    stepsBox.appendChild(el('div', { class: 'agent-step' + (s.ok ? '' : ' bad') }, [
      el('span', { class: 'st-ico' }, [s.ok ? '✓' : '✕']),
      el('span', { class: 'st-label' }, [s.label]),
      el('span', { class: 'st-detail' }, [s.detail + ' · ' + s.ms + 'ms'])
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
    result = await call(window.api.agent.run(state.profile, jd, { mode: _agentMode }));
  } catch (err) {
    error = err.message;
  } finally {
    unsub();
    unsubStream();
  }

  if (window.Sound) window.Sound.play(result && result.ok ? 'done' : 'err'); // Agent 收工音
  renderAgentResult(overlay, box, result, error);
}

// 运行结束：进度模态 → 结果视图（前后对比 + diff + 应用按钮）
function renderAgentResult(overlay, box, result, error) {
  box.innerHTML = '';

  if (error || !result || !result.ok) {
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
  const stat = (label, a, b, suffix) =>
    el('div', { class: 'agent-stat' }, [
      el('span', {}, [label]),
      el('b', {}, [a + suffix + ' → ' + b + suffix + up(a, b)])
    ]);

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
    result.jdMissingAfter && result.jdMissingAfter.length
      ? el('p', { style: 'font-size:12px;color:var(--ink-2);margin:6px 0 0;' },
          ['仍缺失：' + result.jdMissingAfter.slice(0, 8).join('、') + '，会的话手动补进技能或项目。'])
      : null,
    result.contextOmitted
      ? el('p', { style: 'font-size:12px;color:var(--ink-2);margin:6px 0 0;' },
          ['另有 ' + result.contextOmitted + ' 段经历与该 JD 相关度低，未送入本轮改写。'])
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
  // 行切分与主进程引擎一致
  const splitDesc = (d) => String(d || '')
    .split(/\r?\n|；|;|。(?!\d)/).map((s) => s.trim()).filter(Boolean);

  const byItem = {};
  result.accepted.forEach((r) => {
    const m = r.id.match(/^(p\d+|i\d+|summary)(?:-b(\d+))?$/);
    if (!m) return;
    (byItem[m[1]] = byItem[m[1]] || []).push({ bullet: Number(m[2] || 0), text: r.text });
  });

  const p = JSON.parse(JSON.stringify(state.profile)); // 深拷贝再改
  ['projects', 'internships'].forEach((kind) => {
    (p[kind] || []).forEach((it, i) => {
      const key = (kind === 'projects' ? 'p' : 'i') + i;
      const patched = byItem[key];
      if (!patched) return;
      const lines = splitDesc(it.description);
      patched.forEach((x) => { if (lines[x.bullet] != null) lines[x.bullet] = x.text; });
      it.description = lines.join('\n');
    });
  });
  if (byItem.summary && byItem.summary[0]) p.summary = byItem.summary[0].text;

  // 后悔药：应用前快照当前档案（失败不阻断——用户已逐条勾选）
  const snapped = await saveSnapshotBeforeApply();

  try {
    state.profile = await call(window.api.profile.save(state.user.id, p));
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
  out.push([b.phone, b.email, b.city, b.github].filter(Boolean).join(' | '));
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

async function openAddApplication() {
  const data = await modalForm('新增投递', [
    { name: 'company', label: '公司名称', placeholder: '如：字节跳动' },
    { name: 'position', label: '岗位名称', value: state.profile.targetRole || '软件开发工程师' }
  ], '添加');
  if (!data || !data.company) return;
  saveApplication({ company: data.company, position: data.position, stage: 'wish' });
}

// 打开某企业官网投递入口，并自动落一条投递记录（去重：同公司已存在则只更新时间/链接）
async function applyToCompany(company) {
  try {
    const res = await window.api.shell.openExternal(company.url);
    if (!res.ok) { toast(res.error, 'err'); return; }
    const existing = state.applications.find((a) => a.company === company.name);
    const position = state.profile.targetRole || '软件开发工程师';
    if (existing) {
      await saveApplication({ id: existing.id, url: company.url, stage: existing.stage || 'applied' });
      toast('已打开「' + company.name + '」官网投递页', 'ok');
    } else {
      await saveApplication({ company: company.name, position, url: company.url, stage: 'applied' });
      toast('已打开「' + company.name + '」官网，并记入「已投递」', 'ok');
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

  root.append(head, toolbar, platformPanel, directPanel, board);
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
  actions.push(el('button', { class: 'del', type: 'button', onclick: async () => {
    await call(window.api.applications.remove(state.user.id, a.id));
    state.applications = state.applications.filter((x) => x.id !== a.id);
    renderApps();
  } }, ['删除']));

  return el('div', { class: 'app-card' }, [
    el('div', { class: 'co' }, [a.company]),
    el('div', { class: 'po' }, [a.position || '—']),
    el('div', { class: 'time' }, [timeAgo(a.updatedAt || a.createdAt)]),
    el('div', { class: 'row' }, actions)
  ]);
}
