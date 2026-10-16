'use strict';

// ============================================================
//  招聘平台同步 —— 纯逻辑层（不依赖 Electron）
//
//  这里只放「平台注册表」和「响应体 → 投递记录」的归一化：
//  没有 IO、没有窗口、没有 electron 依赖，因此可以在普通 Node 里直接单测。
//  Electron 相关的登录窗口与 CDP 旁路在 job-sync.ts。
// ============================================================

export interface SyncPlatform {
  id: string;
  name: string;
  /**
   * 稳定入口：平台首页。
   *
   * 刻意**不再写「投递记录」深链接**——2026-10-11 实测结果：
   *   zhipin  /web/geek/job/apply        → 302 到 /web/common/404.html（页面不存在）
   *   zhaopin i.zhaopin.com              → 重定向回官网首页
   *   51job   /userset/my_apply.php      → 重定向到登录页
   *   shixiseng /user/deliver            → 重定向到登录页
   *   liepin  c.liepin.com               → 重定向回首页并带 loginBackUrl
   * 入口页面一旦改版，硬编码深链接就会 404，用户只能看到一个空白窗口。
   * 所以这里只放实测可达的首页，记录页由用户在窗口里自己点进去。
   */
  entryUrl: string;
  /** 登录后到哪里找投递记录：写给用户看的人工指引 */
  recordHint: string;
  /** 是否存在可查看的个人投递记录页 */
  syncable: boolean;
  /** 实测到的风险提示（滑块验证、站点改版等） */
  note?: string;
}

export const SYNC_PLATFORMS: SyncPlatform[] = [
  {
    id: 'boss',
    name: 'BOSS直聘',
    entryUrl: 'https://www.zhipin.com/',
    recordHint: '登录后点右上角头像 → 我的 → 投递记录（或我的收藏）',
    syncable: true
  },
  {
    id: 'zhaopin',
    name: '智联招聘',
    entryUrl: 'https://www.zhaopin.com/',
    recordHint: '登录后进入「个人中心」→ 已投递 / 我的收藏',
    syncable: true
  },
  {
    id: '51job',
    name: '前程无忧',
    entryUrl: 'https://www.51job.com/',
    recordHint: '登录后进入「个人中心」→ 投递记录 / 我的收藏',
    syncable: true
  },
  {
    id: 'shixiseng',
    name: '实习僧',
    entryUrl: 'https://www.shixiseng.com/',
    recordHint: '登录后点右上角头像 → 我的投递 / 我的收藏',
    syncable: true
  },
  {
    id: 'liepin',
    name: '猎聘',
    entryUrl: 'https://www.liepin.com/',
    recordHint: '登录后进入「我的猎聘」→ 我投递的职位 / 我的收藏',
    syncable: true
  },
  {
    id: 'lagou',
    name: '拉勾',
    entryUrl: 'https://www.lagou.com/',
    recordHint: '通过验证并登录后 → 个人中心 → 投递记录',
    syncable: true,
    note: '实测首页会弹「滑动验证」：需在同步窗口里手动拖动滑块通过后再继续'
  },
  {
    id: 'iguopin',
    name: '国聘',
    entryUrl: 'https://www.iguopin.com/',
    recordHint: '登录后进入「个人中心」→ 我的投递',
    syncable: true
  },
  {
    id: 'yingjiesheng',
    name: '应届生求职网',
    entryUrl: 'https://www.yingjiesheng.com/',
    recordHint: '投递进度只在官方 APP 里（首页写着「APP 聊投递进度」），网页端没有投递记录页',
    syncable: false
  },
  {
    id: 'chinahr',
    name: '中华英才网',
    entryUrl: 'https://www.chinahr.com/',
    recordHint: '登录后进入个人中心查看是否有投递记录',
    syncable: true,
    note: '站点已改版为「新华英才」，账户体系有变动；若个人中心里没有投递记录，就同步不到数据'
  }
];

export function findPlatform(id: string): SyncPlatform | null {
  return SYNC_PLATFORMS.find((p) => p.id === id) || null;
}

// ---------------- 记录归一化 ----------------
export interface SyncRecord {
  company: string;
  position: string;
  place: string;
  url: string;
  externalId: string;
  notes: string;
  stage: 'wish' | 'applied';
}

// 字段别名：不同平台（甚至同一平台的不同接口）用词都不一样
const COMPANY_KEYS = ['companyName', 'company', 'compName', 'brandName', 'companyFullName', 'companyTitle', 'corpName', 'employerName', 'firmName', 'brandComName'];
const POSITION_KEYS = ['jobName', 'jobTitle', 'positionName', 'position', 'posName', 'jobPosition', 'title', 'job'];
const PLACE_KEYS = ['cityName', 'city', 'workCity', 'jobCity', 'location', 'locationName', 'address', 'areaName', 'areaDistrict', 'businessDistrict'];
const ID_KEYS = ['jobId', 'encryptJobId', 'positionId', 'encryptPositionId', 'job_id', 'deliverId', 'applyId', 'id'];
const URL_KEYS = ['jobUrl', 'positionUrl', 'detailUrl', 'url', 'link', 'jobLink'];
const TIME_KEYS = ['applyTime', 'deliverTime', 'deliveryTime', 'collectTime', 'favTime', 'createTime', 'updateTime', 'date', 'time'];

/** 从对象里按候选键取第一个非空字符串 */
export function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && isFinite(v)) return String(v);
    // 常见嵌套：{ company: { name } } / { job: { name } }
    if (v && typeof v === 'object') {
      const n = (v as Record<string, unknown>).name
        || (v as Record<string, unknown>).title
        || (v as Record<string, unknown>).label;
      if (typeof n === 'string' && n.trim()) return n.trim();
    }
  }
  return '';
}

/** 一个对象是否像「投递/收藏记录」：必须同时有公司名与岗位名，且不像正文 */
export function looksLikeRecord(o: Record<string, unknown>): boolean {
  const company = pickString(o, COMPANY_KEYS);
  const position = pickString(o, POSITION_KEYS);
  if (!company || !position) return false;
  if (company.length > 60 || position.length > 80) return false;
  if (/[。；;]/.test(company) || /[。；;]/.test(position)) return false;
  return true;
}

/** 时间归一化：毫秒/秒时间戳与常见日期串统一成 YYYY-MM-DD，认不出返回空串 */
export function normalizeTime(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s.length === 10 ? s + '000' : s);
    const d = new Date(n);
    if (!isNaN(d.getTime())) {
      // 必须用**本地**日期：toISOString 是 UTC，东八区早上 7 点前的投递
      // 会被算成前一天（用户看到「投递时间：昨天」以为数据错了）。
      const p = (x: number) => String(x).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }
  }
  const m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  return '';
}

/**
 * 从一批 JSON 响应里提取投递/收藏记录。
 *
 * 刻意做「深扫描 + 字段别名」而不是绑定固定接口路径：
 * 平台改版或新增分页接口时仍能取到数据；取不到也只是返回空数组，绝不编造记录。
 */
export function extractRecords(
  bodies: Array<{ url: string; json: unknown }>,
  kind: 'applied' | 'collected'
): SyncRecord[] {
  const out: SyncRecord[] = [];
  const seen = new Set<string>();
  const MAX_DEPTH = 12;
  if (!Array.isArray(bodies)) return out;

  const visit = (node: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || node == null) return;
    if (Array.isArray(node)) {
      for (const it of node) visit(it, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (looksLikeRecord(obj)) {
      const company = pickString(obj, COMPANY_KEYS);
      const position = pickString(obj, POSITION_KEYS);
      const key = company + '\u0000' + position;
      if (!seen.has(key)) {
        seen.add(key);
        const notes: string[] = [];
        const time = normalizeTime(pickString(obj, TIME_KEYS));
        if (kind === 'collected') notes.push('来源：平台收藏');
        if (kind === 'applied' && time) notes.push('投递时间：' + time);
        out.push({
          company: company.slice(0, 120),
          position: position.slice(0, 120),
          place: pickString(obj, PLACE_KEYS).slice(0, 120),
          url: pickString(obj, URL_KEYS).slice(0, 1000),
          externalId: pickString(obj, ID_KEYS).slice(0, 160),
          notes: notes.join(' · ').slice(0, 2000),
          stage: kind === 'collected' ? 'wish' : 'applied'
        });
      }
    }
    for (const k of Object.keys(obj)) visit(obj[k], depth + 1);
  };

  for (const b of bodies) visit(b.json, 0);
  return out;
}

// ---------------- BOSS 页签过滤 ----------------
//
// BOSS /web/geek/recommend 是多页签页面：用户截图实测 tab=4 是「感兴趣 → 职位收藏」。
// tab=48 并不是收藏页，BOSS 会回退到 /web/geek/jobs 推荐流，导致把侧栏/推荐职位误抓进来。
// tab=148 是旧版本/部分入口返回的沟通页签值，因此仍兼容沟通过滤。
// 页面切页签不重新导航，两个页签的数据响应会先后落进同一个捕获缓冲。
//
// 规则：响应 URL 带 tab= → 只收与目标页签一致的；不带 tab= 的响应
// 只允许「明显是主列表」的接口，侧栏/推荐/广告噪音必须排除。
// 只对 BOSS 生效，其他平台原样放行。

/**
 * 从捕获 URL 里取 BOSS 当前页签值，没有返回空串。
 *
 * 页面切换「沟通过 / 已投递 / 面试 / 感兴趣」时，接口 URL 可能保持不变，
 * 主进程会把当时的页面地址编码到 __grf_page 参数里；该值必须优先于
 * 接口自身可能残留的 tab 参数。
 * 用户截图实测：tab=4 是「感兴趣 → 职位收藏」。
 */
export function bossTabOf(url: string): string {
  const raw = String(url || '');
  const page = /[?&]__grf_page=([^&]+)/.exec(raw);
  if (page) {
    try {
      const pageUrl = decodeURIComponent(page[1]);
      const pm = /[?&]tab=(\d+)/.exec(pageUrl);
      if (pm) return pm[1];
    } catch (_) { /* 保留对原始 URL 的解析兜底 */ }
  }
  const m = /[?&]tab=(\d+)/.exec(raw);
  return m ? m[1] : '';
}

/**
 * 判断一条 BOSS 响应是否明显来自「非目标列表」的噪音接口
 * （首页职位推荐流、右下角「谁看过我 / 对我感兴趣的」小卡片、广告等）。
 */
export function isBossNoiseResponse(url: string, kind: 'applied' | 'collected'): boolean {
  const raw = String(url || '');
  // 1) /web/geek/jobs 是职位搜索/推荐流，不是个人投递或收藏页
  if (/\/web\/geek\/jobs(?:[/?&#]|$)/i.test(raw) || /__grf_page=[^&]*%2Fweb%2Fgeek%2Fjobs(?:%3F|%26|%23|$)/i.test(raw)) {
    return true;
  }
  // 2) 右下角侧栏「谁看过我 / 对我感兴趣的」或相似职位推荐接口
  const apiPart = raw.split('__grf_page=')[0];
  if (/\/(?:see|look|viewer|visited|visit|recommend\/job|job\/recommend|similar|ad|banner)\b/i.test(apiPart)) {
    return true;
  }
  // 3) geekGetJob 的 tag 参数才是接口所属模块，优先级高于页面 tab。
  // 页面停在 tab=4 时，右侧侧栏仍会并发请求 tag=2；收藏只能接收 tag=4。
  const tagMatch = /[?&]tag=(\d+)/i.exec(apiPart);
  if (tagMatch) {
    const tag = tagMatch[1];
    if (kind === 'collected') return tag !== '4';
    return !['1', '2', '3', '148'].includes(tag);
  }
  // 4) 收藏页的侧栏接口明确排除
  if (kind === 'collected' && /\/(?:sidebar|resume\/sidebar|friend|chat|msg|message|history|geek\/interaction)\b/i.test(apiPart)) {
    return true;
  }
  return false;
}

/** 按「目标页签」过滤捕获缓冲：见上方注释 */
export function filterBodiesByTab(
  platformId: string,
  kind: 'applied' | 'collected',
  bodies: Array<{ url: string; json: unknown; at?: number }>
): Array<{ url: string; json: unknown; at?: number }> {
  if (platformId !== 'boss') return bodies;
  return bodies.filter((b) => {
    const raw = String(b.url || '');
    if (isBossNoiseResponse(raw, kind)) return false;
    const tab = bossTabOf(raw);
    if (!tab) return true;
    if (kind === 'collected') return tab === '4' || tab === '48';
    // 沟通 / 已投递：兼容 tab=1（沟通过）、tab=2（已投递）、tab=148（旧版/子入口）
    return tab === '1' || tab === '2' || tab === '148';
  });
}
