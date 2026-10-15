'use strict';

// ============================================================
//  招聘平台投递记录同步（渲染层面板）
//
//  交互模型（与旧版的关键差别）：
//    旧版：点「同步」→ 应用自动打开一个硬编码的「投递记录」深链接 → 抓完。
//          但实测该深链接在多个平台已 404 / 被重定向，用户只看到空白窗口。
//    新版：点「打开同步窗口」→ 只加载平台首页 → 用户在窗口里登录并自己点到
//          「投递记录」页 → 回到应用点「抓取已打开的页面」。
//          窗口存活期间，平台页面发出的数据请求被持续累积，因此不依赖任何
//          会失效的深链接。
//
//  落库仍然遵守项目的共同约定：**先预览、可勾选、可编辑，再写入**。
// ============================================================
(function () {
  const UI = window.UI;
  const el = UI.el;

  const PAGE_STATE_TEXT = {
    notfound: '停在「页面不存在」上',
    captcha: '停在人机验证页（请在窗口里拖动滑块通过）',
    blank: '页面内容为空'
  };

  function fmtTime(ts) {
    if (!ts) return '从未';
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '从未';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  async function openPanel(ctx) {
    const overlay = el('div', { class: 'modal-overlay' });
    const body = el('div', { class: 'js-body' });
    const close = () => { overlay.remove(); if (unsubProgress) unsubProgress(); };
    let list = [];
    // 运行版本号：出错时直接摆给用户看，省得「我以为我是新版」这类排查成本
    let appVersion = '';
    try {
      const st = await window.api.updater.status();
      appVersion = (st && st.version) || '';
    } catch (_) { /* 取不到版本不影响面板 */ }

    // 抓取进度行：自动抓取动辄几十秒到两分钟，没有它就是「按钮一直转圈，
    // 完全不知道卡在打开页面 / 等登录 / 还是找入口」。
    const progressLine = el('div', { class: 'js-progress', style: 'display:none' }, []);
    let unsubProgress = null;
    try {
      if (window.api.jobSync && typeof window.api.jobSync.onProgress === 'function') {
        unsubProgress = window.api.jobSync.onProgress((p) => {
          if (!p || !p.note) { progressLine.style.display = 'none'; return; }
          progressLine.style.display = '';
          progressLine.textContent = '⏳ ' + p.note
            + (p.captured ? '（已捕获 ' + p.captured + ' 个数据响应）' : '');
        });
      }
    } catch (_) { /* 旧 preload 没有这个通道也不影响抓取本身 */ }

    // 抓取期间禁用面板内所有按钮：手动模式下连点会并发跑两个 autoCollect，
    // 共享同一个会话缓冲，结果不可预期（曾经的隐患）。
    let busy = false;
    const setBusy = (v) => {
      busy = v;
      overlay.querySelectorAll('button').forEach((b) => { b.disabled = v; });
    };

    async function refresh() {
      let errText = '';
      try {
        list = await readPlatforms();
      } catch (err) {
        errText = (err && err.message) || String(err);
      }
      body.innerHTML = '';
      // 失败绝不留一个空壳：把原因、当前版本和重试入口直接写进面板。
      // （旧实现在这里只弹一个 2.6 秒后自动消失的 toast，用户看到的是「无缘无故的空白」。）
      if (errText) { body.appendChild(errorBox(errText)); return; }
      body.appendChild(el('p', { class: 'ji-hint' }, [
        '点击「抓取投递记录 / 抓取收藏」后会自动打开对应平台页面并读取数据，全程后台完成；'
        + '需要登录时才会把登录窗口交给你。平台页面自己发出的数据请求会被读取下来。不逆向签名、不伪造请求、不向平台提交任何写操作，登录状态只保存在本机。'
      ]));
      const grid = el('div', { class: 'js-list' });
      for (const p of list) grid.appendChild(platformRow(p));
      body.appendChild(grid);
    }

    /** 读平台列表；把「接口缺失（新旧版本不一致）」与「业务报错」区分开，便于用户自查 */
    async function readPlatforms() {
      if (!window.api || !window.api.jobSync || typeof window.api.jobSync.platforms !== 'function') {
        throw new Error('当前应用没有「招聘平台同步」接口。正在运行的主进程仍是旧版本'
          + '（或改动后没有重新编译就启动了），请更新到最新版并重启应用。');
      }
      const out = await UI.call(window.api.jobSync.platforms());
      if (!Array.isArray(out)) throw new Error('平台列表返回格式异常：' + JSON.stringify(out).slice(0, 120));
      return out;
    }

    /** 失败态：原因 + 运行版本 + 排查步骤 + 重试，全部留在面板里 */
    function errorBox(msg) {
      const looksLikeOldBuild = /no handler registered|不是.*函数|没有「招聘平台同步」|undefined/i.test(msg);
      const box = el('div', { class: 'js-error' }, [
        el('p', {}, [el('b', {}, ['无法读取平台列表'])]),
        el('p', { class: 'js-notes' }, [el('span', {}, ['⚠ ' + msg])]),
        el('p', { class: 'ji-hint' }, ['当前运行版本：' + (appVersion || '未知') + '。']),
        el('p', { class: 'ji-hint' }, [
          looksLikeOldBuild
            ? '这通常说明应用还是旧版本：请在侧栏底部核对版本号，更新到最新版后重启。'
            : '排查顺序：① 重启应用重试；② 到「设置 → 检查更新」升级到最新版；③ 仍失败请把上面这行错误反馈给我。'
        ]),
        el('div', { class: 'js-actions' }, [
          el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => refresh() }, ['重试'])
        ])
      ]);
      return box;
    }

    function platformRow(p) {
      const stateTag = !p.syncable
        ? el('span', { class: 'js-tag js-tag-off' }, ['不支持同步'])
        : (p.open
          ? el('span', { class: 'js-tag js-tag-on' }, ['窗口已打开 · 已捕获 ' + p.captured + ' 个响应'])
          : el('span', { class: 'js-tag' }, ['未打开']));

      const loginTag = p.loggedIn
        ? el('span', { class: 'js-tag js-tag-on' }, ['已登录'])
        : el('span', { class: 'js-tag' }, ['未登录']);

      const actions = [];
      if (p.syncable) {
        actions.push(el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: () => doOpen(p)
        }, [p.open ? '显示同步窗口' : '打开同步窗口']));
        actions.push(el('button', {
          class: 'btn btn-primary btn-sm', type: 'button',
          onclick: () => doCollect(p, 'applied')
        }, ['抓取投递记录']));
        actions.push(el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: () => doCollect(p, 'collected')
        }, ['抓取收藏']));
        if (p.open) {
          actions.push(el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: () => doReset(p)
          }, ['清空已捕获']));
          actions.push(el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: () => doClose(p)
          }, ['关闭窗口']));
        }
        if (p.cookieCount > 0) {
          actions.push(el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: () => doLogout(p)
          }, ['解除登录']));
        }
      } else {
        actions.push(el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: () => window.api.shell.openExternal(p.entryUrl)
        }, ['打开官网']));
      }

      return el('div', { class: 'js-row' }, [
        el('div', { class: 'js-row-top' }, [
          el('b', {}, [p.name]),
          stateTag,
          loginTag,
          p.lastSyncAt ? el('span', { class: 'js-tag' }, ['上次导入 ' + fmtTime(p.lastSyncAt) + ' · ' + p.lastCount + ' 条']) : null
        ]),
        p.recordHint ? el('div', { class: 'ji-notes js-hint-text' }, [el('span', {}, ['操作指引：' + p.recordHint])]) : null,
        p.statusNote ? el('div', { class: 'ji-notes js-hint-text' }, [el('span', {}, ['⏳ ' + p.statusNote])]) : null,
        p.note ? el('div', { class: 'ji-notes' }, [el('span', {}, ['⚠ ' + p.note])]) : null,
        p.error ? el('div', { class: 'ji-notes' }, [el('span', {}, ['⚠ ' + p.error])]) : null,
        p.pageState ? el('div', { class: 'ji-notes' }, [el('span', {}, ['⚠ 同步窗口' + (PAGE_STATE_TEXT[p.pageState] || '状态异常') + (p.pageTitle ? '：' + p.pageTitle.slice(0, 40) : '')])]) : null,
        el('div', { class: 'js-actions' }, actions)
      ]);
    }

    async function doOpen(p) {
      try {
        const res = await UI.call(window.api.jobSync.open(p.id));
        if (!res || !res.ok) {
          UI.toast('打开同步窗口：' + ((res && res.error) || '未知原因'), 'err');
        } else {
          UI.toast('已打开 ' + p.name + ' 首页。请在窗口里登录并点进「' + (p.recordHint || '投递记录') + '」，然后回来点抓取。', 'ok');
        }
        await refresh();
      } catch (err) { UI.toast(err.message, 'err'); }
    }

    async function doClose(p) {
      try { await UI.call(window.api.jobSync.close(p.id)); await refresh(); } catch (err) { UI.toast(err.message, 'err'); }
    }

    async function doReset(p) {
      try {
        await UI.call(window.api.jobSync.reset(p.id));
        UI.toast('已清空 ' + p.name + ' 的已捕获数据', 'ok');
        await refresh();
      } catch (err) { UI.toast(err.message, 'err'); }
    }

    async function doLogout(p) {
      try {
        await UI.call(window.api.jobSync.logout(p.id));
        UI.toast('已解除 ' + p.name + ' 的本机登录状态', 'ok');
        await refresh();
      } catch (err) { UI.toast(err.message, 'err'); }
    }

    async function doCollect(p, kind) {
      if (busy) return; // 抓取中忽略连点：并发两个 autoCollect 会共享会话缓冲，结果不可预期
      let res;
      UI.toast('正在自动抓取 ' + p.name + (kind === 'collected' ? '收藏' : '投递记录') + '，请稍候…', 'ok');
      setBusy(true);
      try {
        // auto=true：自动打开平台页面并走到「投递记录 / 收藏」页抓取，无需手动调出界面
        res = await UI.call(window.api.jobSync.collect(p.id, kind, true));
      } catch (err) {
        UI.toast('抓取失败：' + ((err && err.message) || err), 'err');
        progressLine.style.display = 'none';
        setBusy(false);
        return;
      }
      if (!res || !res.ok) {
        const msg = (res && res.error) || '未识别到记录';
        if (res && res.needLogin) {
          UI.toast(msg + '（登录后会自动继续，无需再点一次）', 'err', 8000);
        } else {
          UI.toast(msg, 'err', 8000);
        }
        progressLine.style.display = 'none';
        setBusy(false);
        await refresh();
        return;
      }
      // 拉已有记录：预览里直接标出哪些「已存在 → 将更新」，合并行为不再靠猜
      let existing = [];
      try {
        existing = (await UI.call(window.api.applications.list(ctx.userId))) || [];
      } catch (_) { /* 拉不到就不标记，不影响导入 */ }
      const picked = await showPreview(res.items, p.name, kind, existing);
      progressLine.style.display = 'none';
      setBusy(false);
      if (!picked || !picked.length) { await refresh(); return; }
      try {
        const stat = await UI.call(window.api.applications.importAuthorized(ctx.userId, {
          source: p.name, items: picked
        }));
        UI.toast('同步导入完成：新增 ' + stat.added + ' 条 / 更新 ' + stat.updated + ' 条'
          + (stat.skipped ? ' / 跳过 ' + stat.skipped + ' 条' : ''), 'ok');
        if (ctx.onChanged) await ctx.onChanged();
      } catch (err) {
        UI.toast('写入投递记录失败：' + ((err && err.message) || err), 'err');
      }
      await refresh();
    }

    const foot = el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: close }, ['关闭'])
    ]);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.appendChild(el('div', { class: 'modal-box ji-box' }, [
      el('h3', { class: 'modal-title' }, ['从招聘平台同步投递记录']),
      progressLine,
      body,
      foot
    ]));
    document.body.appendChild(overlay);
    await refresh();
  }

  /** 预览 + 勾选：同步到的记录必须先经用户确认才落库 */
  function showPreview(records, platformName, kind, existing) {
    return new Promise((resolve) => {
      // 与主进程 importAuthorized 一致的合并判定：同平台同 externalId，
      // 或公司名 + 岗位名相同（忽略空格与标点）→ 这条会更新已有记录而不是新增
      const norm = (v) => String(v || '').toLowerCase().replace(/[\s·•，,。.!！？:：()（）\[\]【】_-]+/g, '');
      const existingList = Array.isArray(existing) ? existing : [];
      const matchExisting = (c) => existingList.find((a) =>
        (c.externalId && a.externalId && a.externalId === c.externalId && a.source === platformName) ||
        (norm(a.company) === norm(c.company) && norm(a.position) === norm(c.position)));
      const items = (records || []).map((c, i) => {
        const box = el('input', { type: 'checkbox' });
        box.checked = true;
        const hit = matchExisting(c);
        const editing = {};
        const field = (label, key) => {
          const input = el('input', { class: 'ji-input', value: c[key] || '', placeholder: label });
          editing[key] = input;
          return el('label', { class: 'ji-field' }, [
            el('span', { class: 'ji-label' }, [label]),
            input
          ]);
        };
        const node = el('div', { class: 'ji-row' }, [
          el('label', { class: 'ji-check' }, [box]),
          el('div', { class: 'ji-body' }, [
            el('div', { class: 'ji-top' }, [
              el('b', {}, ['#' + (i + 1)]),
              el('span', { class: 'ji-platform' }, [platformName]),
              el('span', { class: 'ji-tag' }, [kind === 'collected' ? '收藏' : '已投递']),
              hit ? el('span', { class: 'ji-tag ji-tag-dup' }, ['已存在 · 将更新']) : null,
              c.externalId ? el('span', { class: 'ji-tag' }, ['有平台ID']) : null,
              c.url ? el('span', { class: 'ji-tag' }, ['含链接']) : null
            ]),
            el('div', { class: 'ji-grid' }, [
              field('公司名称', 'company'),
              field('岗位名称', 'position'),
              field('公司所在地', 'place')
            ]),
            c.notes ? el('div', { class: 'ji-notes js-hint-text' }, [el('span', {}, ['ℹ ' + c.notes])]) : null,
            !c.place ? el('div', { class: 'ji-notes' }, [el('span', {}, ['⚠ 平台没给地点，填上才能算距离'])]) : null
          ])
        ]);
        return { node, box, editing, raw: c, hit };
      });

      const overlay = el('div', { class: 'modal-overlay' });
      const submit = el('button', { class: 'btn btn-primary', type: 'button' }, ['导入选中的 ' + items.length + ' 条']);
      const cancel = el('button', { class: 'btn btn-ghost', type: 'button' }, ['取消']);
      // 勾选状态必须实时反映到按钮上：以前按钮文本创建时写死，用户取消几项后
      // 右下角还显示着总数，根本不敢点。change 一响就重算，0 条时禁用。
      const refreshSubmit = () => {
        const n = items.filter((x) => x.box.checked).length;
        submit.textContent = '导入选中的 ' + n + ' 条';
        submit.disabled = n === 0;
      };
      items.forEach((x) => x.box.addEventListener('change', refreshSubmit));
      refreshSubmit();
      const close = (v) => { overlay.remove(); resolve(v); };
      cancel.addEventListener('click', () => close(null));
      submit.addEventListener('click', () => {
        const picked = items.filter((x) => x.box.checked).map((x) => ({
          company: x.editing.company.value.trim(),
          position: x.editing.position.value.trim(),
          place: x.editing.place.value.trim(),
          url: x.raw.url,
          externalId: x.raw.externalId,
          stage: x.raw.stage,
          notes: x.raw.notes
        })).filter((x) => x.company || x.position);
        if (!picked.length) { UI.toast('勾选的记录都还没有公司名或岗位名，补上再导入', 'err'); return; }
        close(picked);
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });

      overlay.appendChild(el('div', { class: 'modal-box ji-box' }, [
        el('h3', { class: 'modal-title' }, [
          '同步到 ' + items.length + ' 条，确认后导入'
          + (() => {
            const dup = items.filter((x) => x.hit).length;
            return dup ? '（其中 ' + dup + ' 条将更新已有记录）' : '';
          })()
        ]),
        el('p', { class: 'ji-hint' }, [
          '这些记录来自 ' + platformName + ' 你自己的账号。内容可直接修改；同平台同 ID、或公司+岗位相同的记录会自动合并更新，不会重复。'
        ]),
        el('div', { class: 'ji-list' }, items.map((x) => x.node)),
        el('div', { class: 'modal-actions' }, [cancel, submit])
      ]));
      document.body.appendChild(overlay);
      submit.focus();
    });
  }

  window.JobSync = {
    openPanel,
    // 供测试用：showPreview 暴露出来，让真实应用里的 CDP 诊断能直接驱动
    // 预览模态（window.api 是 contextBridge 只读对象，页面里没法 stub collect）
    _internal: { fmtTime, PAGE_STATE_TEXT, showPreview }
  };
})();
