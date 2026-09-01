'use strict';

// ============================================================
//  线性图标库（24×24, stroke 1.8, round cap/join）
//  与认证页 field-ico 同风格；全部描边路径，随 currentColor 换色。
//  渲染层各页共用：卡片标题、导入条、简历页工具栏、看板列、
//  Agent 面板、关于弹窗、模态标题。
// ============================================================

const PATHS = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  pin: '<path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  cap: '<path d="m2 9 10-5 10 5-10 5L2 9Z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/><path d="M22 9v6"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>',
  code: '<path d="m8 6-5 6 5 6"/><path d="m16 6 5 6-5 6"/><path d="m13 4-2 16"/>',
  wrench: '<path d="M14.7 6.3a4.5 4.5 0 0 0-6 5.6L3 17.6 6.4 21l5.7-5.7a4.5 4.5 0 0 0 5.6-6L14.5 12l-2.5-2.5 2.7-3.2Z"/>',
  file: '<path d="M6 2h8l5 5v15H6V2Z"/><path d="M14 2v5h5"/><path d="M9 13h6M9 17h6"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
  doc: '<path d="M6 2h8l5 5v15H6V2Z"/><path d="M14 2v5h5"/><path d="M9 12h6M9 16h6M9 8h2"/>',
  spark: '<path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2Z"/>',
  gauge: '<path d="M4 14a8 8 0 1 1 16 0"/><path d="M12 14 15.5 8.5"/><path d="M2 20h20"/>',
  target2: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.7 1 1.5 1 2.5h6c0-1 .2-1.8 1-2.5A6 6 0 0 0 12 3Z"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>',
  board: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v9M12 7v5M16 7v12"/>',
  rocket: '<path d="M12 15c-2 0-5-2-5-2s.5-7 5-11c4.5 4 5 11 5 11s-3 2-5 2Z"/><circle cx="12" cy="8" r="1.6"/><path d="M9 15c-1.5 1-2 3-2 5 2 0 4-.5 5-2M15 15c1.5 1 2 3 2 5-2 0-4-.5-5-2"/>',
  send: '<path d="m3 11 18-8-8 18-2.5-7.5L3 11Z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6v-7Z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>',
  zap: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  check: '<path d="m5 13 4 4L19 7"/>'
};

// 生成 SVG DOM 节点；name 不存在时返回 null（调用方需兜底）
function icon(name, size) {
  const d = PATHS[name];
  if (!d) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('width', size || 18);
  svg.setAttribute('height', size || 18);
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  const wrapper = document.createElement('span');
  wrapper.className = 'ico-wrap';
  wrapper.appendChild(svg);
  svg.innerHTML = d;
  return wrapper;
}

window.Icons = { icon, PATHS };
