'use strict';

// ============================================================
//  预览弹窗「实时计数 + 可滚动」回归测试
//
//  背景（用户实机反馈）：
//    1) 同步预览里取消几项勾选后，右下角按钮仍写着「导入选中的 30 条」——
//       按钮文本创建时写死，复选框没有 change 监听。
//    2) 模态框滑动卡顿——.modal-overlay 上挂了全屏 backdrop-filter: blur()，
//       每滚动一帧整个背景都要重新模糊。
//
//  本测试直接从 src/renderer 切出真实的 showPreview 实现（不是复制逻辑），
//  在最小 DOM 存根上跑：初始计数、取消一项、全部取消、重新勾选，
//  并守护 styles.css 里不再有全屏 backdrop-filter。
// ============================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 看门狗：防止意外悬挂
setTimeout(() => {
  console.error('⏰ 看门狗超时：测试疑似悬挂，强制退出（exit 1）');
  process.exit(1);
}, 20000).unref();

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

// ---------- 按花括号配平切出指定函数 ----------
function extractFunction(source, name) {
  const sig = 'function ' + name + '(';
  const start = source.indexOf(sig);
  if (start < 0) throw new Error('未找到 ' + name + '()，重构后请同步更新本测试');
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(name + '() 花括号不配平');
}

// ---------- 最小 DOM 存根 ----------
function makeEl(tag, attrs, children) {
  const e = {
    tagName: String(tag || '').toUpperCase(),
    children: [], listeners: {},
    checked: false, value: '', disabled: false, removed: false,
    textContent: '',
    attrs: Object.assign({}, attrs || {})
  };
  if (attrs) {
    if ('type' in attrs) e.type = attrs.type;
    if ('checked' in attrs) e.checked = !!attrs.checked;
    if ('value' in attrs) e.value = attrs.value;
    if ('placeholder' in attrs) e.placeholder = attrs.placeholder;
  }
  (children || []).forEach((c) => {
    if (typeof c === 'string') e.textContent += c;
    else if (c) e.children.push(c);
  });
  e.appendChild = (c) => { e.children.push(c); return c; };
  e.remove = () => { e.removed = true; };
  e.focus = () => {};
  e.addEventListener = (type, fn) => {
    (e.listeners[type] = e.listeners[type] || []).push(fn);
  };
  e.dispatch = (type) => {
    (e.listeners[type] || []).forEach((fn) => fn({ target: e }));
  };
  return e;
}

const RECORDS = [
  { company: '甲甲公司', position: 'Java开发', place: '北京', externalId: 'a1', url: 'https://x/1' },
  { company: '乙乙公司', position: '前端开发', place: '杭州', externalId: 'b2', url: 'https://x/2' },
  { company: '丙丙科技', position: '算法工程师', place: '深圳', externalId: 'c3', url: 'https://x/3' }
];

/** 在存根上下文里加载某个文件的 showPreview，返回 { submit, boxes } */
function loadPreview(file, records, existing) {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const fnSrc = extractFunction(src, 'showPreview');
  const created = [];
  const body = { appendChild: () => {} };
  const sandbox = {
    el: (tag, attrs, children) => { const e = makeEl(tag, attrs, children); created.push(e); return e; },
    UI: { toast: () => {} },
    document: { body },
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSrc + '\n;globalThis.__sp = showPreview;', sandbox);
  // 先调用（同步执行完 Promise executor，元素全部建好），再从 created 里挑
  const promise = sandbox.__sp(records, 'BOSS直聘', 'applied', existing);
  const boxes = created.filter((e) => e.type === 'checkbox');
  const submit = created.find((e) => e.tagName === 'BUTTON' && /btn-primary/.test(String(e.attrs.class || '')));
  return { promise, boxes, submit, created };
}

// ---------- 同步预览（job-sync-view.js） ----------
try {
  const { promise, boxes, submit } = loadPreview('src/renderer/job-sync-view.js', RECORDS.map((r) => Object.assign({}, r)));
  assert(boxes.length === 3, '同步预览渲染出 3 个复选框（实得 ' + boxes.length + '）');
  assert(boxes.every((b) => b.checked), '同步预览默认全部勾选');
  assert(/导入选中的 3 条/.test(submit.textContent), '初始按钮计数为 3（实得「' + submit.textContent + '」）');
  assert(submit.disabled === false, '初始按钮可点');

  boxes[2].checked = false;
  boxes[2].dispatch('change');
  assert(/导入选中的 2 条/.test(submit.textContent), '取消 1 项后按钮实时变为 2（实得「' + submit.textContent + '」）');
  assert(submit.disabled === false, '还剩 2 项时按钮仍可点');

  boxes.forEach((b) => { b.checked = false; b.dispatch('change'); });
  assert(/导入选中的 0 条/.test(submit.textContent), '全部取消后按钮显示 0（实得「' + submit.textContent + '」）');
  assert(submit.disabled === true, '0 项时按钮禁用');

  boxes[0].checked = true;
  boxes[0].dispatch('change');
  assert(/导入选中的 1 条/.test(submit.textContent), '重新勾选 1 项后按钮显示 1（实得「' + submit.textContent + '」）');
  assert(submit.disabled === false, '重新勾选后按钮恢复可点');

  // 勾选状态必须真的影响导入结果：点提交只应带回勾选的项
  submit.dispatch('click');
  promise.then((picked) => {
    assert(Array.isArray(picked) && picked.length === 1 && picked[0].company === '甲甲公司',
      '提交只导入勾选的 1 条（实得 ' + (picked ? picked.length : 'null') + ' 条）');
  }).catch(() => { /* 由下方 await 处理 */ });
} catch (e) {
  assert(false, '同步预览加载/执行异常: ' + e.message);
}

// ---------- 粘贴导入预览（job-import.js，同一模式） ----------
try {
  const pasteRecords = RECORDS.map((r) => Object.assign({}, r, {
    notes: [], level: {}, salary: '10k', platform: 'BOSS直聘', education: '本科', experience: '3年'
  }));
  const { boxes, submit } = loadPreview('src/renderer/job-import.js', pasteRecords);
  assert(boxes.length === 3, '粘贴导入预览渲染出 3 个复选框');
  assert(/导入选中的 3 条/.test(submit.textContent), '粘贴导入初始计数为 3（实得「' + submit.textContent + '」）');
  boxes[0].checked = false;
  boxes[0].dispatch('change');
  assert(/导入选中的 2 条/.test(submit.textContent), '粘贴导入取消 1 项后实时变为 2（实得「' + submit.textContent + '」）');
} catch (e) {
  assert(false, '粘贴导入预览加载/执行异常: ' + e.message);
}

// ---------- 「已存在 · 将更新」标记（增量合并可见化） ----------
try {
  // 1) 公司 + 岗位相同（忽略标点空格）即判定为更新
  const byName = loadPreview('src/renderer/job-sync-view.js', RECORDS.map((r) => Object.assign({}, r)), [
    { id: 'app_1', company: '甲甲公司', position: 'Java开发', source: 'BOSS直聘' }
  ]);
  const dupTags = byName.created.filter((e) => /ji-tag-dup/.test(String(e.attrs.class || '')));
  assert(dupTags.length === 1 && /将更新/.test(dupTags[0].textContent),
    '公司+岗位相同的记录被打上「已存在 · 将更新」（实得 ' + dupTags.length + ' 个标记）');
  const title = byName.created.find((e) => /modal-title/.test(String(e.attrs.class || '')));
  assert(/其中 1 条将更新已有记录/.test(String(title.textContent)),
    '标题标注更新条数（实得「' + title.textContent + '」）');

  // 2) 同平台同 externalId 也判定为更新（哪怕公司岗位写法不同）
  const byId = loadPreview('src/renderer/job-sync-view.js', RECORDS.map((r) => Object.assign({}, r)), [
    { id: 'app_2', company: '完全不同的公司', position: '完全不同的岗位', externalId: 'b2', source: 'BOSS直聘' }
  ]);
  const dupTags2 = byId.created.filter((e) => /ji-tag-dup/.test(String(e.attrs.class || '')));
  assert(dupTags2.length === 1, '同平台同 externalId 同样标记为将更新（实得 ' + dupTags2.length + ' 个）');

  // 3) 别的平台的同 externalId 不算同一条（来源不同，可能是巧合撞号）
  const otherSrc = loadPreview('src/renderer/job-sync-view.js', RECORDS.map((r) => Object.assign({}, r)), [
    { id: 'app_3', company: '完全不同的公司', position: '完全不同的岗位', externalId: 'b2', source: '智联招聘' }
  ]);
  assert(otherSrc.created.filter((e) => /ji-tag-dup/.test(String(e.attrs.class || ''))).length === 0,
    '不同平台的同号 externalId 不误判为更新');
} catch (e) {
  assert(false, '「将更新」标记测试异常: ' + e.message);
}

// ---------- 卡顿修复的静态守护 ----------
const styles = fs.readFileSync(path.join(__dirname, 'src/renderer/styles.css'), 'utf8');
// 去掉注释再断言：修复注释里本身就写着 backdrop-filter 这个词
const stylesNoComment = styles.replace(/\/\*[\s\S]*?\*\//g, '');
const overlayBlock = stylesNoComment.slice(stylesNoComment.indexOf('.modal-overlay {'), stylesNoComment.indexOf('.modal-overlay {') + 300);
assert(!/backdrop-filter/.test(overlayBlock), '.modal-overlay 不再使用全屏 backdrop-filter（滚动卡顿根因）');
assert(/will-change:\s*transform/.test(stylesNoComment), '.ji-list/.js-list 滚动容器有合成层提升');

setTimeout(() => {
  console.log('预览弹窗回归完成: ' + pass + ' passed, ' + failCnt + ' failed | exitCode = ' + (process.exitCode || 0));
  process.exit(failCnt === 0 ? 0 : 1);
}, 50);
