'use strict';

// ============================================================
//  招聘平台投递记录同步（渲染层面板）
//
//  交互原则与粘贴导入一致：**先预览、可勾选、可编辑，再落库**。
//  同步本身是只读的（主进程旁路读取平台页面自己的数据响应），
//  本模块只负责把结果呈现给用户确认。
// ============================================================
(function () {
  const UI = window.UI;
  const el = UI.el;

  function fmtTime(ts) {
    if (!ts) return '从未';
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '从未';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  async function openPanel(ctx) {
    let list;
    try {
      list = await UI.call(window.api.jobSync.platforms());
    } catch (err) {
      UI.toast('读取平台列表失败：' + ((err && err.message) || err), 'err');
      return;
    }

    const overlay = el('div', { class: 'modal-overlay' });
    const body = el('div', { class: 'js-body' });
    const close = () => overlay.remove();

    async function refresh() {
      try {
        list = await UI.call(window.api.jobSync.platforms());
      } catch (_) { /* 保留上一次结果 */ }
      body.innerHTML = '';
      body.appendChild(el('p', { class: 'ji-hint' }, [
        '同步采用「只读旁路」：应用会打开一个独立窗口，由你自己的账号登录后，由平台页面自行发起请求，应用只读取它返回的数据。'
        + '不逆向签名、不伪造请求、不会向平台提交任何写操作。登录状态只保存在本机。'
      ]));
      const grid = el('div', { class: 'js-list' });
      for (const p of list) grid.appendChild(platformRow(p));
      body.appendChild(grid);
    }

    function platformRow(p) {
      const status = !p.syncable
        ? el('span', { class: 'js-tag js-tag-off' }, ['不支持同步'])
        : (p.loggedIn
          ? el('span', { class: 'js-tag js-tag-on' }, ['已登录'])
          : el('span', { class: 'js-tag' }, ['未登录']));

      const actions = [];
      if (p.syncable) {
        actions.push(el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: () => doLogin(p)
        }, [p.loggedIn ? '重新登录' : '登录']));
        actions.push(el('button', {
          class: 'btn btn-primary btn-sm', type: 'button',
          onclick: () => doSync(p, 'applied')
        }, ['同步投递记录']));
        if (p.collectUrl) {
          actions.push(el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: () => doSync(p, 'collected')
          }, ['同步收藏']));
        }
        if (p.loggedIn) {
          actions.push(el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: () => doLogout(p)
          }, ['解除登录']));
        }
      } else {
        actions.push(el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: () => window.api.shell.openExternal(p.loginUrl)
        }, ['打开官网']));
      }

      return el('div', { class: 'js-row' }, [
        el('div', { class: 'js-row-top' }, [
          el('b', {}, [p.name]),
          status,
          p.lastSyncAt ? el('span', { class: 'js-tag' }, ['上次同步 ' + fmtTime(p.lastSyncAt) + ' · ' + p.lastCount + ' 条']) : null
        ]),
        p.note ? el('div', { class: 'ji-notes' }, [el('span', {}, ['⚠ ' + p.note])]) : null,
        el('div', { class: 'js-actions' }, actions)
      ]);
    }

    async function doLogin(p) {
      try {
        const res = await UI.call(window.api.jobSync.login(p.id));
        if (!res || !res.ok) { UI.toast('打开登录窗口失败：' + ((res && res.error) || '未知原因'), 'err'); return; }
        UI.toast('请在刚打开的窗口里登录 ' + p.name + '，登录后回到这里点「同步投递记录」', 'ok');
      } catch (err) {
        UI.toast(err.message, 'err');
      }
    }

    async function doLogout(p) {
      try {
        await UI.call(window.api.jobSync.logout(p.id));
        UI.toast('已解除 ' + p.name + ' 的本机登录状态', 'ok');
        await refresh();
      } catch (err) {
        UI.toast(err.message, 'err');
      }
    }

    async function doSync(p, kind) {
      UI.toast('正在读取 ' + p.name + ' 的' + (kind === 'collected' ? '收藏' : '投递记录') + '，请勿关闭刚打开的窗口…', 'ok');
      let res;
      try {
        res = await UI.call(window.api.jobSync.pull(p.id, kind));
      } catch (err) {
        UI.toast('同步失败：' + ((err && err.message) || err), 'err');
        return;
      }
      if (!res || !res.ok) {
        const msg = (res && res.error) || '未知原因';
        UI.toast(msg, 'err');
        if (res && res.needLogin) await refresh();
        return;
      }
      const picked = await showPreview(res.items, p.name, kind);
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

    const title = el('h3', { class: 'modal-title' }, ['从招聘平台同步投递记录']);
    const foot = el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: close }, ['关闭'])
    ]);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.appendChild(el('div', { class: 'modal-box ji-box' }, [title, body, foot]));
    document.body.appendChild(overlay);
    await refresh();
  }

  /** 预览 + 勾选：同步到的记录必须先经用户确认才落库 */
  function showPreview(records, platformName, kind) {
    return new Promise((resolve) => {
      const items = (records || []).map((c, i) => {
        const box = el('input', { type: 'checkbox' });
        box.checked = true;
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
              c.externalId ? el('span', { class: 'ji-tag' }, ['有平台ID']) : null,
              c.url ? el('span', { class: 'ji-tag' }, ['含链接']) : null
            ]),
            el('div', { class: 'ji-grid' }, [
              field('公司名称', 'company'),
              field('岗位名称', 'position'),
              field('公司所在地', 'place')
            ]),
            c.notes ? el('div', { class: 'ji-notes' }, [el('span', {}, ['ℹ ' + c.notes])]) : null,
            !c.place ? el('div', { class: 'ji-notes' }, [el('span', {}, ['⚠ 平台没给地点，填上才能算距离'])]) : null
          ])
        ]);
        return { node, box, editing, raw: c };
      });

      const overlay = el('div', { class: 'modal-overlay' });
      const submit = el('button', { class: 'btn btn-primary', type: 'button' }, ['导入选中的 ' + items.length + ' 条']);
      const cancel = el('button', { class: 'btn btn-ghost', type: 'button' }, ['取消']);
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
        if (!picked.length) { UI.toast('一条都没选（公司名或岗位名至少要有一个）', 'err'); return; }
        close(picked);
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });

      overlay.appendChild(el('div', { class: 'modal-box ji-box' }, [
        el('h3', { class: 'modal-title' }, ['同步到 ' + items.length + ' 条，确认后导入']),
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
    // 供测试用
    _internal: { fmtTime }
  };
})();
