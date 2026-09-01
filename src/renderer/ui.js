'use strict';

(function () {
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] != null) {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let toastTimer = null;
  function toast(message, kind) {
    const t = document.getElementById('toast');
    t.textContent = message;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.className = 'toast ' + (kind || '');
    }, 2600);
  }

  async function call(promise) {
    const res = await promise;
    if (!res || !res.ok) {
      throw new Error((res && res.error) || '操作失败');
    }
    return res.data;
  }

  // 轻量模态表单，替代不受 Electron 支持的 window.prompt
  // fields: [{ name, label, value, placeholder }]，返回 Promise<对象|null>
  function modalForm(title, fields, submitText) {
    return new Promise((resolve) => {
      const inputs = {};
      const rows = fields.map((f) => {
        const input = el('input', {
          type: 'text', name: f.name, value: f.value || '', placeholder: f.placeholder || ''
        });
        inputs[f.name] = input;
        return el('label', { class: 'field' }, [el('span', {}, [f.label]), input]);
      });

      const overlay = el('div', { class: 'modal-overlay' });
      function close(result) {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function submit() {
        const data = {};
        Object.keys(inputs).forEach((k) => { data[k] = inputs[k].value.trim(); });
        close(data);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(null);
        else if (e.key === 'Enter') { e.preventDefault(); submit(); }
      }

      const box = el('div', { class: 'modal-box' }, [
        el('h3', { class: 'modal-title' }, [title]),
        el('div', { class: 'modal-body' }, rows),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => close(null) }, ['取消']),
          el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: submit }, [submitText || '确定'])
        ])
      ]);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
      document.addEventListener('keydown', onKey);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      const first = inputs[fields[0].name];
      if (first) first.focus();
    });
  }

  // 多行文本模态：用于粘贴 JD 等长文本，返回 Promise<string|null>
  function modalTextarea(title, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      const textarea = el('textarea', {
        rows: String(o.rows || 9),
        placeholder: o.placeholder || '',
        style: 'min-height:180px;'
      }, [o.value || '']);

      const overlay = el('div', { class: 'modal-overlay' });
      function close(result) {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function submit() {
        const v = textarea.value.trim();
        close(v || null);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(null);
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
      }

      const box = el('div', { class: 'modal-box modal-box-wide' }, [
        el('h3', { class: 'modal-title' }, [title]),
        el('div', { class: 'modal-body' }, [
          el('label', { class: 'field' }, [
            el('span', {}, [o.label || '']),
            textarea
          ])
        ]),
        el('div', { class: 'modal-actions' }, [
          el('span', { class: 'hint', style: 'font-size:11.5px;' }, ['Ctrl + Enter 提交']),
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => close(null) }, ['取消']),
          el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: submit }, [o.submitText || '确定'])
        ])
      ]);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
      document.addEventListener('keydown', onKey);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      textarea.focus();
    });
  }

  window.UI = { el, esc, toast, call, modalForm, modalTextarea };
})();
