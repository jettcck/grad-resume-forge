'use strict';

// 渲染层回归测试：「应用选中的改写」必须只应用被勾选的条目。
//
// 背景：预览弹窗里用户可以逐条取消勾选，提示文案承诺「取消勾选可保留对应原文」。
// 曾出现的 bug 是 applyAgentResult 收到了勾选列表（acceptedList）却没用它，
// 仍然遍历 result.accepted，导致取消勾选的条目照样写进档案。
//
// 现在渲染层不再自己切分行，而是把「勾选后的清单」交给主进程的引擎（applyRewritesToProfile）
// 回填 —— 这里用真引擎实现当桩件，所以本测试同时守着两件事：
//   1) 渲染层只把勾选的条目交给主进程（不多交、不少交）
//   2) 回填结果确实只改了勾选的那些条目，其余逐字保留
//
// 这里直接从 src/renderer/app.js 里切出真实实现来跑（不是复制一份逻辑），
// 所以只要那个函数继续忽略勾选列表，本测试就会红。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const agentReal = require(path.join(__dirname, 'dist/main/agent'));

// 看门狗：防止意外悬挂
setTimeout(() => {
  console.error('⏰ 看门狗超时：测试疑似悬挂，强制退出（exit 1）');
  process.exit(1);
}, 30000).unref();

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

const APP_JS = path.join(__dirname, 'src', 'renderer', 'app.js');

// 从源码中按花括号配平切出指定函数（渲染层重构后若找不到，测试会明确报错而不是静默通过）
function extractFunction(source, name) {
  const asyncSig = 'async function ' + name + '(';
  const sig = source.includes(asyncSig) ? asyncSig : 'function ' + name + '(';
  const start = source.indexOf(sig);
  if (start < 0) throw new Error('未在 app.js 中找到 ' + name + '()，渲染层重构后请同步更新本测试');
  const open = source.indexOf('{', start);
  if (open < 0) throw new Error(name + '() 缺少函数体');
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const body = source.slice(start, i + 1);
        if (!body.endsWith('}')) throw new Error(name + '() 切分异常');
        return body;
      }
    }
  }
  throw new Error(name + '() 花括号不配平');
}

// 忠实复刻 ui.js 的 call()：解包 {ok,data}，!ok 时抛错
async function call(promise) {
  const res = await promise;
  if (!res || !res.ok) throw new Error((res && res.error) || '操作失败');
  return res.data;
}

const source = fs.readFileSync(APP_JS, 'utf8');
const snippet = extractFunction(source, 'applyAgentResult');

// 提供最小 DOM，执行真实配置弹窗的保存点击，捕获作用域错误。
function makeConfigSandbox(config) {
  const nodes = [];
  function el(tag, attrs = {}, children = []) {
    const node = { tag, attrs, value: attrs.value || '', checked: !!attrs.checked,
      children: [], style: {}, classList: { toggle() {} }, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; }, remove() {},
      appendChild(child) { this.children.push(child); }, append(...items) { this.children.push(...items); },
      querySelector(name) {
        return this.children.find((x) => x && x.tag === name) ||
          this.children.map((x) => x && x.querySelector ? x.querySelector(name) : null).find(Boolean);
      }
    };
    node.append(...children); nodes.push(node); return node;
  }
  const box = { console, el, nodes, saved: [], toasts: [], _agentMode: 'pipeline',
    _agentStatus: { config }, CLOUD_PRESETS: [], call,
    toast: (msg) => box.toasts.push(msg), renderResumePage() {},
    document: { body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} },
    window: { api: { agent: { detectLocal: async () => ({ ok: true, data: [] }) },
      secure: { status: async () => ({ ok: true, data: { available: true } }) },
      settings: { save: async (_key, value) => { box.saved.push(value); return { ok: true, data: value }; } }
    } }
  };
  vm.createContext(box);
  vm.runInContext(extractFunction(source, 'openAgentConfig'), box);
  box.openAgentConfig();
  box.save = () => nodes.find((n) => n.tag === 'button' && n.children.includes('保存')).attrs.onclick();
  box.input = (placeholder) => nodes.find((n) => n.tag === 'input' && n.attrs.placeholder === placeholder);
  return box;
}

// 用桩件把函数跑起来：只提供它真正依赖的全局量
function makeSandbox(profile) {
  const box = {
    console,
    state: { user: { id: 'u1' }, profile: profile, token: 't' },
    call: call,
    toast: (msg, kind) => { box.toasts.push({ msg: msg, kind: kind }); },
    toasts: [],
    renderResumePage: () => {},
    window: {
      api: {
        // 与主进程一致：切分与回填由引擎负责（渲染层只负责交上「勾了哪些」）
        resume: {
          commitRewrites: async (userId, profile, accepted) => {
            box.handedOver.push(accepted.map((r) => r.id));
            const next = agentReal.applyRewritesToProfile(profile, accepted);
            box.saved.push({ userId, profile: next });
            return { ok: true, data: next };
          }
        },
        profile: {
          save: async (userId, p) => {
            box.saved.push({ userId: userId, profile: p });
            return { ok: true, data: p };
          }
        }
      }
    },
    saved: [],
    accountGeneration: 0,
    handedOver: []
  };
  vm.createContext(box);
  vm.runInContext(snippet + '\n;globalThis.__applyAgentResult = applyAgentResult;', box);
  return box;
}

const ORIGINAL = {
  name: '张三',
  summary: '原简介',
  skills: 'Java',
  projects: [{ name: '订单系统', tech: 'Java', description: '原文A：优化订单系统，P99 从 800ms 降到 120ms\n原文B：开发用户模块，支撑日活 3 万' }],
  internships: [{ name: '某公司', description: '实习原文' }]
};

const rewriteFixture = agentReal.validateRewrites(agentReal.buildTaskItems(ORIGINAL), [
  { id: 'p0-b0', text: '改写A：主导订单系统优化，P99 从 800ms 降到 120ms' },
  { id: 'p0-b1', text: '改写B：承担用户模块开发，支撑日活 3 万' },
  { id: 'summary', text: '改写简介' }
], ORIGINAL, undefined, require('./dist/main/resume-evidence').createProfileEvidence(ORIGINAL, 'Java 后端'));
if (rewriteFixture.rejected.length) throw new Error('测试候选未通过校验：' + JSON.stringify(rewriteFixture.rejected));
const REWRITES = rewriteFixture.accepted;

(async () => {
  for (const operation of ['onSaveProfile', 'loadDemoProfile', 'loadVersion']) {
    const box = makeSandbox(JSON.parse(JSON.stringify(ORIGINAL)));
    Object.assign(box, { collectProfile: () => ORIGINAL, clearSaveBarDirty() {},
      document: { querySelector: () => null }, renderProfile() {}, isProfileEmpty: () => true,
      DEMO_PROFILES: { cs: ORIGINAL } });
    box.window.api.versions = { get: async () => ({ ok: true, data: { profile: ORIGINAL } }) };
    let release, started;
    const waitingForSave = new Promise(resolve => { started = resolve; });
    box.window.api.profile.save = (userId) => {
      box.saved.push({ userId }); started();
      return new Promise(resolve => { release = resolve; });
    };
    vm.runInContext(extractFunction(source, operation), box);
    const pending = box[operation]({ id: 'version', name: '测试' });
    await waitingForSave;
    box.accountGeneration++; box.state.user = { id: 'u2' };
    const nextAccount = { name: '账号B', projects: [] }; box.state.profile = nextAccount;
    release({ ok: true, data: ORIGINAL }); await pending;
    assert(box.saved[0].userId === 'u1' && box.state.profile === nextAccount && box.toasts.length === 0,
      operation + '：迟到的存档响应不覆盖新账号档案');
  }
  {
    const box = makeSandbox(JSON.parse(JSON.stringify(ORIGINAL)));
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const commit = box.window.api.resume.commitRewrites;
    box.window.api.resume.commitRewrites = async (...args) => { await gate; return commit(...args); };
    const waiting = box.__applyAgentResult({ accepted: REWRITES }, [REWRITES[0]]);
    box.accountGeneration++;
    box.state.user = { id: 'u2' };
    const secondProfile = { name: '账号B', projects: [] };
    box.state.profile = secondProfile;
    release(); await waiting;
    assert(box.saved[0].userId === 'u1', '应用请求始终绑定发起账号，不读取等待后的新账号');
    assert(box.state.profile === secondProfile && box.toasts.length === 0, '旧保存响应不覆盖新账号内存档案，也不显示成功提示');
  }
  {
    const nodes = { style: {} };
    let account = 'A', settingsReads = 0;
    const box = {
      document: { querySelectorAll: () => [], getElementById: () => ({ style: { display: 'none' } }) },
      state: {}, accountGeneration: 0, window: { api: { settings: {
        get: async () => { settingsReads++; return { ok: true, data: { mode: account === 'A' ? 'pipeline' : 'rules' } }; }
      }, agent: { status: async () => ({ ok: true, data: { available: false } }) } } },
      call, renderResumePage: () => {}, nodes
    };
    vm.createContext(box);
    vm.runInContext('let _agentStatus=null, _agentMode=null, _agentModeUserSet=false, _agentPrefsLoaded=false; const AGENT_MODES=["rules","pipeline","agentic"];' +
      extractFunction(source, 'resetAccountState') + extractFunction(source, 'restoreAgentMode') + extractFunction(source, 'refreshAgentStatus'), box);
    await box.restoreAgentMode(); box.resetAccountState(); account = 'B'; await box.restoreAgentMode();
    assert(vm.runInContext('_agentMode', box) === 'rules' && settingsReads === 2, '切换账号后重新读取并恢复 B 的规则通道偏好');
    let release;
    box.window.api.agent.status = () => new Promise(resolve => { release = resolve; });
    const waiting = box.refreshAgentStatus(); box.resetAccountState();
    release({ ok: true, data: { config: { model: '旧账号模型' } } }); await waiting;
    assert(vm.runInContext('_agentStatus', box) === null, '延迟到达的旧账号模型探测不会污染当前账号');
  }
  // ---------- 1) 核心回归：只勾选 p0-b0，其余必须逐字保留原文 ----------
  {
    const profile = JSON.parse(JSON.stringify(ORIGINAL));
    const box = makeSandbox(profile);
    const selected = [REWRITES[0]]; // 用户只勾了这一条

    await box.__applyAgentResult({ accepted: REWRITES, rejected: [] }, selected);

    assert(box.saved.length === 1, '勾选后档案被保存一次');
    const saved = box.saved[0].profile;
    const desc = saved.projects[0].description;

    assert(desc.includes('改写A'), '勾选的条目被应用（p0-b0）');
    assert(!desc.includes('改写B'), '⚠️ 未勾选的 p0-b1 不应被应用');
    assert(desc.includes('原文B'), '未勾选的行保留原文（p0-b1 → 原文B）');
    assert(saved.summary === '原简介', '未勾选的简介保留原文');
    assert(saved.internships[0].description === '实习原文', '勾选列表之外的内容不受影响');
    assert(box.saved[0].userId === 'u1', '保存时带上当前用户 id');
    assert(box.handedOver.length === 1 && box.handedOver[0].join(',') === 'p0-b0',
      '交给主进程的只有被勾选的那条（实际：' + JSON.stringify(box.handedOver) + '）');
  }

  // ---------- 2) 全部勾选：3 条都应用 ----------
  {
    const profile = JSON.parse(JSON.stringify(ORIGINAL));
    const box = makeSandbox(profile);

    await box.__applyAgentResult({ accepted: REWRITES, rejected: [] }, REWRITES.slice());

    const saved = box.saved[0].profile;
    assert(saved.projects[0].description.includes('改写A') && saved.projects[0].description.includes('改写B'),
      '全选时两条项目改写都落盘');
    assert(saved.summary === '改写简介', '全选时简介改写落盘');
  }

  // ---------- 3) 一条都没勾（UI 已拦截）：不应产生一次空保存 ----------
  {
    const profile = JSON.parse(JSON.stringify(ORIGINAL));
    const box = makeSandbox(profile);

    await box.__applyAgentResult({ accepted: REWRITES, rejected: [] }, []);

    assert(box.saved.length === 0, '空勾选列表：不做无意义的保存');
    assert(box.toasts.some((t) => /至少勾选一条/.test(t.msg)), '空勾选列表：给出提示而不是静默');
    assert(box.handedOver.length === 0, '空勾选列表：不会把改写交给主进程');
    assert(JSON.stringify(box.state.profile) === JSON.stringify(ORIGINAL), '空勾选列表：档案保持原样');
  }

  // 删除来源的候选不得保存，也不得改变界面内存档案。
  {
    const box = makeSandbox(JSON.parse(JSON.stringify(ORIGINAL)));
    const { evidence, ...candidate } = REWRITES[0];
    await box.__applyAgentResult({ accepted: [candidate], rejected: [] });
    assert(box.saved.length === 0 && JSON.stringify(box.state.profile) === JSON.stringify(ORIGINAL),
      '缺少来源的候选应用失败，档案和保存记录均不改变');
    assert(box.toasts.some((t) => t.kind === 'err' && /缺少经历来源/.test(t.msg)),
      '界面明确提示缺少经历来源，需要重新优化');
  }

  // ---------- 4) 未传勾选列表时退回全部接受项（兼容既有调用） ----------
  {
    const profile = JSON.parse(JSON.stringify(ORIGINAL));
    const box = makeSandbox(profile);

    await box.__applyAgentResult({ accepted: REWRITES, rejected: [] });

    const saved = box.saved[0].profile;
    assert(saved.projects[0].description.includes('改写A') && saved.projects[0].description.includes('改写B'),
      '不传勾选列表时退回「全部接受项」旧行为');
  }

  // ---------- 5) 不就地修改调用方对象（档案是深拷贝后再改） ----------
  {
    const profile = JSON.parse(JSON.stringify(ORIGINAL));
    const box = makeSandbox(profile);
    const before = JSON.stringify(profile);

    await box.__applyAgentResult({ accepted: REWRITES, rejected: [] }, REWRITES.slice());

    assert(JSON.stringify(profile) === before, '原 profile 对象未被就地改写（深拷贝生效）');
  }

  // 云端配置：已有密钥留空、更新密钥、无密钥校验。
  {
    const config = { provider: 'cloud', endpoint: 'https://example.test/v1', model: 'old-model', hasKey: true };
    const keep = makeConfigSandbox(config);
    keep.input('deepseek-chat').value = 'new-model';
    await keep.save();
    assert(keep.saved.length === 1 && keep.saved[0].model === 'new-model', '云端已有密钥留空，修改模型可成功保存');
    assert(!Object.hasOwn(keep.saved[0], 'apiKey'), '留空保存交由主进程保留密钥，不提交空密钥');
    assert(keep.saved[0].mode === 'pipeline', '保存配置保留用户选择的运行模式');
    const replace = makeConfigSandbox(config);
    replace.input('已保存，重填可覆盖').value = 'sk-test-replacement';
    await replace.save();
    assert(replace.saved[0].apiKey === 'sk-test-replacement', '填写新密钥时提交新值');
    const missing = makeConfigSandbox({ ...config, hasKey: false });
    missing.nodes.find((n) => n.tag === 'input' && n.attrs.name === 'apiKeySessionOnly').checked = true;
    await missing.save();
    assert(missing.saved.length === 0 && missing.toasts.some((msg) => /需填写/.test(msg)), '无新密钥也无已保存密钥时拒绝保存，即使选择仅本次使用');
    for (const mode of ['pipeline', 'agentic']) {
      const cancelled = makeConfigSandbox(config);
      vm.runInContext(extractFunction(source, 'renderAgentResult'), cancelled);
      cancelled.renderAgentResult(cancelled.el('div'), cancelled.el('div'), {
        ok: false, mode, cancelled: mode === 'pipeline', run: { status: 'CANCELLED' },
        error: '运行已取消', rounds: 1, accepted: [REWRITES[0]], rejected: [],
        auditBefore: 70, auditAfter: 80, jdBefore: 50, jdAfter: 50
      }, null, []);
      assert(cancelled.nodes.some((n) => n.tag === 'h3' && n.children.some((text) => typeof text === 'string' && text.includes('Agent 已取消'))), mode + '：取消后的结果标题如实显示已取消');
      assert(cancelled.nodes.some((n) => n.tag === 'button' && n.children.includes('应用选中的改写')), mode + '：取消后仍允许应用已完成候选');
    }
    const evidenceView = makeConfigSandbox(config);
    vm.runInContext(extractFunction(source, 'renderAgentResult'), evidenceView);
    const quote = '使用 Java 开发订单查询，服务 3 万用户';
    evidenceView.renderAgentResult(evidenceView.el('div'), evidenceView.el('div'), {
      ok: true, mode: 'pipeline', rounds: 1,
      accepted: [{ ...REWRITES[0], evidence: [{ sourceId: 'p0-b0', label: '订单项目 · 第 1 条', quote }] }], rejected: [],
      auditBefore: 70, auditAfter: 80, jdBefore: 50, jdAfter: 50
    }, null, []);
    assert(evidenceView.nodes.some((n) => n.tag === 'details' && n.attrs.class === 'rw-evidence'), '每条改写可展开来源详情');
    assert(evidenceView.nodes.some((n) => n.tag === 'summary' && n.children.includes('原始经历来源 · 1 处')), '来源标题显示真实引用条数');
    assert(evidenceView.nodes.some((n) => n.tag === 'strong' && n.children.includes('订单项目 · 第 1 条')), '来源显示可识别的经历及行号');
    assert(evidenceView.nodes.some((n) => n.tag === 'div' && n.children.includes(quote)) &&
      evidenceView.nodes.every((n) => !n.children.includes(null)), '来源展示用户原始片段且不渲染空节点');
  }

  console.log('\n渲染层应用改写自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
})().catch((e) => {
  console.error('❌ 测试异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
