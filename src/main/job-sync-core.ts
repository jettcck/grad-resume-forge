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
  /** 登录入口 */
  loginUrl: string;
  /** 投递记录页 */
  applyUrl: string;
  /** 收藏 / 感兴趣列表页（没有就为 null） */
  collectUrl: string | null;
  /** 是否具备可同步的投递记录页；false 时只提供「打开官网」 */
  syncable: boolean;
  /** 入口路径随站点改版可能变化，同步面板会显示实际加载到的地址便于校正 */
  note?: string;
}

export const SYNC_PLATFORMS: SyncPlatform[] = [
  {
    id: 'boss',
    name: 'BOSS直聘',
    loginUrl: 'https://www.zhipin.com/web/user/?ka=header-login',
    applyUrl: 'https://www.zhipin.com/web/geek/job/apply',
    collectUrl: 'https://www.zhipin.com/web/geek/job/collect',
    syncable: true
  },
  {
    id: 'zhaopin',
    name: '智联招聘',
    loginUrl: 'https://passport.zhaopin.com/login',
    applyUrl: 'https://i.zhaopin.com/',
    collectUrl: 'https://i.zhaopin.com/',
    syncable: true,
    note: '个人中心是单页应用，投递与收藏在同一入口的不同页签'
  },
  {
    id: '51job',
    name: '前程无忧',
    loginUrl: 'https://login.51job.com/login.php',
    applyUrl: 'https://i.51job.com/userset/my_apply.php',
    collectUrl: 'https://i.51job.com/userset/my_favorite.php',
    syncable: true
  },
  {
    id: 'shixiseng',
    name: '实习僧',
    loginUrl: 'https://www.shixiseng.com/login',
    applyUrl: 'https://www.shixiseng.com/user/deliver',
    collectUrl: 'https://www.shixiseng.com/user/collect',
    syncable: true
  },
  {
    id: 'liepin',
    name: '猎聘',
    loginUrl: 'https://passport.liepin.com/',
    applyUrl: 'https://c.liepin.com/',
    collectUrl: 'https://c.liepin.com/',
    syncable: true,
    note: '个人中心入口较多；若没抓到记录，可在同步窗口里手动点到「我投递的职位」后再点同步'
  },
  {
    id: 'lagou',
    name: '拉勾',
    loginUrl: 'https://passport.lagou.com/login/login.html',
    applyUrl: 'https://www.lagou.com/mycenter/deliverRecord.html',
    collectUrl: 'https://www.lagou.com/mycenter/collect.html',
    syncable: true
  },
  {
    id: 'iguopin',
    name: '国聘',
    loginUrl: 'https://www.iguopin.com/login',
    applyUrl: 'https://www.iguopin.com/personal/delivery',
    collectUrl: 'https://www.iguopin.com/personal/collection',
    syncable: true,
    note: '入口路径以实际站点为准；抓不到时可在窗口内手动导航到投递记录页'
  },
  {
    id: 'yingjiesheng',
    name: '应届生求职网',
    loginUrl: 'https://www.yingjiesheng.com/',
    applyUrl: '',
    collectUrl: null,
    syncable: false,
    note: '该站是校招信息聚合与论坛，不提供个人投递记录，没有可同步的数据'
  },
  {
    id: 'chinahr',
    name: '中华英才网',
    loginUrl: 'https://www.chinahr.com/',
    applyUrl: '',
    collectUrl: null,
    syncable: false,
    note: '该站个人投递记录页已下线，无法同步'
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
const COMPANY_KEYS = ['companyName', 'company', 'compName', 'brandName', 'companyFullName', 'companyTitle', 'corpName', 'employerName', 'firmName'];
const POSITION_KEYS = ['jobName', 'jobTitle', 'positionName', 'position', 'posName', 'jobPosition', 'title', 'job'];
const PLACE_KEYS = ['cityName', 'city', 'workCity', 'jobCity', 'location', 'locationName', 'address', 'areaName'];
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
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
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
