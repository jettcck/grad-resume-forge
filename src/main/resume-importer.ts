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

export function normalizeExtractedText(s: string): string {
  if (!s) return s;
  return s.replace(RADICAL_RE, (c) => RADICAL_MAP[c] || c);
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
      let buf = '';
      tc.items.forEach((it) => {
        if (typeof (it as { str?: unknown }).str !== 'string') return;
        buf += (it as { str: string }).str;
        if ((it as { hasEOL?: boolean }).hasEOL) {
          const t = normalizeExtractedText(buf).trim();
          if (t) lines.push(t);
          buf = '';
        }
      });
      if (buf.trim()) lines.push(normalizeExtractedText(buf).trim());
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
    const degreeM = line.match(/(博士|硕士|研究生|本科|大专|专科)/);

    if (school && (!cur || cur.school !== school)) {
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
    } else if (!cur.major && (degreeM || /在读|全日制|毕业/.test(line))) {
      // 专业常常另起一行（「硕士在读 · 对外汉语」）：这行没有学校名，
      // 上面那条分支走不到，于是专业一直是空的。
      const bits = (line
        .replace(/(博士|硕士|研究生|本科|大专|专科|在读|全日制|毕业|学位)/g, ' ')
        .match(/[\u4e00-\u9fa5]{2,20}/g) || [])
        .filter((b) => !/大学|学院|学校|课程|专业/.test(b));
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
  const rawLines = normalizeExtractedText(String(text || ''))
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
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
    skills = sections.skills!.join('、').replace(/\s+/g, ' ').trim().slice(0, 400);
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
