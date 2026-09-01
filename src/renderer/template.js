'use strict';

(function () {
// 把结构化 resume 渲染为纸张内部 HTML（不含 <html> 外壳，用于预览）
function renderResumeInner(resume, tmpl) {
  const e = window.UI.esc;
  const b = resume.basics || {};

  const contactBits = [b.phone, b.email, b.city, b.github].filter(Boolean)
    .map((x) => '<span>' + e(x) + '</span>').join('');

  function itemsBlock(title, items) {
    if (!items || !items.length) return '';
    const rows = items.map((it) => {
      const bullets = (it.bullets || []).map((x) => '<li>' + e(x) + '</li>').join('');
      const sub = [it.role].filter(Boolean).map(e).join(' · ');
      return (
        '<div class="r-item">' +
          '<div class="r-item-head">' +
            '<span class="r-item-title">' + e(it.name) + (sub ? ' <span class="r-item-sub">/ ' + sub + '</span>' : '') + '</span>' +
            '<span class="r-item-period">' + e(it.period || '') + '</span>' +
          '</div>' +
          (it.tech ? '<div class="r-tech">技术栈：' + e(it.tech) + '</div>' : '') +
          (bullets ? '<ul class="r-bullets">' + bullets + '</ul>' : '') +
        '</div>'
      );
    }).join('');
    return '<div class="r-section"><div class="r-sec-title">' + title + '</div>' + rows + '</div>';
  }

  const eduRows = (resume.education || []).map((ed) => {
    const line2 = [ed.major, ed.degree, ed.gpa ? 'GPA ' + ed.gpa : ''].filter(Boolean).map(e).join(' · ');
    return (
      '<div class="r-item">' +
        '<div class="r-item-head">' +
          '<span class="r-item-title">' + e(ed.school) + '</span>' +
          '<span class="r-item-period">' + e(ed.period || '') + '</span>' +
        '</div>' +
        (line2 ? '<div class="r-item-sub">' + line2 + '</div>' : '') +
        (ed.courses ? '<div class="r-tech">主修：' + e(ed.courses) + '</div>' : '') +
      '</div>'
    );
  }).join('');

  const skills = (resume.skills || []).map((s) => '<span class="r-skill">' + e(s) + '</span>').join('');

  return (
    '<div class="r-name">' + e(b.name || '你的名字') + '</div>' +
    '<div class="r-contact">' + contactBits + '</div>' +
    (resume.summary ? '<div class="r-summary">' + e(resume.summary) + '</div>' : '') +
    (eduRows ? '<div class="r-section"><div class="r-sec-title">教育背景</div>' + eduRows + '</div>' : '') +
    (skills ? '<div class="r-section"><div class="r-sec-title">专业技能</div><div class="r-skills">' + skills + '</div></div>' : '') +
    itemsBlock('实习经历', resume.internships) +
    itemsBlock('项目经历', resume.projects)
  );
}

// 生成用于 PDF 导出的完整 HTML 文档（内联样式，确保离屏渲染一致）
function renderResumeDocument(resume, tmpl, cssText) {
  const inner = renderResumeInner(resume, tmpl);
  return (
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
    '<style>' + cssText + '\n' +
    'html,body{margin:0;background:#fff;}' +
    '.paper{box-shadow:none !important;margin:0 auto;}' +
    '</style></head><body>' +
    '<div class="paper tmpl-' + tmpl + '">' + inner + '</div>' +
    '</body></html>'
  );
}

window.Template = { renderResumeInner, renderResumeDocument };
})();
