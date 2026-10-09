'use strict';

// ============================================================
//  地图瓦片代理（主进程侧）
//
//  为什么不直接在渲染层加载瓦片：
//    渲染层要显示 https://tile.openstreetmap.org/{z}/{x}/{y}.png 就必须把该域名写进
//    img-src。一旦允许任意瓦片源，就得放宽成 img-src https:，等于把刚收紧的边界重新打开。
//    改成主进程取回瓦片、以 data: URL 交给渲染层，则 CSP **一行都不用改**（data: 本来就在
//    default-src 里），渲染层也继续待在沙箱里。
//
//  同时这里也是唯一该做 SSRF 防护的地方：用户能自定义瓦片地址，若不拦，
//  应用就变成了「能读内网任意 HTTP 服务的工具」（file:// 不可用，但 127.0.0.1 / 192.168.x
//  的管理口、云元数据地址 169.254.169.254 都能被探测）。所以：
//    - 只允许 https
//    - 解析出的主机名/各级跳转目标都必须不是内网/回环/链路本地
//    - 限制体积、超时、内容类型
//    - 磁盘缓存：既是离线复用，也是对瓦片服务的礼貌（少重复请求）
// ============================================================
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface TileSource {
  id: string;
  name: string;
  /** 瓦片坐标系：OSM 是 WGS-84；高德/腾讯是 GCJ-02（火星坐标） */
  datum: 'wgs84' | 'gcj02';
  /** 模板，含 {z} {x} {y}；{s} 会依次替换为 subdomains */
  url: string;
  subdomains?: string[];
  /** 必须展示的版权署名（OSM 的要求，界面要显示） */
  attribution: string;
  maxZoom: number;
  /** 说明：是官方公开服务还是非官方/自建 */
  note?: string;
}

export const BUILTIN_TILE_SOURCES: TileSource[] = [
  {
    id: 'osm',
    name: 'OpenStreetMap（国际，WGS-84）',
    datum: 'wgs84',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    note: '官方公开瓦片，个人低流量使用；已做本地缓存以减少重复请求。国内访问可能较慢。'
  },
  {
    id: 'osm-de',
    name: 'OSM 德国镜像（WGS-84）',
    datum: 'wgs84',
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    note: '备用镜像，主站不通时可切换。'
  },
  {
    id: 'amap',
    name: '高德地图（国内，GCJ-02）',
    datum: 'gcj02',
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    attribution: '© 高德地图',
    maxZoom: 18,
    note: '国内访问快、路网新。注意：这是高德面向网页的公开瓦片，非官方开放 API，仅供个人查看，请勿高频抓取。'
  }
];

export const MAX_TILE_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
/** 缓存文件数上限，超了先删最旧的（避免长期使用无限增长） */
export const MAX_CACHE_FILES = 3000;

// ---------------- SSRF 防护 ----------------

/** 判断主机名是否为内网/回环/链路本地/保留地址 */
export function isBlockedHost(hostname: string): boolean {
  const h = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  // IPv4 字面量
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true;
    if (a === 10) return true;                       // 10/8
    if (a === 127) return true;                      // 回环
    if (a === 0) return true;                        // 0/8
    if (a === 169 && b === 254) return true;         // 链路本地（含云元数据 169.254.169.254）
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true;         // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 运营商级 NAT 100.64/10
    if (a >= 224) return true;                       // 组播/保留
    return false;
  }
  // IPv6：回环、唯一本地、链路本地、以及 IPv4 映射写法
  if (h.indexOf(':') >= 0) {
    if (h === '::1' || h === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;   // fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true;   // fe80::/10
    if (/^::ffff:/.test(h)) return isBlockedHost(h.replace(/^::ffff:/, ''));
    return false;
  }
  return false;
}

/** 校验用户自定义模板：必须 https、含 {x}{y}{z}、主机不内网 */
export function validateTemplate(tpl: string): string | null {
  const s = String(tpl || '').trim();
  if (!s) return '模板不能为空';
  for (const ph of ['{x}', '{y}', '{z}']) {
    if (s.indexOf(ph) < 0) return '模板缺少占位符 ' + ph;
  }
  let u: URL;
  try {
    // 占位符会让 URL 解析失败，先替换成合法值再检查主机与协议
    u = new URL(s.replace(/\{x\}/g, '1').replace(/\{y\}/g, '1').replace(/\{z\}/g, '1').replace(/\{s\}/g, '1'));
  } catch (_) {
    return '模板不是合法 URL';
  }
  if (u.protocol !== 'https:') return '只允许 https 瓦片地址（明文 HTTP 会被中间人改写瓦片内容）';
  if (isBlockedHost(u.hostname)) return '不允许指向内网 / 本机地址（' + u.hostname + '）';
  return null;
}

export function validateTileCoords(z: unknown, x: unknown, y: unknown, maxZoom = 19): string | null {
  const zi = Number(z), xi = Number(x), yi = Number(y);
  if (!Number.isInteger(zi) || !Number.isInteger(xi) || !Number.isInteger(yi)) return '瓦片坐标必须是整数';
  if (zi < 0 || zi > maxZoom) return '缩放级别超范围（0–' + maxZoom + '）';
  const n = Math.pow(2, zi);
  if (xi < 0 || xi >= n || yi < 0 || yi >= n) return '瓦片坐标超范围';
  return null;
}

export function buildTileUrl(src: TileSource, z: number, x: number, y: number): string {
  let url = String(src.url);
  if (src.subdomains && src.subdomains.length) {
    url = url.replace(/\{s\}/g, src.subdomains[(x + y) % src.subdomains.length]);
  }
  return url
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y));
}

// ---------------- 抓取 + 缓存 ----------------

export interface TileFetchResult {
  ok: boolean;
  dataUrl?: string;
  error?: string;
  cached?: boolean;
  bytes?: number;
}

export interface FetchTileOptions {
  source: TileSource;
  z: number;
  x: number;
  y: number;
  cacheDir: string;
  /** 便于测试注入 */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function cachePathFor(cacheDir: string, sourceId: string, z: number, x: number, y: number): string {
  // 用哈希做文件名：避免路径里出现模板/密钥，也避免目录层数随着 z 增长
  const key = crypto.createHash('sha1').update(sourceId + '/' + z + '/' + x + '/' + y).digest('hex');
  return path.join(cacheDir, key + '.tile');
}

function pruneCache(cacheDir: string): void {
  try {
    const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith('.tile'));
    if (files.length <= MAX_CACHE_FILES) return;
    const withTime = files.map((f) => {
      const p = path.join(cacheDir, f);
      let t = 0;
      try { t = fs.statSync(p).mtimeMs; } catch (_) { /* 忽略 */ }
      return { p, t };
    }).sort((a, b) => a.t - b.t);
    withTime.slice(0, withTime.length - MAX_CACHE_FILES).forEach((f) => {
      try { fs.unlinkSync(f.p); } catch (_) { /* 忽略 */ }
    });
  } catch (_) { /* 缓存清理失败不影响主流程 */ }
}

/** 单跳校验：只允许 https 且主机不是内网 */
function assertAllowedHop(rawUrl: string): URL {
  let u: URL;
  try { u = new URL(rawUrl); } catch (_) { throw new Error('瓦片地址不合法'); }
  if (u.protocol !== 'https:') throw new Error('只允许 https 瓦片地址');
  if (isBlockedHost(u.hostname)) throw new Error('瓦片地址指向内网 / 本机，已拒绝（' + u.hostname + '）');
  return u;
}

export async function fetchTile(opts: FetchTileOptions): Promise<TileFetchResult> {
  const { source, z, x, y, cacheDir } = opts;
  const bad = validateTileCoords(z, x, y, source.maxZoom);
  if (bad) return { ok: false, error: bad };

  const file = cachePathFor(cacheDir, source.id, z, x, y);
  try {
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      if (buf.length > 0 && buf.length <= MAX_TILE_BYTES) {
        return { ok: true, cached: true, bytes: buf.length, dataUrl: 'data:image/png;base64,' + buf.toString('base64') };
      }
    }
  } catch (_) { /* 缓存读失败就当没有，继续联网取 */ }

  const doFetch = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs || FETCH_TIMEOUT_MS;
  let url = buildTileUrl(source, z, x, y);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let resp: Response | null = null;
    // 手动跟随跳转，每一跳都重新校验主机（否则 302 到内网就绕过了）
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = assertAllowedHop(url);
      const r = await doFetch(u.href, {
        signal: ctl.signal,
        redirect: 'manual',
        headers: {
          // 瓦片服务要求能识别客户端；也给缓存/CDN 一个正常的 UA
          'User-Agent': 'GradResumeForge/1.0 (+local desktop app; tile cache)',
          Accept: 'image/png,image/webp,image/*;q=0.8'
        }
      });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        if (hop === MAX_REDIRECTS) return { ok: false, error: '跳转次数过多' };
        url = new URL(r.headers.get('location')!, u.href).href;
        continue;
      }
      resp = r;
      break;
    }
    if (!resp) return { ok: false, error: '取瓦片失败' };
    if (!resp.ok) return { ok: false, error: '瓦片服务返回 HTTP ' + resp.status };

    const ct = String(resp.headers.get('content-type') || '');
    if (ct && ct.indexOf('image/') !== 0) return { ok: false, error: '返回内容不是图片（' + ct.slice(0, 40) + '）' };

    const ab = await resp.arrayBuffer();
    const buf = Buffer.from(ab);
    if (!buf.length) return { ok: false, error: '瓦片内容为空' };
    if (buf.length > MAX_TILE_BYTES) return { ok: false, error: '瓦片过大（' + Math.round(buf.length / 1024) + 'KB）' };

    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(file, buf);
      pruneCache(cacheDir);
    } catch (_) { /* 写缓存失败不影响本次显示 */ }

    return { ok: true, cached: false, bytes: buf.length, dataUrl: 'data:image/png;base64,' + buf.toString('base64') };
  } catch (err) {
    const e = err as Error;
    const msg = (ctl.signal.aborted || e.name === 'AbortError') ? '取瓦片超时' : String(e.message || e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** 供「清空瓦片缓存」用，返回删除的文件数 */
export function clearTileCache(cacheDir: string): number {
  let n = 0;
  try {
    for (const f of fs.readdirSync(cacheDir)) {
      if (!f.endsWith('.tile')) continue;
      try { fs.unlinkSync(path.join(cacheDir, f)); n++; } catch (_) { /* 忽略 */ }
    }
  } catch (_) { /* 目录不存在 */ }
  return n;
}

/** 缓存占用（文件数与字节数），用于在界面上如实展示 */
export function tileCacheStats(cacheDir: string): { files: number; bytes: number } {
  let files = 0, bytes = 0;
  try {
    for (const f of fs.readdirSync(cacheDir)) {
      if (!f.endsWith('.tile')) continue;
      files++;
      try { bytes += fs.statSync(path.join(cacheDir, f)).size; } catch (_) { /* 忽略 */ }
    }
  } catch (_) { /* 目录不存在 */ }
  return { files, bytes };
}
