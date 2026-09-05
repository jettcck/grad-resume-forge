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

// ---------- PDF 文本抽取 ----------
let _pdfjsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;

async function getPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
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
          const t = buf.trim();
          if (t) lines.push(t);
          buf = '';
        }
      });
      if (buf.trim()) lines.push(buf.trim());
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
const SECTION_DEFS: ReadonlyArray<readonly [keyof ParsedProfile | 'education' | 'internships' | 'projects' | 'skills' | 'summary', RegExp]> = [
  ['education', /^(教育背景|教育经历|教育|学历)$/],
  ['internships', /^(实习经历|实习经验|实习)$/],
  ['projects', /^(项目经历|项目经验|项目|实践经历|实践经验)$/],
  ['skills', /^(专业技能|技能特长|技能清单|技能|技术栈|技术能力|技术)$/],
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
const PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+/i;
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
    }

    const courseM = line.match(/(?:主修课程|核心课程|主修|课程)\s*[：:]\s*(.+)$/);
    if (courseM && courseM[1]!.trim().length >= 4) cur.courses = courseM[1]!.trim().slice(0, 80);
  });

  return entries.filter((e) => e.school);
}

// ---------- 经历解析（实习 / 项目） ----------
const BULLET_RE = /^[\-–—*•·▪◦>»>+]\s*|^\d+[.、)）]\s*/;
const TITLE_HINT_RE = /(公司|集团|科技|信息技术|网络|实验室|工作室|银行|有限|中心|平台|实习|工程师|开发|负责人|项目|系统|服务|工作室)/;

function looksLikeTitle(line: string): boolean {
  if (BULLET_RE.test(line)) return false;
  if (matchPeriod(line)) return true;
  if (line.length <= 34 && TITLE_HINT_RE.test(line)) return true;
  return false;
}

interface ParsedExperience extends Omit<ExperienceEntry, 'description'> {
  description: string[];
}

function parseExperiences(lines: string[]): ExperienceEntry[] {
  const entries: ParsedExperience[] = [];
  let cur: ParsedExperience | null = null;

  lines.forEach((line) => {
    const isBullet = BULLET_RE.test(line);
    if (!isBullet && looksLikeTitle(line)) {
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
      const roleM = rest.match(/[(（]([^()（）]{2,12})[)）]/);
      if (roleM) {
        cur.role = roleM[1]!;
        rest = rest.replace(roleM[0], '');
      }
      cur.name = rest.replace(/[|,，、;；:：\-–—\s]+/g, ' ').trim().slice(0, 40);
      return;
    }

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
  const rawLines = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const notes: string[] = [];

  // 1) 分节
  const sections: Record<string, string[]> = { header: [], education: [], internships: [], projects: [], skills: [], summary: [] };
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
  const phone = (whole.match(PHONE_RE) || [])[0] || '';
  const email = (whole.match(EMAIL_RE) || [])[0] || '';
  const github = (whole.match(GITHUB_RE) || [])[0] || '';

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
  const internships = parseExperiences(sections.internships!);
  const projects = parseExperiences(sections.projects!);

  let skills = '';
  if (sections.skills!.length) {
    skills = sections.skills!.join('、').replace(/\s+/g, ' ').trim().slice(0, 400);
  }
  const summary = sections.summary!.join('').replace(/\s+/g, ' ').trim().slice(0, 300);

  if (!education.length && sections.education!.length) {
    notes.push('识别到「教育背景」分节，但未匹配到学校名称，请手动补全。');
  }

  return {
    name, phone, email, city, github, targetRole, summary, skills,
    education, internships, projects,
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
