'use strict';

(function () {
// ---------------- 作品集 / 个人主页 ----------------
// 这个字段以前叫 GitHub，但实际不是人人都有 GitHub：掘金、知乎、站酷、小红书、
// 公众号、个人网站都算「作品集」。这里按域名认平台并补上标签，导出成
// 「掘金：juejin.cn/user/xxx」而不是一行光秃秃的网址。
const PORTFOLIO_PLATFORMS = [
  [/github\.com/i, 'GitHub'],
  [/gitee\.com/i, 'Gitee'],
  [/gitlab\.com/i, 'GitLab'],
  [/juejin\.cn/i, '掘金'],
  [/zhihu\.com/i, '知乎'],
  [/zcool\.com\.cn/i, '站酷'],
  [/xiaohongshu\.com|xhslink\.com/i, '小红书'],
  [/bilibili\.com|b23\.tv/i, 'B站'],
  [/blog\.csdn\.net|csdn\.net/i, 'CSDN'],
  [/cnblogs\.com/i, '博客园'],
  [/yuque\.com/i, '语雀'],
  [/notion\.(site|so)/i, 'Notion'],
  [/douyin\.com/i, '抖音'],
  [/mp\.weixin\.qq\.com|weixin\.qq\.com/i, '公众号'],
  [/substack\.com|medium\.com/i, '博客']
];

function portfolioLabel(text) {
  for (let i = 0; i < PORTFOLIO_PLATFORMS.length; i++) {
    if (PORTFOLIO_PLATFORMS[i][0].test(text)) return PORTFOLIO_PLATFORMS[i][1];
  }
  return '作品集';
}

// 判断一段文本是不是网址/域名（用于决定要不要加平台标签）
function looksLikeLink(text) {
  if (/^https?:\/\//i.test(text)) return true;
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text);
}

// 最多展示几条：联系方式那一行本来就长，多了会挤爆排版。
// 截断时在表单提示里说明「最多展示前 3 条」，不做静默丢弃。
const PORTFOLIO_MAX = 3;

// 把用户填的内容格式化成可以放进简历的一行文本。
// - 支持多条：用空格、逗号、顿号、分号分隔
// - 网址 → 补平台标签并去掉 https:// 前缀（简历上更干净）
// - 用户自己写了标签的（「作品集：财务分析报告 3 份」）→ 尊重原标题，原样保留
// - 纯文本（没有标签也不是网址）→ 原样保留
function portfolioLine(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const pieces = text.split(/[\s、,，;；]+/).filter(Boolean);

  const parsed = pieces.map((part) => {
    // 先把协议头去掉再判断：否则「https://…」里的冒号会被当成「用户自己写的标签」
    const stripped = part.replace(/^https?:\/\//i, '');
    const isLink = looksLikeLink(stripped);
    const colon = stripped.search(/[：:]/);
    const slash = stripped.indexOf('/');
    const hasOwnLabel = colon > 0 && (slash < 0 || colon < slash);
    if (isLink && !hasOwnLabel) {
      const clean = stripped.replace(/\/+$/, '');
      return { text: portfolioLabel(clean) + '：' + clean, plain: false };
    }
    return { text: part, plain: true };
  });

  // 纯文本碎片接回去：不这样的话「作品集：财务分析报告 3 份」会被空格拆成三条
  const merged = [];
  parsed.forEach((p) => {
    const last = merged[merged.length - 1];
    if (last && last.plain && p.plain) { last.text += ' ' + p.text; return; }
    merged.push(p);
  });

  return merged.slice(0, PORTFOLIO_MAX).map((p) => p.text).join(' | ');
}

// 把结构化 resume 渲染为纸张内部 HTML（不含 <html> 外壳，用于预览）
function renderResumeInner(resume, tmpl) {
  const e = window.UI.esc;
  const b = resume.basics || {};

  const contactBits = [b.phone, b.email, b.city, portfolioLine(b.github)].filter(Boolean)
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

  // 竞赛 / 奖项 / 荣誉：原样列出（用户咋写就咋展示，不做润色）
  const awardLines = (resume.awards || []).filter(Boolean);
  const awardsBlock = awardLines.length
    ? '<div class="r-section"><div class="r-sec-title">奖项与证书</div><ul class="r-bullets">' +
      awardLines.map((a) => '<li>' + e(a) + '</li>').join('') +
      '</ul></div>'
    : '';

  return (
    // r-head 包一层：模板要做「通栏页眉」（商务的深蓝带、活力的暖色带）必须有个容器，
    // 靠负外边距顶到纸张边缘；没有它就只能给姓名/联系方式单独上色，做不出层次
    '<div class="r-head">' +
      '<div class="r-name">' + e(b.name || '你的名字') + '</div>' +
      '<div class="r-contact">' + contactBits + '</div>' +
    '</div>' +
    (resume.summary ? '<div class="r-summary">' + e(resume.summary) + '</div>' : '') +
    (eduRows ? '<div class="r-section"><div class="r-sec-title">教育背景</div>' + eduRows + '</div>' : '') +
    (skills ? '<div class="r-section"><div class="r-sec-title">专业技能</div><div class="r-skills">' + skills + '</div></div>' : '') +
    itemsBlock('实习经历', resume.internships) +
    itemsBlock('项目经历', resume.projects) +
    awardsBlock
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

window.Template = { renderResumeInner, renderResumeDocument, portfolioLine, portfolioLabel };
})();
