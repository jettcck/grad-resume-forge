'use strict';

// ============================================================
//  旧简历导入器（TypeScript 版）
//  流程：pdfjs-dist 抽取 PDF 文本行（纯本地，无网络）
//        → 按中文简历常见分节标题切分段落
//        → 手机/邮箱/GitHub 用正则，学校/城市用本地词表反查
//        → 产出与 blankProfile 同构的档案片段，交由渲染层预览确认
// ============================================================

import fs from 'fs';
import path from 'path';
import type { Profile, EducationEntry, ExperienceEntry } from './types';

type ParsedProfile = Partial<Omit<Profile, 'education' | 'internships' | 'projects'>> & {
  education: EducationEntry[];
  internships: ExperienceEntry[];
  projects: ExperienceEntry[];
  notes: string[];
};

interface RefData { schools: string[]; citySet: Set<string> }

// ---------- 字符归一化（中文 PDF 的常见坑）----------
// PDF 内嵌中文字体常把字形映射到「康熙部首」(U+2F00–U+2FD5) 或「CJK 部首补充」(U+2E80–U+2EF3)
// 码位：它们长得和正文汉字一模一样，但不是同一个字符。实测一份真实简历里
// 「北京语言大学」被抽成「北京语⾔⼤学」、「项目经历」被抽成「项⽬经历」，
// 于是学校词表反查、分节标题匹配全线失配 —— 用户看到的就是「明明有内容却识别不出来」。
// 这几段（含 CJK 兼容汉字 U+F900–U+FAFF）都有 NFKC 兼容分解，逐字归一化即可。
// 之所以逐字而不是整串 NFKC：整串 NFKC 会把中文全角标点也改掉（「，」→「,」），
// 那会动到用户正文的观感，没必要。
const RADICAL_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const ranges: ReadonlyArray<readonly [number, number]> = [
    [0x2e80, 0x2ef3],
    [0x2f00, 0x2fd5],
    [0xf900, 0xfaff]
  ];
  ranges.forEach(([start, end]) => {
    for (let cp = start; cp <= end; cp++) {
      const ch = String.fromCodePoint(cp);
      const norm = ch.normalize('NFKC');
      if (norm !== ch && norm.length === 1) map[ch] = norm;
    }
  });
  return map;
})();
const RADICAL_RE = /[\u2E80-\u2EF3\u2F00-\u2FD5\uF900-\uFAFF]/g;
// 图标字体（FontAwesome / MarVoSym 等）在 PDF 里是私用区码位，抽出来就是乱码字符：
// 实测一份北航简历的分节标题是「U+F19D + 空格 + 教育背景」，装饰符白名单认不出 U+F19D，
// 于是「教育背景」整行匹配失败 → 教育/项目/实习全部落回页眉，导入结果是空的。
// 私用区在正文里没有标准含义，直接删掉最省事，也顺带清掉了正文里的乱码图标。
const PUA_RE = /[\uE000-\uF8FF\uFFFD]|[\u{F0000}-\u{FFFFD}]|[\u{100000}-\u{10FFFD}]/gu;

export function normalizeExtractedText(s: string): string {
  if (!s) return s;
  return s
    .replace(PUA_RE, '')
    .replace(RADICAL_RE, (c) => RADICAL_MAP[c] || c)
    // 全角数字与字母 → 半角：中文简历里「２０２２」「Ｊａｖａ」很常见，
    // 不转的话手机号/年份/技术栈的正则全部匹配不上。
    // 只转 [０-９Ａ-Ｚａ-ｚ]，不碰全角标点（「，。」转半角会破坏中文排版）。
    .replace(/[\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/g,
      (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    // 全角联系方式符号：＠．－／ 在「ｌｉｓｉ＠ｅｘａｍｐｌｅ．ｃｏｍ」里必须一起转，
    // 否则邮箱/网址正则匹配不上。
    // 刻意不转全角冒号「：」——它在中文正文里高频（姓名：张三），
    // 转成半角会让界面上的标点风格不统一，而邮箱格式本来就用不到冒号。
    .replace(/[\uff20\uff0e\uff0d\uff0f]/g,
      (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    // 全角空格归一化（有些 PDF 用 U+3000 做缩进）
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]{2,}/g, ' ');
}

/**
 * 剔除页眉页脚噪声：多页简历每页都会带「第 1 页 / 共 2 页」「Page 1 of 2」「- 1 -」「1/2」。
 * 混进来会破坏分节判定（被当成一条经历），对用户也毫无价值。
 *
 * 只匹配「整行就是页码」的形态，避免误删「专业排名 1/2」这类正文。
 */
export function stripPageNoise(lines: string[]): string[] {
  // 中文页码有几种写法：「第 1 页」「第 1 页 共 2 页」「第 1 页 / 共 2 页」，
  // 尾部那段要把「/ 共 2 页」整体当作可选，否则「/ 共」会被漏掉（第一版就漏在这）。
  const PAGE_NOISE_RE = /^(?:第\s*\d+\s*页(?:\s*[/／]?\s*共?\s*\d+\s*页)?|page\s*\d+\s*(?:of\s*\d+)?|[-–—]\s*\d+\s*[-–—]|\d+\s*[/／]\s*\d+)$/i;
  return lines.filter((s) => !PAGE_NOISE_RE.test(s));
}

// ---------- PDF 文本抽取 ----------
type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let _pdfjsPromise: Promise<PdfjsModule> | null = null;

// pdfjs-dist v4 只发布 ESM（pdf.mjs）。tsconfig 是 module=commonjs，tsc 会把源码里的
// import() 直接降级成 require()，而 Electron 33 内置的 Node 20.18 不支持 require(.mjs)：
// 打包后一导入 PDF 就抛「require() of ES Module ... not supported」。
// 更阴的是开发机上 Node 24 支持 require(ESM)，所以本地测试永远绿 —— 必须用真动态 import。
// 用 Function 构造是为了让 tsc 看不到 import() 字面量，从而原样保留。
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<PdfjsModule>;

async function getPdfjs(): Promise<PdfjsModule> {
  if (!_pdfjsPromise) {
    _pdfjsPromise = dynamicImport('pdfjs-dist/legacy/build/pdf.mjs').catch((err: unknown) => {
      _pdfjsPromise = null; // 失败不缓存，用户重试还能再试一次
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error('PDF 解析组件加载失败：' + msg + '（这是应用自身的问题，麻烦把这个信息反馈给开发者）');
    });
  }
  return _pdfjsPromise;
}

// 返回 { text, lines, pages }
/**
 * 把 pdfjs 的文本项按「视觉行」聚合，而不是依赖 hasEOL。
 *
 * 为什么不用 hasEOL：它来自 PDF 内容流的换行标记，双栏 / 表格 / 分块排版的简历里
 * 完全不可靠——左右栏的文本项会按内容流顺序交错，拼出来是「张三 138xxxx 教育背景」
 * 这种串行结果。按 y 坐标聚行、行内按 x 排序，才和肉眼看到的行一致。
 *
 * 坐标来自 textItem.transform：[a, b, c, d, x, y]。
 * 同一行的 y 会有亚像素差异（字号不同、基线偏移），所以用容差归并。
 */
export interface PdfGlyph { x: number; y: number; w: number; str: string }

/** 从 pdfjs 的 textContent.items 抽出带坐标的字形项 */
export function extractGlyphs(items: Array<{
  str?: unknown; width?: number; height?: number;
  transform?: number[]; hasEOL?: boolean;
}>): PdfGlyph[] {
  const glyphs: PdfGlyph[] = [];
  for (const it of items) {
    if (typeof it.str !== 'string' || !it.str) continue;
    const tr = it.transform;
    if (!Array.isArray(tr) || tr.length < 6) continue;
    glyphs.push({
      x: tr[4],
      y: tr[5],
      w: typeof it.width === 'number' ? it.width : 0,
      str: it.str
    });
  }
  return glyphs;
}

/**
 * 检测双栏排版的中缝位置。
 *
 * 原理：把页面宽度切成 2px 的格子，标记「哪些横向区间有字形」，然后在页面中部
 * （30%–70%）找最长的连续空白。双栏简历中间必有一条贯穿的空白带；
 * 单栏正文会横跨整个宽度，中部不会有长空白，所以不会误判。
 *
 * 阈值取 max(24px, 页宽 3%)：太松会把「段落之间的大边距」当成栏缝，
 * 太紧会漏掉栏间距较窄的模板。
 *
 * @returns 中缝中心 x 坐标；不是双栏则返回 null
 */
export function detectColumnGutter(glyphs: PdfGlyph[], pageWidth: number): number | null {
  if (!glyphs.length || !(pageWidth > 0)) return null;

  // 关键：按「垂直空白覆盖率」判，而不是「中部 x 区间有没有字形」。
  //
  // 原因：顶部姓名/联系方式常常是通栏的，它们横跨中部，
  // 用「是否有字形」判会把整页误判成单栏（实测侧边栏简历就栽在这）。
  // 改成统计「每个 x 区间被多少行占用」——中缝只在顶部几行被占用，
  // 覆盖率很低；单栏正文的中部几乎每行都有字，覆盖率接近 1。
  const rows = groupGlyphsByRow(glyphs);
  const rowCount = rows.length || 1;

  const BIN = 2;
  const binCount = Math.ceil(pageWidth / BIN);
  const coverage = new Array<number>(binCount).fill(0);
  for (const row of rows) {
    // 同一行的多个字形可能覆盖同一 bin，用 Set 去重，否则一行会被重复计数
    const touched = new Set<number>();
    for (const g of row.parts) {
      const from = Math.max(0, Math.floor(g.x / BIN));
      const to = Math.min(binCount - 1, Math.ceil((g.x + g.w) / BIN));
      for (let i = from; i <= to; i++) touched.add(i);
    }
    for (const i of touched) coverage[i]++;
  }

  // 覆盖率 ≤ 25% 的 x 区间算「基本空白」。设成 25% 是为了容忍顶部通栏
  // （侧边栏样本 16 行、顶部 2 行通栏 → 中缝覆盖率 12.5%，仍能检出）。
  const isBlank = (i: number): boolean => coverage[i] / rowCount <= 0.25;

  // 搜索区间不能用「页宽的 30%–70%」：
  // 简历正文往往只占页宽的一半（文字短、右边留白），右侧大块空白也是「覆盖率 0」，
  // 会被当成中缝——实测侧边栏样本就检出了 x=367 的假中缝（真栏缝在 180 附近）。
  // 所以用「内容实际 x 跨度」算区间：在中点 ±25% 范围内找。
  let minX = Infinity, maxX = -Infinity;
  for (const g of glyphs) {
    if (g.x < minX) minX = g.x;
    if (g.x + g.w > maxX) maxX = g.x + g.w;
  }
  const contentSpan = maxX > minX ? maxX - minX : 0;
  if (contentSpan <= 0) return null;
  const lo = Math.floor((minX + contentSpan * 0.25) / BIN);
  const hi = Math.ceil((minX + contentSpan * 0.75) / BIN);
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  for (let i = lo; i < hi; i++) {
    if (isBlank(i)) {
      if (curStart < 0) curStart = i;
      const len = i - curStart + 1;
      if (len > bestLen) { bestLen = len; bestStart = curStart; }
    } else {
      curStart = -1;
    }
  }
  if (bestStart < 0) return null;
  const gutterPx = bestLen * BIN;
  // 阈值按内容跨度算：太松会把段落间的大边距当栏缝，太紧会漏掉栏间距窄的模板
  if (gutterPx < Math.max(24, contentSpan * 0.04)) return null;
  const candidate = bestStart * BIN + gutterPx / 2;

  // 还要确认两侧都有「实质性内容」，否则那是「正文 + 右侧日期列」不是分栏。
  // 实测：ATS 简历的右侧日期列只占 9% 文字量，按它分栏会把日期和正文拆散；
  // 真双栏是 40%，侧边栏模板是 60%。用 25% 作分界。
  let totalChars = 0;
  let rightChars = 0;
  for (const g of glyphs) {
    totalChars += g.str.length;
    if (g.x >= candidate) rightChars += g.str.length;
  }
  if (!totalChars) return null;
  const rightRatio = rightChars / totalChars;
  if (Math.min(rightRatio, 1 - rightRatio) < 0.25) return null;

  return candidate;
}

/** 把字形项按视觉行聚成文本行（调用方先决定给哪些 glyphs） */
export interface PdfRow { y: number; parts: PdfGlyph[]; tol: number }

/** 行容差：取常见字号的 60%，夹在 2–6pt（太小会把上下行粘一起，太大会把同一行拆开） */
function rowTolerance(glyphs: PdfGlyph[]): number {
  const widths = glyphs.map((g) => g.w > 0 && g.str.length > 0 ? g.w / g.str.length : 0).filter((v) => v > 0);
  const avgGlyphW = widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : 8;
  return Math.min(6, Math.max(2, avgGlyphW * 0.6));
}

/** 按视觉行分组（y 降序 = 从上到下，行内按 x 升序） */
export function groupGlyphsByRow(glyphs: PdfGlyph[]): PdfRow[] {
  if (!glyphs.length) return [];
  const tol = rowTolerance(glyphs);
  const sorted = glyphs.slice().sort((a, b) => (Math.abs(a.y - b.y) <= tol ? a.x - b.x : b.y - a.y));
  const rows: PdfRow[] = [];
  for (const g of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - g.y) <= tol) row.parts.push(g);
    else rows.push({ y: g.y, parts: [g], tol });
  }
  return rows;
}

/** 一行字形拼成文本：片段间有明显水平间隙才补空格，避免「张三13800000000」粘成一片 */
export function rowToText(row: PdfRow): string {
  const parts = row.parts.slice().sort((a, b) => a.x - b.x);
  const tol = row.tol || 3;
  let out = '';
  let prevEnd = -1;
  for (const p of parts) {
    if (prevEnd >= 0 && p.x - prevEnd > tol) out += ' ';
    out += p.str;
    prevEnd = p.x + p.w;
  }
  return normalizeExtractedText(out).trim();
}

export function glyphsToLines(glyphs: PdfGlyph[]): string[] {
  return groupGlyphsByRow(glyphs).map(rowToText).filter(Boolean);
}

/** 一行在横向上的跨度（用于判断是不是「通栏」） */
function rowSpan(row: PdfRow): number {
  let min = Infinity, max = -Infinity;
  for (const g of row.parts) {
    if (g.x < min) min = g.x;
    const right = g.x + g.w;
    if (right > max) max = right;
  }
  return max > min ? max - min : 0;
}

/**
 * 把跨越中缝的字形按字符切开（pdfjs 的一个 item 可能是一整行文字）。
 * 切点优先落在空格处：中文技术栈那种「Java 北京大学」混排，按空格切才不会把词劈开。
 */
function splitGlyphAt(g: PdfGlyph, gutter: number): { left?: PdfGlyph; right?: PdfGlyph } {
  if (g.x >= gutter) return { right: g };
  if (g.x + g.w <= gutter) return { left: g };
  const charW = g.w / Math.max(1, g.str.length);
  let idx = Math.round((gutter - g.x) / charW);
  idx = Math.max(1, Math.min(g.str.length - 1, idx));

  // 只在「切点附近 ±1 字符」恰好在空格时才拆。
  // 放宽到 ±4 会把联系方式这类横跨整行的句子从词中间劈开
  // （实测：「13700000000 · wangw」/「u@example.com · 北京 · …」被切成两行，还被侧边栏内容隔开）。
  // 找不到合适切点就整行归左，宁可少拆也不要破坏一句话的完整性。
  let cut = -1;
  for (const d of [0, 1, -1]) {
    const i = idx + d;
    if (i > 0 && i < g.str.length) {
      if (g.str[i] === ' ') { cut = i + 1; break; }
      if (g.str[i - 1] === ' ') { cut = i; break; }
    }
  }
  if (cut <= 0 || cut >= g.str.length) return { left: g };
  return {
    left: { x: g.x, y: g.y, w: charW * cut, str: g.str.slice(0, cut) },
    right: { x: g.x + charW * cut, y: g.y, w: g.w - charW * cut, str: g.str.slice(cut) }
  };
}

/**
 * 整页排版解析：先判中缝，再按「通栏 / 左栏 / 右栏」逐行归位。
 *
 * 为什么不能整页直接检中缝：**顶部姓名与联系方式常常是通栏的**，
 * 它们横跨中缝所在的中部 x 区间，会让「中部没有空白」成立，于是检不出分栏，
 * 退化成左右栏按 y 串行（「专业技能 教育背景」「Java 北京大学 软件工程 本科」）。
 *
 * 所以先按行分组，用「不是通栏的行」去做中缝检测，再逐行归类：
 *   - 通栏行（跨中缝且跨度够大）→ 先冲掉左右缓冲，再单独输出（保持原顺序）
 *   - 只在左/右 → 进对应缓冲
 * 收尾时把左右缓冲按「先左后右」吐出，符合人读侧边栏简历的顺序。
 */
export function layoutPageLines(glyphs: PdfGlyph[], pageWidth: number): string[] {
  const rows = groupGlyphsByRow(glyphs);
  if (!rows.length) return [];

  const wideThreshold = pageWidth > 0 ? pageWidth * 0.6 : Infinity;
  const gutter = detectColumnGutter(glyphs, pageWidth);
  if (gutter == null) return rows.map(rowToText).filter(Boolean);

  const out: string[] = [];
  let leftBuf: string[] = [];
  let rightBuf: string[] = [];
  const flush = () => {
    out.push(...leftBuf, ...rightBuf);
    leftBuf = [];
    rightBuf = [];
  };

  for (const row of rows) {
    // 先把这一行按中缝拆成左右两部分。
    // 必须拆，不能「整行归到多数那一侧」——两栏各有一个短标题在同一基线上时
    // （「专业技能 | 教育背景」），左右数量相等，归哪边都会把另一栏的文字带过去。
    const leftParts: PdfGlyph[] = [];
    const rightParts: PdfGlyph[] = [];
    for (const p of row.parts) {
      const sp = splitGlyphAt(p, gutter);
      if (sp.left && sp.left.str.trim()) leftParts.push(sp.left);
      if (sp.right && sp.right.str.trim()) rightParts.push(sp.right);
    }
    if (!leftParts.length && !rightParts.length) continue;

    const isWide = rowSpan(row) >= wideThreshold && leftParts.length > 0 && rightParts.length > 0;
    if (isWide) {
      // 真正的通栏行（姓名、联系方式、横跨的分隔标题）：先把已积累的两栏吐完，再输出它
      flush();
      out.push(rowToText(row));
      continue;
    }
    if (leftParts.length) leftBuf.push(rowToText({ y: row.y, parts: leftParts, tol: row.tol }));
    if (rightParts.length) rightBuf.push(rowToText({ y: row.y, parts: rightParts, tol: row.tol }));
  }
  flush();
  return out.filter(Boolean);
}

/** 兼容入口：直接从 textContent.items 聚行（不处理分栏） */
export function groupTextItemsByLine(items: Array<{
  str?: unknown; width?: number; height?: number;
  transform?: number[]; hasEOL?: boolean;
}>): string[] {
  return glyphsToLines(extractGlyphs(items));
}

async function extractPdfText(filePath: string): Promise<{ text: string; lines: string[]; pages: number }> {
  const pdfjs = await getPdfjs();
  const standardFonts = path.join(
    path.dirname(require.resolve('pdfjs-dist/package.json')),
    'standard_fonts'
  );
  const data = new Uint8Array(fs.readFileSync(filePath));

  let doc;
  try {
    doc = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      verbosity: 0,                 // 静默字体告警（文本抽取不渲染，无碍）
      standardFontDataUrl: standardFonts + path.sep
    }).promise;
  } catch (err) {
    throw new Error('无法读取该 PDF：' + (err instanceof Error ? err.message : '文件损坏或格式不受支持'));
  }

  const lines: string[] = [];
  let pages = 0;
  try {
    pages = doc.numPages;
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const glyphs = extractGlyphs(tc.items as unknown as Array<{
        str?: unknown; width?: number; height?: number; transform?: number[]; hasEOL?: boolean;
      }>);
      const pageWidth = page.getViewport({ scale: 1 }).width;
      // layoutPageLines 内部处理「通栏 + 分栏」混排：先检中缝，再逐行归位，
      // 收尾按「先左后右」吐出。纯单栏时等价于 glyphsToLines。
      lines.push(...layoutPageLines(glyphs, pageWidth));
    }
  } finally {
    try { await doc.destroy(); } catch (_) { /* 忽略 */ }
  }

  const text = lines.join('\n');
  if (text.replace(/\s/g, '').length < 20) {
    throw new Error('未能从该 PDF 提取到足够文本（可能是扫描件 / 图片版简历），请改用文本粘贴或手动填写');
  }
  return { text, lines, pages };
}

// ---------- 参考数据（学校 / 城市） ----------
let _refCache: RefData | null = null;

function loadRefData(dataRoot: string): RefData {
  if (_refCache) return _refCache;

  // 学校：data/schools_b.csv（教育部名单，开发与打包路径一致）
  const schools: string[] = [];
  try {
    const csv = fs.readFileSync(path.join(dataRoot, 'schools_b.csv'), 'utf8').replace(/^\uFEFF/, '');
    const lines = csv.split(/\r?\n/).filter((l) => l.trim().length);
    const header = lines[0]!.split(',');
    const idxName = header.indexOf('学校名称');
    const seen = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
      const name = (lines[i]!.split(',')[idxName] || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      schools.push(name);
    }
  } catch (_) { /* 忽略 */ }

  // 城市：data/cities.json（同时收录带「市」与不带「市」两种写法）
  const citySet = new Set<string>();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataRoot, 'cities.json'), 'utf8')) as Array<{ name?: string }>;
    raw.forEach((c) => {
      if (!c || !c.name || /^(市辖区|县|省直辖县级行政区划|自治区直辖县级行政区划)$/.test(c.name)) return;
      citySet.add(c.name);
      if (/市$/.test(c.name)) citySet.add(c.name.slice(0, -1));
    });
  } catch (_) { /* 忽略 */ }
  ['北京', '上海', '天津', '重庆'].forEach((c) => citySet.add(c));

  // 学校按长度降序：优先命中更长的全称（如「中国矿业大学（北京）」）
  schools.sort((a, b) => b.length - a.length);

  _refCache = { schools, citySet };
  return _refCache;
}

// ---------- 分节 ----------
const SECTION_DEFS: ReadonlyArray<readonly [keyof ParsedProfile | 'education' | 'internships' | 'projects' | 'skills' | 'awards' | 'summary', RegExp]> = [
  ['education', /^(教育背景|教育经历|教育|学历)$/],
  ['internships', /^(实习经历|实习经验|实习与实践|实习实践|实习及实践|实习经历与实践|实践经历|实践经验|实习)$/],
  ['projects', /^(项目经历|项目经验|项目|实践经历|实践经验)$/],
  ['skills', /^(专业技能|技能特长|技能清单|技能|技术栈|技术能力|技术)$/],
  ['awards', /^(奖项|获奖|获奖情况|荣誉|荣誉奖项|奖项荣誉|奖项与证书|获奖与证书|证书|资格证书|技能证书)$/],
  ['summary', /^(自我评价|个人简介|自我介绍|个人优势|个人总结)$/]
];
const SECTION_EN: ReadonlyArray<readonly [string, RegExp]> = [
  ['education', /^(education|educational background|academics?)$/i],
  ['internships', /^(internships?|intern experiences?|work experiences?)$/i],
  ['projects', /^(projects?|project experiences?)$/i],
  ['skills', /^(skills?|technical skills|technologies)$/i],
  ['summary', /^(summary|about me|profile)$/i]
];

// 判断一行是否是分节标题（容忍装饰符号、行尾英文、冒号等）
function detectSectionKey(line: string): string | null {
  if (!line || line.length > 24) return null;
  let s = line
    .replace(/^[\s\-–—_*•·▍◆●■▶>~～|【\[]+/, '')
    .replace(/[\s\-–—_*•·▍◆●■▶<~～|】\]]+$/, '')
    .replace(/[：:]\s*$/, '')
    .trim();
  if (!s) return null;
  const zh = s.replace(/[A-Za-z\s&/·]+$/, '').trim(); // 「教育背景 EDUCATION」→「教育背景」
  for (let i = 0; i < SECTION_DEFS.length; i++) {
    if (SECTION_DEFS[i]![1].test(zh) || SECTION_DEFS[i]![1].test(s)) return SECTION_DEFS[i]![0] as string;
  }
  for (let i = 0; i < SECTION_EN.length; i++) {
    if (SECTION_EN[i]![1].test(s)) return SECTION_EN[i]![0];
  }
  return null;
}

// ---------- 通用抽取 ----------
// 手机号在简历里常写成 138-0000-0000 / 138 0000 0000 / 138.0000.0000：
// 旧正则只认连着的 11 位，带分隔符的直接漏掉（用户填了手机号却导不进来）。
const PHONE_RE = /(?<!\d)1[3-9]\d(?:[\s.\-]?\d{4}){2}(?!\d)/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// 作品集/个人主页：不只 GitHub —— 掘金、知乎、站酷、小红书、B 站、CSDN、语雀这些
// 在国内简历里比 GitHub 更常见。以前只认 github.com，其他链接会被直接丢掉。
const PORTFOLIO_RE = /(?:https?:\/\/)?(?:www\.)?(?:github\.com|gitee\.com|gitlab\.com|juejin\.cn|zhihu\.com|zcool\.com\.cn|bilibili\.com|b23\.tv|xiaohongshu\.com|xhslink\.com|blog\.csdn\.net|csdn\.net|cnblogs\.com|yuque\.com|notion\.site|douyin\.com|medium\.com|substack\.com)\/[A-Za-z0-9_\-./%~]+/i;
// 也可能压根没写网址，而是写「作品集：财务分析报告 3 份」「个人主页：见面试材料」这类说明
const PORTFOLIO_LABEL_RE = /(?:作品集|个人主页|个人网站|博客|专栏|公众号|代表作)\s*[：:]\s*[^\n]{2,60}/;
// 兜底：不属于上面那些平台的自建站/个人域名，形如「mysite.dev/portfolio」（要求带路径）
const GENERIC_URL_RE = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[A-Za-z0-9_\-./%~]{2,}/i;
const PERIOD_RE = /(20\d{2})\s*[.\/年]?\s*(\d{1,2})?\s*月?\s*(?:(?:[-–—~到\s]+\s*)(?:(20\d{2})\s*[.\/年]?\s*(\d{1,2})?\s*月?|(至今))?|至今)/;

// 「2021年9月-2025年6月」「2021.09 - 2025.06」「2023.07 至今」→ 统一 YYYY.MM - YYYY.MM / 至今
export function matchPeriod(text: string): string {
  const m = String(text || '').match(PERIOD_RE);
  if (!m) return '';
  const mm = (x: string | undefined) => (x ? String(x).padStart(2, '0') : '');
  const start = m[1]! + '.' + (mm(m[2]) || '01');
  let end = '至今';
  if (m[3]) end = m[3] + '.' + (mm(m[4]) || (m[4] ? '01' : '06'));
  return start + ' - ' + end;
}

function findSchool(line: string, ref: RefData): string {
  for (let i = 0; i < ref.schools.length; i++) {
    if (line.includes(ref.schools[i]!)) return ref.schools[i]!;
  }
  return '';
}

function matchCity(text: string, ref: RefData): string {
  if (!text) return '';
  let best = '';
  ref.citySet.forEach((c) => {
    if (c.length > best.length && text.includes(c)) best = c;
  });
  return best;
}

// ---------- 教育解析 ----------
function parseEducation(lines: string[], ref: RefData): EducationEntry[] {
  const entries: EducationEntry[] = [];
  let cur: EducationEntry | null = null;

  lines.forEach((line) => {
    const school = findSchool(line, ref);
    const period = matchPeriod(line);
    const gpaM = line.match(/(?:GPA|绩点|平均分)\s*[：:]?\s*([\d.]+\s*\/\s*[\d.]+|\d+(?:\.\d+)?)/i);
    const degreeM = line.match(/(博士|硕士|研究生|本科|大专|专科|学士)/);

    // 同一个学校名重复出现时，通常是「一条经历的第二行」（保持同一条），
    // 但「硕博连读 / 同校两个学位」是三条不同经历 —— 用时间段是否不同来区分：
    // 本条已有时间段，新行又带自己的、且不一样的时间段 → 算新条目。
    const sameSchoolNewPeriod = !!(school && cur && cur.school === school &&
      period && cur.period && period !== cur.period);
    if (school && (!cur || cur.school !== school || sameSchoolNewPeriod)) {
      cur = { school, major: '', degree: '', period: '', gpa: '', courses: '' };
      entries.push(cur);
    }
    if (!cur) return;

    if (period) cur.period = period;
    // 教育经历常只写一个毕业年份（「北京大学 2010」），matchPeriod 要求成对或「至今」，
    // 所以这里补一个「孤立年份」兜底，否则时间段永远是空的。
    if (!cur.period) {
      const loneYear = line.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/);
      if (loneYear) cur.period = loneYear[0];
    }
    if (gpaM) cur.gpa = gpaM[1]!.replace(/\s+/g, '');
    if (degreeM) cur.degree = degreeM[1] === '研究生' ? '硕士' : degreeM[1]!;

    const majorM = line.match(/(?:专业|专业方向)\s*[：:]\s*([^\s，,、；;（(]{2,20})/);
    if (majorM) {
      cur.major = majorM[1]!;
    } else if (school) {
      const rest = line
        .replace(school, '')
        .replace(/(博士|硕士|研究生|本科|大专|专科)/g, '')
        .replace(/(?:GPA|绩点|平均分)\s*[：:]?\s*[\d.\/]+/ig, '')
        .replace(/20\d{2}\s*[.\/年]?\s*\d{0,2}\s*[-–—~至到\s].*/g, '')
        .replace(/[|,，、;；:：\-–—()（）\[\]【】\s]/g, ' ');
      const bits = rest.match(/[\u4e00-\u9fa5]{2,20}/g) || [];
      const majorLike = bits.find((b) => !/大学|学院|学校|课程/.test(b));
      if (majorLike && !cur.major) cur.major = majorLike;
    } else if (!cur.major && (degreeM || /在读|全日制|毕业|学位/.test(line))) {
      // 专业常常另起一行（「硕士在读 · 对外汉语」）：这行没有学校名，
      // 上面那条分支走不到，于是专业一直是空的。
      // 还要滤掉「理学 / 工学 / 第二」这类前缀词，否则「理学学士第二学位 应用数学」
      // 会把「理学」当成专业（真专业在最后面）。
      const bits = (line
        .replace(/(博士|硕士|研究生|本科|大专|专科|学士|在读|全日制|毕业|学位)/g, ' ')
        .match(/[\u4e00-\u9fa5]{2,20}/g) || [])
        .filter((b) => !/大学|学院|学校|课程|专业/.test(b))
        .filter((b) => !/^(理学|工学|文学|管理学|经济学|法学|医学|教育学|艺术学|农学|军事学|第一|第二|双)$/.test(b));
      if (bits.length) cur.major = bits[0]!;
    }

    const courseM = line.match(/(?:主修课程|核心课程|主修|课程)\s*[：:]\s*(.+)$/);
    if (courseM && courseM[1]!.trim().length >= 4) cur.courses = courseM[1]!.trim().slice(0, 80);
  });

  return entries.filter((e) => e.school);
}

// ---------- 经历解析（实习 / 项目） ----------
const BULLET_RE = /^[\-–—*•·▪◦>»>+]\s*|^\d+[.、)）]\s*/;
const TITLE_HINT_RE = /(公司|集团|科技|信息技术|网络|实验室|工作室|银行|有限|中心|平台|实习|工程师|开发|负责人|项目|系统|服务|工作室|事务所|设计院|医院|学校|证券|基金|诊所|药房)/;

function looksLikeTitle(line: string): boolean {
  if (BULLET_RE.test(line)) return false;
  // 句子不是标题：以句号/问号/叹号收尾，或带中文逗号顿号分号的，都是在描述事情。
  // （实测「曾在上海东方卫视新闻教育组实习，并担任北京大学中文系团委秘书。」因为含「实习」
  //   被当成了新条目名，结果整段项目经历被切碎。）
  if (/[。！？!?]$/.test(line)) return false;
  if (/[，,、；;]/.test(line)) return false;
  if (matchPeriod(line)) return true;
  if (line.length <= 34 && TITLE_HINT_RE.test(line)) return true;
  return false;
}

interface ParsedExperience extends Omit<ExperienceEntry, 'description'> {
  description: string[];
}

function parseExperiences(lines: string[], ref?: RefData): ExperienceEntry[] {
  const entries: ParsedExperience[] = [];
  let cur: ParsedExperience | null = null;

  const isSentence = (s: string): boolean => /[。！？!?]$/.test(s) || /[，,、；;]/.test(s);
  // 角色行：「机构/项目名」后面紧跟的短行，如「对外汉语大班教师」「学生骨干 / 实习生」。
  // 排除看起来像机构/学校名的短行，免得把下一个条目的名字当成上一个的角色。
  const looksLikeOrg = (s: string): boolean =>
    /(大学|学院|学校|公司|集团|银行|实验室|工作室|中心|项目|科技|有限|事务所|研究院)/.test(s) || (!!ref && ref.schools.includes(s));
  const isRoleLine = (s: string): boolean => s.length <= 16 && !isSentence(s) && !matchPeriod(s) && !looksLikeOrg(s);

  lines.forEach((line) => {
    const isBullet = BULLET_RE.test(line);
    // 角色行优先判断：它常含有「实习/项目/中心」等关键词（如「学生骨干 / 实习生」），
    // 若先跑标题判定就会被当成新条目，把一段经历切成两半。
    if (cur && cur.name && !cur.role && !isBullet && isRoleLine(line)) {
      cur.role = line.trim().slice(0, 40);
      return;
    }
    // 「名称单独一行、时间单独一行」的排版：把孤立的时间行补进当前条目
    if (cur && !cur.period && !isBullet && /^[\s\d.\/年月日\-–—~至到]+$/.test(line)) {
      const p = matchPeriod(line);
      if (p) { cur.period = p; return; }
    }
    // 分节里的第一行（且非项目符号）一律当作条目名：中文简历里它必然是
    // 机构名/项目名（如「校园组织与媒体实践」），而它往往不含任何触发关键词。
    const firstLineOfSection = !cur && entries.length === 0;
    if (!isBullet && (looksLikeTitle(line) || firstLineOfSection)) {
      cur = { name: '', role: '', period: '', tech: '', description: [] };
      entries.push(cur);

      let rest = line;
      // 顺序很重要：先抽技术栈，再剥时间段
      const techM = rest.match(/(?:技术栈|技术|Tech)\s*[：:]\s*(.+)$/i);
      if (techM) {
        cur.tech = techM[1]!.trim().slice(0, 100);
        rest = rest.slice(0, techM.index);
      }
      const period = matchPeriod(rest);
      if (period) {
        cur.period = period;
        rest = rest.replace(/20\d{2}\s*[.\/年]?\s*\d{0,2}\s*[-–—~至到\s].*/g, '');
      }
      // 剥掉时间段后可能留下孤零零的开括号（「复旦大学中文系（2007–2009）」→「复旦大学中文系（」），
      // 连括号一起收尾，别把残缺括号留给用户看
      rest = rest.replace(/[（(【\[]\s*$/, '').trim();
      const roleM = rest.match(/[(（]([^()（）]{2,12})[)）]/);
      // 括号里是城市（如「美国暑期中文项目（北京）」）时不当角色，那只是地点
      if (roleM && !(ref && ref.citySet.has(roleM[1]!.trim()))) {
        cur.role = roleM[1]!;
        rest = rest.replace(roleM[0], '');
      }
      cur.name = rest.replace(/[|,，、;；:：\-–—\s]+/g, ' ').trim().slice(0, 40);
      return;
    }

    // 紧跟条目名之后的短行 = 角色（已在上方优先处理）
    const content = line.replace(BULLET_RE, '').trim();
    if (!content) return;
    if (cur) {
      const techM = content.match(/(?:技术栈|技术)\s*[：:]\s*(.+)$/);
      if (techM && !cur.tech) {
        cur.tech = techM[1]!.trim().slice(0, 100);
        return;
      }
      cur.description.push(content.slice(0, 150));
    } else if (content.length > 6) {
      cur = { name: '', role: '', period: '', tech: '', description: [content.slice(0, 150)] };
      entries.push(cur);
    }
  });

  return entries.filter((e) => e.name || e.description.length > 0);
}

// ---------- 主入口：结构化解析 ----------
export function parseResumeText(text: string, ref: RefData): ParsedProfile {
  // 归一化放在入口：PDF 抽取路径已经归一化过一次（幂等），但从别处粘贴进来的文本
  // （很多人是从 PDF 阅读器里复制的）同样会带康熙部首码位，这里兜住。
  const rawLines = stripPageNoise(
    normalizeExtractedText(String(text || ''))
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const notes: string[] = [];

  // 1) 分节
  const sections: Record<string, string[]> = { header: [], education: [], internships: [], projects: [], skills: [], awards: [], summary: [] };
  let current = 'header';
  rawLines.forEach((line) => {
    const key = detectSectionKey(line);
    if (key) { current = key; return; }
    sections[current]!.push(line);
  });
  const sectioned = ['education', 'internships', 'projects', 'skills', 'summary']
    .some((k) => sections[k]!.length > 0);
  if (!sectioned) {
    notes.push('未识别出「教育背景 / 实习经历 / 项目经历」等分节标题，仅导入了基本信息，其余内容请手动搬运。');
  }

  // 2) 基本信息：全篇正则扫描
  const whole = rawLines.join('\n');
  const phone = ((whole.match(PHONE_RE) || [])[0] || '').replace(/[^\d]/g, '');
  const email = (whole.match(EMAIL_RE) || [])[0] || '';
  let github = (whole.match(PORTFOLIO_RE) || [])[0] || '';
  if (!github) {
    // 知名平台之外的个人域名：逐行找「域名 + 路径」，跳过明显不是作品集的行
    // （官网 / 招聘页 / 课程链接会出现在简历里，但都不该填进作品集字段）
    const lines = whole.split('\n');
    for (const ln of lines) {
      if (/官网|招聘|公司网站|课程|招生|报名/.test(ln)) continue;
      const m = ln.match(GENERIC_URL_RE);
      if (m) { github = m[0]; break; }
    }
  }
  if (!github) {
    // 没写网址但有「作品集：…」这类说明时也收进来（保留标签，渲染时原样展示）
    const lm = whole.match(PORTFOLIO_LABEL_RE);
    if (lm) github = lm[0].trim();
  }

  let name = '';
  const nameM = whole.match(/姓名\s*[：:]\s*([^\s，,、；;（(]{1,8})/);
  if (nameM) name = nameM[1]!.trim();
  if (!name) {
    const NAME_BLOCK = /^(个人简历|求职简历|我的简历|简历|个人简介|name)$/i;
    outer:
    for (const line of sections.header!.slice(0, 6)) {
      for (const tk of line.split(/\s+/)) {
        if (/^[\u4e00-\u9fa5·]{2,4}$/.test(tk) && !ref.citySet.has(tk) && !findSchool(tk, ref) && !NAME_BLOCK.test(tk)) {
          name = tk;
          break outer;
        }
      }
    }
  }

  let targetRole = '';
  const roleM = whole.match(/(?:求职意向|期望职位|目标岗位|应聘岗位|意向岗位)\s*[：:]\s*([^\n，,、;；]{2,24})/);
  if (roleM) targetRole = roleM[1]!.trim();
  if (!targetRole) {
    // 抬头常有一句职位标语：「对外汉语教师｜课程设计 · 语法教学 · 跨文化课堂」。
    // 没有「求职意向：」这类显式字段时，取竖线/间隔号前的那一段当目标岗位。
    // 限制得比较死（不含联系方式、长度 2–12、必须是中文/字母），免得把姓名或联系方式吃进来。
    for (const line of sections.header!.slice(0, 4)) {
      if (!/[｜|]/.test(line)) continue;
      if (/[@\d]/.test(line)) continue;
      if (line === name) continue;
      const head = line.split(/[｜|]/)[0]!.trim();
      if (head.length >= 2 && head.length <= 12 && /^[\u4e00-\u9fa5A-Za-z·\/\s]+$/.test(head)) {
        targetRole = head;
        break;
      }
    }
  }

  let city = '';
  const cityM = whole.match(/(?:期望|意向|所在|现居|工作)城市?\s*[：:]\s*([^\s，,、；;]{2,12})/);
  if (cityM) city = matchCity(cityM[1]!, ref);
  if (!city) {
    for (const line of sections.header!.slice(0, 6)) {
      if (line.length > 12) continue;
      const c = matchCity(line, ref);
      if (c && line.includes(c)) { city = c; break; }
    }
  }

  // 3) 各分节解析
  const education = parseEducation(sections.education!, ref);
  const internships = parseExperiences(sections.internships!, ref);
  const projects = parseExperiences(sections.projects!, ref);
  // 竞赛 / 奖项 / 荣誉 / 证书：每行一条，去掉项目符号但保留用户原话
  const awards = (sections.awards || [])
    .map((line) => line.replace(BULLET_RE, '').trim())
    .filter((line) => line.length >= 2)
    .slice(0, 20);

  let skills = '';
  if (sections.skills!.length) {
    // 分节内各行用「、」拼接；行内的「·」「|」也统一成「、」，
    // 这样存进档案的技能就是一个规范的顿号列表（表单/计数/导出都按这个切）
    skills = sections.skills!
      .join('、')
      .replace(/[·|｜]/g, '、')
      .replace(/\s*、\s*/g, '、')   // 原文是「 · 」形态，去掉顿号两侧空格
      .replace(/、{2,}/g, '、')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400);
  }
  const summary = sections.summary!.join('').replace(/\s+/g, ' ').trim().slice(0, 300);

  if (!education.length && sections.education!.length) {
    notes.push('识别到「教育背景」分节，但未匹配到学校名称，请手动补全。');
  }
  // 奖项/证书单独切出来（以前会连标题带内容一起塞进「技能」字段），现在导入到独立的竞赛/奖项字段
  if (sections.awards!.length && !awards.length) {
    notes.push('识别到「奖项 / 荣誉 / 证书」分节，但没读到可用内容，请手动补。');
  }

  return {
    name, phone, email, city, github, targetRole, summary, skills,
    education, internships, projects, awards,
    notes
  };
}

// ---------- 文件入口：按扩展名分流 ----------
export async function importFromFile(filePath: string, dataRoot: string): Promise<{ file: string; pages: number | null; parsed: ParsedProfile }> {
  const ref = loadRefData(dataRoot);
  const ext = path.extname(filePath).toLowerCase();
  let text: string;
  let pages: number | null = null;

  if (ext === '.txt' || ext === '.md') {
    text = fs.readFileSync(filePath, 'utf8');
  } else if (ext === '.pdf') {
    const r = await extractPdfText(filePath);
    text = r.text;
    pages = r.pages;
  } else {
    throw new Error('仅支持 .pdf / .txt 文件');
  }

  const parsed = parseResumeText(text, ref);
  return { file: path.basename(filePath), pages, parsed };
}

export { loadRefData, extractPdfText };
