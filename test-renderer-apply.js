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
  const sig = 'async function ' + name + '(';
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

// 用桩件把函数跑起来：只提供它真正依赖的全局量
function makeSandbox(profile) {
  const box = {
    console,
    state: { user: { id: 'u1' }, profile: profile, token: 't' },
    call: call,
    toast: (msg, kind) => { box.toasts.push({ msg: msg, kind: kind }); },
    toasts: [],
    renderResumePage: () => {},
    // 快照不是本测试的对象，直接成功
    saveSnapshotBeforeApply: async () => true,
    window: {
      api: {
        // 与主进程一致：切分与回填由引擎负责（渲染层只负责交上「勾了哪些」）
        resume: {
          applyRewrites: async (profile, accepted) => {
            box.handedOver.push(accepted.map((r) => r.id));
            return { ok: true, data: agentReal.applyRewritesToProfile(profile, accepted) };
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
  projects: [{ name: '订单系统', tech: 'Java', description: '原文A\n原文B' }],
  internships: [{ name: '某公司', description: '实习原文' }]
};

const REWRITES = [
  { id: 'p0-b0', text: '改写A：主导订单系统优化，P99 从 800ms 降到 120ms' },
  { id: 'p0-b1', text: '改写B：承担用户模块开发，支撑日活 3 万' },
  { id: 'summary', text: '改写简介' }
];

(async () => {
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

  console.log('\n渲染层应用改写自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
})().catch((e) => {
  console.error('❌ 测试异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
