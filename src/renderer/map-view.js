'use strict';

// ============================================================
//  投递地点与距离视图（独立模块，app.js 只负责挂载）
//
//  三层能力，从「永远可用」到「可选联网」：
//    1. 离线距离与对比：内置坐标表 + 大圆距离 + SVG 相对位置图 + 距离条形排序
//       —— 断网可用、零 API key、不发起任何网络请求
//    2. 可选在线地图：瓦片由主进程代理取回（data: URL），所以 CSP 不用放宽、渲染层仍在沙箱里
//    3. 地图点选精确坐标：点击地图把该点设为出发地或某家公司的精确位置
//
//  坐标口径：内部一律 WGS-84。瓦片源若声明 gcj02（高德/腾讯），
//  显示前会把 WGS-84 转成 GCJ-02，捕获时再转回来 —— 不然点会整体偏 500m。
// ============================================================
(function () {
  const UI = window.UI;
  const el = UI.el;

  const SETTINGS_KEY = 'map';
  const ORIGIN_FALLBACK_HINT = '还没有设置出发地';

  let _origin = null;        // { label, lat, lng, source }
  let _tileSources = null;   // { builtin:[...], hasCustom, customName }
  let _map = null;           // 在线地图状态（懒创建）

  // ---------------- 设置读写 ----------------
  async function loadOrigin(force) {
    if (_origin && !force) return _origin;
    try {
      const cfg = await UI.call(window.api.settings.get(SETTINGS_KEY));
      _origin = (cfg && cfg.origin) || null;
    } catch (_) {
      _origin = null;
    }
    return _origin;
  }

  async function saveOrigin(origin) {
    const cfg = (await UI.call(window.api.settings.get(SETTINGS_KEY))) || {};
    await UI.call(window.api.settings.save(SETTINGS_KEY, Object.assign({}, cfg, { origin: origin })));
    _origin = origin;
    return origin;
  }

  async function loadTileConfig() {
    const cfg = (await UI.call(window.api.settings.get(SETTINGS_KEY))) || {};
    return cfg.tiles || {};
  }

  async function saveTileConfig(patch) {
    const cfg = (await UI.call(window.api.settings.get(SETTINGS_KEY))) || {};
    const tiles = Object.assign({}, cfg.tiles, patch);
    await UI.call(window.api.settings.save(SETTINGS_KEY, Object.assign({}, cfg, { tiles: tiles })));
    return tiles;
  }

  // ---------------- 距离计算 ----------------
  /** 一家公司的坐标解析：手填/点选坐标优先，其次按 place 文本查表 */
  function resolveAppCoords(app) {
    if (isFinite(app.lat) && isFinite(app.lng)) {
      return { coords: [Number(app.lat), Number(app.lng)], level: app.placeSource || 'manual', label: app.place || '已定位' };
    }
    if (app.place) {
      const p = window.Geo.parseLocation(app.place);
      if (p) return { coords: p.coords, level: p.level, label: p.label };
    }
    return null;
  }

  /** 生成排序后的距离行 */
  function distanceRows(apps, origin) {
    const rows = (apps || []).map((app) => {
      const r = resolveAppCoords(app);
      const km = r && origin ? window.Geo.haversineKm(origin.coords || [origin.lat, origin.lng], r.coords) : NaN;
      return {
        app: app,
        company: app.company,
        place: (r && r.label) || app.place || '',
        coords: r ? r.coords : null,
        level: r ? r.level : null,
        km: km,
        band: window.Geo.bandOf(km)
      };
    });
    const located = rows.filter((x) => isFinite(x.km));
    located.sort((a, b) => a.km - b.km);
    const unlocated = rows.filter((x) => !isFinite(x.km));
    return { located: located, unlocated: unlocated, all: rows };
  }

  /** 给地图顶部的「一眼看懂」摘要用的统计。所有数字都基于直线距离。 */
  function distanceSummary(rows) {
    const located = (rows && rows.located) || [];
    const distances = located.map((r) => r.km).filter((km) => isFinite(km));
    const total = (rows && rows.all ? rows.all.length : 0);
    const sum = distances.reduce((a, b) => a + b, 0);
    return {
      total: total,
      located: located.length,
      missing: Math.max(0, total - located.length),
      coverage: total ? Math.round(located.length / total * 100) : 0,
      averageKm: distances.length ? sum / distances.length : NaN,
      nearest: located[0] || null,
      farthest: located[located.length - 1] || null
    };
  }

  function summaryCard(label, value, hint, tone) {
    return el('div', { class: 'mv-stat mv-stat-' + (tone || 'neutral') }, [
      el('span', { class: 'mv-stat-label' }, [label]),
      el('b', { class: 'mv-stat-value' }, [value]),
      hint ? el('span', { class: 'mv-stat-hint' }, [hint]) : null
    ]);
  }

  // ---------------- 离线对比图（SVG）----------------
  function buildCompareSvg(origin, located, width, height) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'mv-svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '各投递公司与出发地的相对位置与距离');

    const oLat = origin.coords ? origin.coords[0] : origin.lat;
    const oLng = origin.coords ? origin.coords[1] : origin.lng;
    // 等距圆柱近似：只看相对位置，城市尺度下足够
    const toXY = (lat, lng) => {
      const kmPerLng = 111.32 * Math.cos(oLat * Math.PI / 180);
      return [(lng - oLng) * kmPerLng, (lat - oLat) * 110.574];
    };
    const pts = located.map((r) => {
      const xy = toXY(r.coords[0], r.coords[1]);
      return { r: r, x: xy[0], y: xy[1] };
    });
    let maxAbs = 1;
    pts.forEach((p) => { maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y)); });
    const pad = 46;
    const half = Math.min(width, height) / 2 - pad;
    const scale = half / maxAbs;
    const cx = width / 2, cy = height / 2;

    const mk = (tag, attrs, text) => {
      const n = document.createElementNS(NS, tag);
      Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
      if (text != null) n.textContent = text;
      return n;
    };

    // 背景网格：以出发点为中心的十字 + 同心参考圈
    svg.appendChild(mk('circle', { cx: cx, cy: cy, r: 3, fill: 'none', stroke: 'transparent' }));
    for (const f of [0.33, 0.66, 1]) {
      svg.appendChild(mk('circle', { cx: cx, cy: cy, r: half * f, fill: 'none', stroke: 'var(--line, #2a2f3a)', 'stroke-dasharray': '3 5', 'stroke-width': 1, opacity: 0.5 }));
    }
    svg.appendChild(mk('line', { x1: 0, y1: cy, x2: width, y2: cy, stroke: 'var(--line, #2a2f3a)', 'stroke-width': 1, opacity: 0.35 }));
    svg.appendChild(mk('line', { x1: cx, y1: 0, x2: cx, y2: height, stroke: 'var(--line, #2a2f3a)', 'stroke-width': 1, opacity: 0.35 }));

    // 连线 + 公司点
    pts.forEach((p) => {
      const px = cx + p.x * scale, py = cy - p.y * scale;
      const band = p.r.band;
      svg.appendChild(mk('line', { x1: cx, y1: cy, x2: px, y2: py, stroke: 'currentColor', 'stroke-width': 1, opacity: 0.25 }));
      const dot = mk('circle', { cx: px, cy: py, r: 5, class: 'mv-dot mv-band-' + band.key });
      dot.appendChild(mk('title', {}, p.r.company + ' · ' + p.r.place + ' · 直线 ' + window.Geo.formatDistance(p.r.km)));
      svg.appendChild(dot);
      const t = mk('text', { x: px, y: py - 10, class: 'mv-label', 'text-anchor': 'middle' }, window.Geo.formatDistance(p.r.km));
      svg.appendChild(t);
      const t2 = mk('text', { x: px, y: py + 18, class: 'mv-sublabel', 'text-anchor': 'middle' }, p.r.company.slice(0, 8));
      svg.appendChild(t2);
    });

    // 出发点
    svg.appendChild(mk('circle', { cx: cx, cy: cy, r: 8, class: 'mv-origin' }));
    svg.appendChild(mk('text', { x: cx, y: cy - 14, class: 'mv-origin-label', 'text-anchor': 'middle' }, origin.label || '出发地'));

    // 比例尺：取一个「好看」的整数值
    const wantKm = maxAbs / 2;
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
    let unit = nice[nice.length - 1];
    for (const n of nice) { if (n >= wantKm) { unit = n; break; } }
    const barPx = unit * scale;
    const bx = 16, by = height - 18;
    svg.appendChild(mk('line', { x1: bx, y1: by, x2: bx + barPx, y2: by, stroke: 'currentColor', 'stroke-width': 2, opacity: 0.7 }));
    svg.appendChild(mk('line', { x1: bx, y1: by - 4, x2: bx, y2: by + 4, stroke: 'currentColor', 'stroke-width': 2, opacity: 0.7 }));
    svg.appendChild(mk('line', { x1: bx + barPx, y1: by - 4, x2: bx + barPx, y2: by + 4, stroke: 'currentColor', 'stroke-width': 2, opacity: 0.7 }));
    svg.appendChild(mk('text', { x: bx, y: by - 8, class: 'mv-sublabel' }, unit + ' km'));
    return svg;
  }

  // ---------------- 地图交互数学（纯函数：单测与诊断脚本共用）----------------
  // 这几个函数不碰 DOM，输入输出都是 WGS-84 [lat, lng]；
  // datum 只决定「和哪个坐标系的瓦片源对齐」，内部会来回换算。

  /** 限制缩放级别（滚轮/捏合/按钮/键盘全部经过它，杜绝 3 级以下或超过源上限） */
  function clampZoom(z, min, max) {
    return Math.max(min, Math.min(max, z));
  }

  /**
   * 锚点缩放：视图从 zoom 变到 nextZoom 后，(anchorPx, anchorPy) 这个画布点
   * 下面的地理点保持不动 —— 高德/腾讯「指哪缩哪」就是这一条。
   * nextZoom 可以是小数（触控板连续滚动时的实时缩放）。
   *
   * 推导：世界像素随级别等比放大 s=2^(z1-z0)。锚点在 z0 的世界像素 wp=cp0+off，
   * 在 z1 变成 s·wp；要求它仍落在锚点处：s·wp = cp1+off
   * ⇒ cp1 = s·cp0 + (s-1)·off。
   */
  function zoomAroundCenter(centerLat, centerLng, zoom, anchorPx, anchorPy, nextZoom, W, H, datum) {
    const d0 = window.Geo.fromWgs84(centerLat, centerLng, datum);
    const c0 = window.Geo.lngLatToWorldPixel(d0[1], d0[0], zoom);
    const s = Math.pow(2, nextZoom - zoom);
    const c1x = s * c0[0] + (s - 1) * (anchorPx - W / 2);
    const c1y = s * c0[1] + (s - 1) * (anchorPy - H / 2);
    const ll = window.Geo.worldPixelToLngLat(c1x, c1y, nextZoom);
    const w = window.Geo.toWgs84(ll[0], ll[1], datum);
    return [w[0], w[1]];
  }

  /**
   * 平移：视图沿画布方向移动 (dxPx, dyPx) 像素（dx>0 = 地图跟手向右 = 视野西移）。
   * 拖动、惯性、方向键都走它 —— 「手指走多少、地图走多少」只准有一个实现。
   */
  function panCenterByPixels(centerLat, centerLng, zoom, dxPx, dyPx, datum) {
    const d = window.Geo.fromWgs84(centerLat, centerLng, datum);
    const c = window.Geo.lngLatToWorldPixel(d[1], d[0], zoom);
    const ll = window.Geo.worldPixelToLngLat(c[0] - dxPx, c[1] - dyPx, zoom);
    const w = window.Geo.toWgs84(ll[0], ll[1], datum);
    return [w[0], w[1]];
  }

  /** 某纬度某级别下每像素代表多少米（比例尺用） */
  function metersPerPixel(lat, z) {
    return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
  }

  /** 比例尺取整到 1/2/5×10^n，条长落在 45–130px（和高德一样不跳变） */
  function niceScaleBar(mpp) {
    const cands = [];
    // 上探到 1000km：z3 全国视野每像素约 20km，500km 只有 25px 会短于下限
    for (let e = 0; e <= 6; e++) cands.push(1 * Math.pow(10, e), 2 * Math.pow(10, e), 5 * Math.pow(10, e));
    let pick = cands[0];
    for (const u of cands) { if (u / mpp <= 130) pick = u; else break; }
    let px = pick / mpp;
    if (px < 45) {
      const i = Math.min(cands.indexOf(pick) + 1, cands.length - 1);
      pick = cands[i];
      px = pick / mpp;
    }
    return { unit: pick, px: px };
  }

  function fmtMeters(m) {
    return m >= 1000 ? (Math.round(m / 100) / 10) + ' km' : Math.round(m) + ' m';
  }

  // ---------------- 在线地图：对标高德/腾讯的交互 ----------------
  //  拖动：transform 实时跟手；每滑出 ~110px 或松手才真正重取瓦片
  //        （旧实现每动一格就清空重取，所以「滑动繁琐」）
  //  缩放：滚轮/双击/按钮/双指捏合统一走锚点缩放 + 过渡动画，「指哪缩哪」
  //  惯性：松手按速度衰减继续滑；双击/方向键/按钮全部有动画
  //  状态：左下角实时中心坐标 + 比例尺，右下角悬浮缩放按钮
  function createMap(host, ctx) {
    const state = {
      center: null,          // [lat, lng] WGS-84（已提交，瓦片按它铺）
      viewCenter: null,      // 拖动/缩放实时中心（可小数级别下的对应中心）
      zoom: 11,              // 已提交的瓦片级别（整数）
      viewZoom: 11,          // 实时缩放级别（可小数）
      sourceId: ctx.sourceId || 'osm',
      datum: ctx.datum || 'wgs84',
      maxZoom: ctx.maxZoom || 19,
      tiles: new Map(),      // key -> img（只含当前 layer 的）
      markers: [],
      target: ctx.target || { type: 'origin' },
      dragging: false,
      pointers: new Map(),   // pointerId -> [clientX, clientY]（双指捏合）
      pinch: null,
      last: null,
      moved: 0,
      dragBase: [0, 0],      // 距上次「落账」的累计像素
      velocity: [0, 0],
      lastMoveT: 0,          // 上次 pointermove 的时间戳（判断松手前是否已停住）
      gestureZoom: [1, 1],   // 手势开始时的窗口缩放（视觉px/布局px）：client 增量要除掉它才是画布像素
      wheelAcc: 0,           // 滚轮累积的缩放量（格）
      wheelAx: 0, wheelAy: 0,
      wheelTimer: null,
      pickTimer: null,
      momentum: 0,           // rAF id
      renderToken: 0,
      inflight: 0,
      queue: [],
      loaded: 0,
      failed: 0,
      queued: 0,
      lastError: ''
    };
    const W = 768, H = 420;
    const NS = 'http://www.w3.org/2000/svg';
    const MIN_ZOOM = 3;
    const clampZ = (z) => clampZoom(z, MIN_ZOOM, state.maxZoom);

    const wrap = el('div', { class: 'mv-map-wrap' });
    const canvas = el('div', {
      class: 'mv-map-canvas', tabindex: '0', role: 'application',
      'aria-label': '投递地图：拖动平移，滚轮或双击缩放，双指捏合缩放，方向键移动，+/- 缩放，0 显示全部'
    });
    let layer = el('div', { class: 'mv-map-tiles' });
    let overlay = createOverlaySvg();
    const readout = el('div', { class: 'mv-map-readout' });
    const scaleLabel = el('span', { class: 'mv-map-scale-label' });
    const scaleFill = el('i', { class: 'mv-map-scale-bar' });
    const scalebar = el('div', { class: 'mv-map-scale' }, [scaleLabel, scaleFill]);
    const stack = el('div', { class: 'mv-map-stack' });
    canvas.appendChild(layer);
    canvas.appendChild(overlay);
    canvas.appendChild(readout);
    canvas.appendChild(scalebar);
    canvas.appendChild(stack);
    wrap.appendChild(canvas);
    const status = el('div', { class: 'mv-map-status' });
    wrap.appendChild(status);
    host.appendChild(wrap);

    // 悬浮按钮：点它不该被当成「在地图上点选」，所以 pointer/dbl 事件要拦住
    stack.addEventListener('pointerdown', (e) => e.stopPropagation());
    stack.addEventListener('dblclick', (e) => e.stopPropagation());
    const stackBtn = (title, text, fn) => {
      const b = el('button', { type: 'button', title: title }, [text]);
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      stack.appendChild(b);
      return b;
    };
    stackBtn('放大一级', '＋', () => zoomBy(1));
    stackBtn('缩小一级', '－', () => zoomBy(-1));
    if (ctx.home) stackBtn('回到' + (ctx.homeLabel || '出发地'), '◎', () => {
      recenter(ctx.home[0], ctx.home[1], Math.max(state.zoom, 12));
    });
    stackBtn('显示全部投递点', '⤢', () => fitAll());

    const datumCenter = () => window.Geo.fromWgs84(state.viewCenter[0], state.viewCenter[1], state.datum);

    /**
     * 客户端坐标 → 画布坐标（0..768 / 0..420）。
     * 两个坑都踩过，别再踩：
     *   1. 边框：rect.left 是边框外沿，内容坐标要扣掉 clientLeft；
     *   2. 缩放：窗口/页面可能有分数缩放（实测 769.33/770），rect 是视觉像素、
     *      clientLeft/clientWidth 是布局像素，直接混用会差一个缩放因子。
     * 用 offsetWidth（布局边框盒）从 rect 反推缩放，再统一换算。
     */
    function toCanvasPx(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const zx = canvas.offsetWidth ? rect.width / canvas.offsetWidth : 1;
      const zy = canvas.offsetHeight ? rect.height / canvas.offsetHeight : 1;
      const bx = canvas.clientLeft * zx, by = canvas.clientTop * zy;
      const cw = canvas.clientWidth * zx, ch = canvas.clientHeight * zy;
      return [
        (clientX - rect.left - bx) * (W / cw),
        (clientY - rect.top - by) * (H / ch)
      ];
    }

    function createOverlaySvg() {
      const s = document.createElementNS(NS, 'svg');
      s.setAttribute('class', 'mv-map-overlay');
      s.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      return s;
    }

    function project(latW, lngW) {
      // 先把 WGS-84 转成瓦片源的坐标系，再做像素投影；否则 gcj02 源会整体偏移
      const d = window.Geo.fromWgs84(latW, lngW, state.datum);
      const p = window.Geo.lngLatToWorldPixel(d[1], d[0], state.viewZoom);
      const c = datumCenter();
      const cp = window.Geo.lngLatToWorldPixel(c[1], c[0], state.viewZoom);
      return [p[0] - cp[0] + W / 2, p[1] - cp[1] + H / 2];
    }

    function unproject(px, py) {
      const c = datumCenter();
      const cp = window.Geo.lngLatToWorldPixel(c[1], c[0], state.viewZoom);
      const d = window.Geo.worldPixelToLngLat(cp[0] + (px - W / 2), cp[1] + (py - H / 2), state.viewZoom);
      return window.Geo.toWgs84(d[0], d[1], state.datum); // GCJ-02 源取到的点要转回 WGS-84 再存
    }

    /** 瓦片并发泵：最多 6 个在途，token 不匹配的晚到响应直接丢弃 */
    function pump() {
      while (state.inflight < 6 && state.queue.length) {
        const job = state.queue.shift();
        state.inflight++;
        window.api.map.tile(state.sourceId, job.z, job.x, job.y).then((res) => {
          // 缩放、拖动或切换底图后，旧请求可能晚于新一轮返回；旧瓦片不能再写入当前图层。
          if (job.token !== state.renderToken) return;
          if (res && res.ok && res.data && res.data.dataUrl) {
            const img = el('img', { class: 'mv-tile', src: res.data.dataUrl, alt: '' });
            img.style.left = job.left + 'px';
            img.style.top = job.top + 'px';
            layer.appendChild(img);
            state.tiles.set(job.key, img);
            state.loaded++;
          } else {
            state.failed++;
            // 记下具体原因：否则界面上只会说「取不回来」，用户无法判断是没网、被墙还是源配错了
            state.lastError = (res && res.error) || '网络不可用';
          }
        }).catch((err) => {
          if (job.token === state.renderToken) {
            state.failed++;
            state.lastError = (err && err.message) || '网络不可用';
          }
        })
          .then(() => { state.inflight--; pump(); });
      }
      updateStatus();
    }

    function updateStatus() {
      const bits = [];
      if (state.inflight > 0) bits.push('加载中 ' + state.inflight);
      if (state.failed > 0) bits.push('失败 ' + state.failed);
      status.textContent = bits.length ? bits.join(' · ') : '';
      if (state.loaded === 0 && state.failed > 0) {
        // 别只说「取不回来」——用户无从判断该换源还是该查网络，直接把下一步给出来
        status.textContent = '瓦片取不回来：' + (state.lastError || '网络不可用') +
          '（不影响上面的离线距离对比；可在上方换个瓦片源再试，国内一般选高德）';
      }
    }

    function renderTiles() {
      state.renderToken++;
      layer.innerHTML = '';
      state.tiles.clear();
      state.queue = [];
      state.loaded = 0;
      state.failed = 0;
      const z = state.zoom;
      const c = window.Geo.fromWgs84(state.center[0], state.center[1], state.datum);
      const cp = window.Geo.lngLatToWorldPixel(c[1], c[0], z);
      const originX = cp[0] - W / 2, originY = cp[1] - H / 2;
      // 四周各多取一圈：拖动时最多 110px 不落账，多这一圈才不会露出画布底色
      const x0 = Math.floor(originX / 256) - 1, x1 = Math.floor((originX + W) / 256) + 1;
      const y0 = Math.floor(originY / 256) - 1, y1 = Math.floor((originY + H) / 256) + 1;
      const n = Math.pow(2, z);
      let queued = 0;
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          if (y < 0 || y >= n) continue;
          const wrapX = ((x % n) + n) % n; // 经度方向环绕
          state.queue.push({
            key: z + '/' + wrapX + '/' + y, z: z, x: wrapX, y: y,
            left: Math.round(x * 256 - originX), top: Math.round(y * 256 - originY),
            token: state.renderToken
          });
          queued++;
        }
      }
      state.queued = queued;
      pump();
      drawOverlay();
      updateReadout();
    }

    /**
     * 把「瓦片层 + 标注层」整体换成新的一对，旧的原地淡出。
     * 为什么要换掉旧的而不是清空重铺：落账（拖动结束/缩放提交）时直接清空会闪一下空白；
     * 旧层带着当前 transform 原地退场、新层按目标视图淡入，观感就是连续的。
     * 返回被换掉的旧层（没有内容可演时返回 null，调用方不应再碰它）。
     */
    function swapViews() {
      const ghostLayer = layer, ghostOverlay = overlay;
      if (!ghostLayer.firstChild && !ghostOverlay.firstChild) return null; // 首次渲染：没什么可演出的
      layer = el('div', { class: 'mv-map-tiles' });
      overlay = createOverlaySvg();
      canvas.insertBefore(layer, ghostLayer);
      canvas.insertBefore(overlay, ghostOverlay);
      ghostLayer.classList.add('mv-map-ghost');
      ghostOverlay.classList.add('mv-map-ghost');
      let waited = 0;
      const timer = setInterval(() => {
        waited += 100;
        if (!ghostLayer.parentNode && !ghostOverlay.parentNode) { clearInterval(timer); return; }
        // 新瓦片到位旧的才退；网络慢最多等 900ms，不能让它一直盖在上面
        if (state.loaded + state.failed >= state.queued || waited >= 900) {
          clearInterval(timer);
          [ghostLayer, ghostOverlay].forEach((g) => {
            if (!g.parentNode) return;
            g.style.transition = 'opacity .18s ease-out';
            g.style.opacity = '0';
            setTimeout(() => { if (g.parentNode) g.parentNode.removeChild(g); }, 220);
          });
        }
      }, 100);
      return { layer: ghostLayer, overlay: ghostOverlay };
    }

    /**
     * 动画式切换视图（滚轮落账、双击、按钮、方向键、捏合落账、fitAll 全走这里）。
     * 数学：旧布局绕画布中心缩放 s=2^(z1-z0) 再平移 t=s·cp0-cp1，
     * 结束时旧层的观感与新层（按 center1/zoom1 铺的瓦片）逐像素重合，所以交叉淡入看不出接缝。
     */
    function animateTo(center1, zoom1, dur) {
      const c0 = state.center, z0 = state.zoom;
      const z1 = clampZ(zoom1);
      if (c0 && z1 === z0 && c0[0] === center1[0] && c0[1] === center1[1]) return;
      const s = Math.pow(2, z1 - z0);
      const d0 = window.Geo.fromWgs84(c0[0], c0[1], state.datum);
      const cp0 = window.Geo.lngLatToWorldPixel(d0[1], d0[0], z0);
      const d1 = window.Geo.fromWgs84(center1[0], center1[1], state.datum);
      const cp1 = window.Geo.lngLatToWorldPixel(d1[1], d1[0], z1);
      const tx = s * cp0[0] - cp1[0], ty = s * cp0[1] - cp1[1];
      const ghost = swapViews();
      state.zoom = z1;
      state.center = [center1[0], center1[1]];
      state.viewCenter = state.center.slice();
      state.viewZoom = z1;
      if (ghost) {
        // 旧瓦片层和旧标注层一起从当前观感过渡到目标观感；
        // 没有旧层可演时（首次渲染）直接铺新的，不做变换
        const tf = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
        [ghost.layer, ghost.overlay].forEach((g) => {
          g.style.transformOrigin = (W / 2) + 'px ' + (H / 2) + 'px';
          g.style.transition = 'transform ' + (dur || 220) + 'ms cubic-bezier(.22,.61,.36,1)';
          g.style.transform = tf;
        });
      }
      renderTiles();
    }

    function recenter(lat, lng, zoom) {
      animateTo([lat, lng], zoom || state.zoom);
    }

    function zoomBy(delta) {
      const z1 = clampZ(state.zoom + delta);
      if (z1 === state.zoom) return false;
      // 按钮/键盘没有「手指下的点」，绕视野中心缩
      const next = zoomAroundCenter(state.center[0], state.center[1], state.zoom, W / 2, H / 2, z1, W, H, state.datum);
      animateTo(next, z1);
      return true;
    }

    function fitAll() {
      const points = [];
      if (_origin) points.push([_origin.coords ? _origin.coords[0] : _origin.lat, _origin.coords ? _origin.coords[1] : _origin.lng]);
      (ctx.located || []).forEach((r) => { if (r.coords) points.push(r.coords); });
      if (!points.length) return false;
      let best = 3;
      let center = points[0];
      for (let z = 3; z <= state.maxZoom; z++) {
        const ps = points.map((ll) => {
          const d = window.Geo.fromWgs84(ll[0], ll[1], state.datum);
          return window.Geo.lngLatToWorldPixel(d[1], d[0], z);
        });
        const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
        const fits = Math.max(...xs) - Math.min(...xs) <= W - 72 && Math.max(...ys) - Math.min(...ys) <= H - 72;
        if (!fits) break;
        best = z;
        const mid = window.Geo.worldPixelToLngLat((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, z);
        center = window.Geo.toWgs84(mid[0], mid[1], state.datum);
      }
      animateTo(center, best);
      return true;
    }

    function drawOverlay() {
      const NS2 = NS;
      overlay.innerHTML = '';
      const mk = (tag, attrs, text) => {
        const n = document.createElementNS(NS2, tag);
        Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
        if (text != null) n.textContent = text;
        return n;
      };
      // 出发点
      if (_origin) {
        const p = project(_origin.coords ? _origin.coords[0] : _origin.lat, _origin.coords ? _origin.coords[1] : _origin.lng);
        if (p[0] > -40 && p[0] < W + 40 && p[1] > -40 && p[1] < H + 40) {
          const c = mk('circle', { cx: p[0], cy: p[1], r: 7, class: 'mv-origin' });
          c.appendChild(mk('title', {}, '出发地：' + (_origin.label || '')));
          overlay.appendChild(c);
          overlay.appendChild(mk('text', { x: p[0], y: p[1] - 13, class: 'mv-origin-label', 'text-anchor': 'middle' }, '出发地'));
        }
      }
      // 各公司
      (ctx.located || []).forEach((r) => {
        if (!r.coords) return;
        const p = project(r.coords[0], r.coords[1]);
        if (p[0] < -40 || p[0] > W + 40 || p[1] < -40 || p[1] > H + 40) return;
        const c = mk('circle', { cx: p[0], cy: p[1], r: 5, class: 'mv-dot mv-band-' + r.band.key });
        c.appendChild(mk('title', {}, r.company + ' · 直线 ' + window.Geo.formatDistance(r.km)));
        overlay.appendChild(c);
        overlay.appendChild(mk('text', { x: p[0], y: p[1] - 10, class: 'mv-sublabel', 'text-anchor': 'middle' }, r.company.slice(0, 8)));
      });
    }

    // ---------- 状态行：实时中心坐标 + 比例尺 ----------
    function fmtLl(ll) { return ll[0].toFixed(4) + ', ' + ll[1].toFixed(4); }
    function updateReadout(hoverLl) {
      const c = state.viewCenter || state.center;
      if (!c) return;
      const z = state.viewZoom;
      const zText = Math.round(z * 10) % 10 === 0 ? String(Math.round(z)) : (Math.round(z * 10) / 10).toFixed(1);
      let text = '中心 ' + fmtLl(c) + ' · ' + zText + ' 级';
      if (hoverLl) text += ' · 指针 ' + fmtLl(hoverLl);
      readout.textContent = text;
      const bar = niceScaleBar(metersPerPixel(c[0], z));
      scaleLabel.textContent = fmtMeters(bar.unit);
      scaleFill.style.width = Math.max(30, Math.round(bar.px)) + 'px';
    }

    // ---------- 拖动 / 捏合 / 惯性 ----------
    function applyDragTransform() {
      const b = state.dragBase;
      const t = 'translate(' + b[0] + 'px,' + b[1] + 'px)';
      layer.style.transform = t;
      overlay.style.transform = t;
    }

    /** 把跟手的像素落账成新中心并重取瓦片；旧层原地淡出，观感不变（瓦片已在手指下） */
    function commitDragChunk() {
      const b = state.dragBase;
      if (!b[0] && !b[1]) return;
      state.center = panCenterByPixels(state.center[0], state.center[1], state.zoom, b[0], b[1], state.datum);
      state.viewCenter = state.center.slice();
      state.dragBase = [0, 0];
      // 旧层带着 translate(b) 原样退场：它此刻的位置和新层（按新中心铺）逐像素重合，
      // 所以既不会闪白也不会跳。直接清空 layer 才会闪。
      swapViews();
      renderTiles();
    }

    function cancelMomentum() {
      if (state.momentum) { cancelAnimationFrame(state.momentum); state.momentum = 0; }
    }

    function startMomentum(v0) {
      let vx = v0[0], vy = v0[1];
      const t0 = performance.now();
      const step = () => {
        const now = performance.now();
        const dt = Math.min(48, now - (state._lastFrame || t0));
        state._lastFrame = now;
        const k = Math.pow(0.94, dt / 16.67); // 帧率无关的衰减
        vx *= k; vy *= k;
        if (Math.hypot(vx, vy) < 0.2 || now - t0 > 1000) {
          state.momentum = 0;
          commitDragChunk();
          return;
        }
        state.dragBase[0] += vx * dt / 16.67;
        state.dragBase[1] += vy * dt / 16.67;
        applyDragTransform();
        if (Math.abs(state.dragBase[0]) > 110 || Math.abs(state.dragBase[1]) > 110) commitDragChunk();
        state.momentum = requestAnimationFrame(step);
      };
      cancelMomentum();
      state._lastFrame = t0;
      state.momentum = requestAnimationFrame(step);
    }

    function handlePinch() {
      const pts = Array.from(state.pointers.values());
      if (pts.length < 2 || !state.pinch) return;
      const dist = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      const ratio = dist / (state.pinch.dist || 1);
      const viewZ = clampZ(state.pinch.zoom * ratio);
      const p = toCanvasPx((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
      const mx = p[0], my = p[1];
      state.pinch.ax = mx; state.pinch.ay = my;
      state.viewCenter = zoomAroundCenter(state.pinch.center[0], state.pinch.center[1], state.pinch.zoom, mx, my, viewZ, W, H, state.datum);
      state.viewZoom = viewZ;
      const s = Math.pow(2, viewZ - state.zoom);
      layer.style.transformOrigin = mx + 'px ' + my + 'px';
      layer.style.transform = 'scale(' + s + ')';
      overlay.style.transformOrigin = mx + 'px ' + my + 'px';
      overlay.style.transform = 'scale(' + s + ')';
      updateReadout();
    }

    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      cancelMomentum();
      // 上一段滚动/拖动可能还有没落账的像素：先落账再开新手势，
      // 否则 transform 被新事件覆盖时那些像素会凭空丢掉（观感就是地图跳一下）
      if (state.wheelTimer) { clearTimeout(state.wheelTimer); state.wheelTimer = null; commitWheel(); }
      commitDragChunk();
      clearTimeout(state.pickTimer);
      state.pickTimer = null;
      state.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (state.pointers.size === 2) {
        // 双指：进入捏合缩放，同时放弃拖动
        state.dragging = false;
        canvas.classList.remove('dragging');
        const pts = Array.from(state.pointers.values());
        state.pinch = {
          dist: Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) || 1,
          zoom: state.viewZoom,
          center: (state.viewCenter || state.center).slice(),
          ax: W / 2, ay: H / 2
        };
        return;
      }
      state.pinch = null;
      state.dragging = true;
      state.last = [e.clientX, e.clientY];
      state.moved = 0;
      state.dragBase = [0, 0];
      state.velocity = [0, 0];
      state.lastMoveT = performance.now();
      // 手势开始时量一次窗口缩放。clientX 是视觉像素，而 dragBase 既要当
      // transform 的布局像素用、又要当画布像素落账——不换算的话，分数缩放
      // （实测 769.33/770）下每 160px 拖动会差 0.14px，落账位置系统性偏。
      const rect0 = canvas.getBoundingClientRect();
      state.gestureZoom = [
        canvas.offsetWidth ? rect0.width / canvas.offsetWidth : 1,
        canvas.offsetHeight ? rect0.height / canvas.offsetHeight : 1
      ];
      layer.style.transition = '';
      canvas.classList.add('dragging');
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* older WebView */ }
    };

    const onPointerMove = (e) => {
      if (state.pointers.has(e.pointerId)) state.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (state.pinch && state.pointers.size >= 2) { handlePinch(); return; }
      if (!state.dragging) {
        // 悬停读出指针经纬度（高德左下角那套），帮用户判断「这是哪」；只在画布上更新
        if (!canvas.contains(e.target)) return;
        const p = toCanvasPx(e.clientX, e.clientY);
        updateReadout(unproject(p[0], p[1]));
        return;
      }
      // 客户端（视觉）增量 → 画布像素：除掉手势开始时的窗口缩放，
      // 这样「手指走多少、地图走多少」在分数缩放下也逐像素准确
      const k = state.gestureZoom;
      const dx = (e.clientX - state.last[0]) / k[0], dy = (e.clientY - state.last[1]) / k[1];
      state.last = [e.clientX, e.clientY];
      state.lastMoveT = performance.now();
      state.moved += Math.abs(dx) + Math.abs(dy);
      state.dragBase[0] += dx;
      state.dragBase[1] += dy;
      // 指数平滑速度：松手那一下的甩动惯性用它
      state.velocity[0] = state.velocity[0] * 0.72 + dx * 0.28;
      state.velocity[1] = state.velocity[1] * 0.72 + dy * 0.28;
      applyDragTransform();
      // 拖动过程中状态行显示「手指下的新中心」，不是还没落账的旧中心
      const preview = panCenterByPixels(state.center[0], state.center[1], state.zoom, state.dragBase[0], state.dragBase[1], state.datum);
      updateReadout(preview);
      if (Math.abs(state.dragBase[0]) > 110 || Math.abs(state.dragBase[1]) > 110) commitDragChunk();
    };

    const onPointerUp = (e) => {
      state.pointers.delete(e.pointerId);
      if (state.pinch) {
        if (state.pointers.size >= 2) return;
        // 捏合结束：把实时缩放落到整数级
        const p = state.pinch;
        state.pinch = null;
        state.dragging = false;
        canvas.classList.remove('dragging');
        const z1 = clampZ(Math.round(state.viewZoom));
        if (z1 !== state.zoom) {
          const next = zoomAroundCenter(state.center[0], state.center[1], state.zoom, p.ax, p.ay, z1, W, H, state.datum);
          animateTo(next, z1);
        } else {
          // 捏合幅度不足一级：平滑退回已提交视图（同 snapBackView，不重画标注）
          state.viewCenter = state.center.slice();
          state.viewZoom = state.zoom;
          layer.style.transition = 'transform .16s ease-out';
          layer.style.transform = '';
          overlay.style.transition = 'transform .16s ease-out';
          overlay.style.transform = '';
          setTimeout(() => { layer.style.transition = ''; overlay.style.transition = ''; }, 180);
          updateReadout();
        }
        return;
      }
      if (!state.dragging) return;
      state.dragging = false;
      canvas.classList.remove('dragging');
      const speed = Math.hypot(state.velocity[0], state.velocity[1]);
      // 松手前指针已经停了一会儿（>100ms）就不甩：慢拖要能精准落点，
      // 只有真的「甩」出去才惯性滑行 —— 和高德的行为一致
      const stale = !state.lastMoveT || (performance.now() - state.lastMoveT) > 100;
      if (state.moved >= 4 && speed > 1.2 && !stale) {
        startMomentum(state.velocity);
        return;
      }
      if (state.moved < 4) {
        // 单击取坐标；延迟 230ms 落定，双击时取消第二次（否则双击会连着选两次点）
        const p = toCanvasPx(e.clientX, e.clientY);
        const ll = unproject(p[0], p[1]);
        const target = state.target;
        state.pickTimer = setTimeout(() => {
          state.pickTimer = null;
          ctx.onPick(ll, target);
        }, 230);
      } else {
        commitDragChunk();
      }
    };

    const onPointerCancel = (e) => {
      state.pointers.delete(e.pointerId);
      state.pinch = null;
      if (state.dragging) {
        state.dragging = false;
        canvas.classList.remove('dragging');
        commitDragChunk();
      }
    };

    const onWheel = (e) => {
      e.preventDefault();
      cancelMomentum();
      // 拖动没松手就滚轮（或反过来）：先把跟手像素落账，别让缩放 transform 把它盖掉
      commitDragChunk();
      clearTimeout(state.wheelTimer);
      const p = toCanvasPx(e.clientX, e.clientY);
      const ax = p[0], ay = p[1];
      // deltaMode：0=像素；1=行（一屏约 33px，Firefox 默认）；2=页
      const step = e.deltaMode === 1 ? e.deltaY * 33 : (e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY);
      // 一「格」（≈100px）= 一级；触控板连续小增量累积成小数级，松手后取整
      state.wheelAcc = clampZoom(state.wheelAcc + (-step / 100), -2.5, 2.5);
      state.wheelAx = ax; state.wheelAy = ay;
      const z0 = state.zoom;
      const viewZ = clampZ(z0 + state.wheelAcc);
      // 锚点固定：鼠标底下那个点不动（高德/腾讯的手感核心）
      state.viewCenter = zoomAroundCenter(state.center[0], state.center[1], z0, ax, ay, viewZ, W, H, state.datum);
      state.viewZoom = viewZ;
      const s = Math.pow(2, viewZ - z0);
      // 100ms 缓动：连续滚动时一级一级是「胀」上去的，不是硬跳（落账时由 animateTo 接管）
      layer.style.transition = 'transform .1s ease-out';
      layer.style.transformOrigin = ax + 'px ' + ay + 'px';
      layer.style.transform = 'translate(0px,0px) scale(' + s + ')';
      // 标注层做同样的变换（不重画）：已提交的标注绕锚点缩放后，与小数级别下的真实位置一致
      overlay.style.transformOrigin = ax + 'px ' + ay + 'px';
      overlay.style.transform = 'translate(0px,0px) scale(' + s + ')';
      updateReadout();
      state.wheelTimer = setTimeout(commitWheel, 150);
    };

    function snapBackView() {
      state.viewCenter = state.center.slice();
      state.viewZoom = state.zoom;
      // 只撤变换、不重画标注：手势中标注一直是「已提交位置 + 变换」，
      // 把变换平滑退回identity，就是这次滚轮/捏合的精确倒放
      layer.style.transition = 'transform .16s ease-out';
      layer.style.transform = '';
      overlay.style.transition = 'transform .16s ease-out';
      overlay.style.transform = '';
      setTimeout(() => { layer.style.transition = ''; overlay.style.transition = ''; }, 180);
      updateReadout();
    }

    function commitWheel() {
      const acc = state.wheelAcc;
      state.wheelAcc = 0;
      const z0 = state.zoom;
      if (Math.abs(acc) < 0.04) { snapBackView(); return; }
      const z1 = clampZ(Math.round(z0 + acc));
      if (z1 === z0) { snapBackView(); return; }
      const next = zoomAroundCenter(state.center[0], state.center[1], z0, state.wheelAx, state.wheelAy, z1, W, H, state.datum);
      animateTo(next, z1);
    }

    const onDblClick = (e) => {
      // 双击的第二次单击不许再触发点选
      clearTimeout(state.pickTimer);
      state.pickTimer = null;
      // 双击前若还有没落账的滚轮缩放，先落账：否则 wheelAcc 残留会让下一次滚动跳级
      if (state.wheelTimer) { clearTimeout(state.wheelTimer); state.wheelTimer = null; commitWheel(); }
      const p = toCanvasPx(e.clientX, e.clientY);
      const ax = p[0], ay = p[1];
      const z1 = clampZ(state.zoom + 1);
      const next = zoomAroundCenter(state.center[0], state.center[1], state.zoom, ax, ay, z1, W, H, state.datum);
      animateTo(next, z1);
    };

    const onKeyDown = (e) => {
      const panStep = e.shiftKey ? 220 : 90;
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft': panByPixels(-panStep, 0); break;
        case 'ArrowRight': panByPixels(panStep, 0); break;
        case 'ArrowUp': panByPixels(0, -panStep); break;
        case 'ArrowDown': panByPixels(0, panStep); break;
        case '+': case '=': zoomBy(1); break;
        case '-': case '_': zoomBy(-1); break;
        case '0': case 'f': case 'F': fitAll(); break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    };

    function panByPixels(dx, dy) {
      // 键盘平移也带动画（纯平移：s=1，只剩 translate 过渡）
      const next = panCenterByPixels(state.center[0], state.center[1], state.zoom, dx, dy, state.datum);
      animateTo(next, state.zoom, 170);
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('keydown', onKeyDown);

    state.center = ctx.center || [35.0, 105.0];
    state.zoom = ctx.zoom || 11;
    if (ctx.center) state.zoom = ctx.zoom || 12;
    state.viewCenter = state.center.slice();
    state.viewZoom = state.zoom;
    if (ctx.fitAll) {
      // 没有任何已定位点时，仍需显示全国默认视野。
      if (!fitAll()) renderTiles();
    } else renderTiles();
    updateReadout();

    const api = {
      state: state,
      project: project,
      unproject: unproject,
      px: toCanvasPx,
      setTarget: (t) => { state.target = t; },
      setSource: (id, datum, maxZoom) => {
        state.sourceId = id; state.datum = datum; state.maxZoom = maxZoom;
        state.viewCenter = state.center.slice();
        state.viewZoom = state.zoom;
        renderTiles();
      },
      recenter: recenter,
      zoomBy: zoomBy,
      fitAll: fitAll,
      destroy: () => {
        cancelMomentum();
        clearTimeout(state.wheelTimer);
        clearTimeout(state.pickTimer);
        canvas.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('dblclick', onDblClick);
        canvas.removeEventListener('keydown', onKeyDown);
        if (window.MapView && window.MapView._internal) window.MapView._internal.current = null;
      }
    };
    // 诊断脚本（CDP）要能读到实时 state 调纯函数，这里挂上去
    if (window.MapView && window.MapView._internal) window.MapView._internal.current = api;
    return api;
  }

  // ---------------- 主渲染 ----------------
  async function render(host, ctx) {
    if (host._mvMap && typeof host._mvMap.destroy === 'function') host._mvMap.destroy();
    host._mvMap = null;
    host.innerHTML = '';
    const origin = await loadOrigin();
    const apps = ctx.applications || [];
    const rows = distanceRows(apps, origin);
    const located = rows.located, unlocated = rows.unlocated;

    // 顶部：出发地
    const head = el('div', { class: 'mv-head' }, [
      el('div', { class: 'mv-head-left' }, [
        el('span', { class: 'mv-kicker' }, ['直线距离对比']),
        el('b', { class: 'mv-origin-text' }, [
          origin ? ('出发地：' + origin.label) : ORIGIN_FALLBACK_HINT
        ]),
        origin ? el('span', { class: 'mv-origin-src' }, [originSourceText(origin)]) : null
      ]),
      el('div', { class: 'mv-head-right' }, [
        el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: () => openOriginDialog(host, ctx)
        }, [origin ? '修改出发地' : '设置出发地'])
      ])
    ]);
    host.appendChild(head);

    if (!origin) {
      host.appendChild(el('p', { class: 'mv-empty' }, [
        '先设置出发地（你的学校或住处），下面就会列出每家公司到它的直线距离并排好序。',
        '出发地可以按城市选，也可以在地图上点选精确位置。'
      ]));
      // 没有出发地时也保留地图入口：用户可以先打开底图，再直接点选出发地，
      // 不必在「设置出发地 → 保存 → 回到页面」之间来回切换。
      let mapSection = null;
      try {
        mapSection = await buildMapSection(host, ctx, null, located);
      } catch (err) {
        mapSection = el('div', { class: 'mv-card' }, [
          el('div', { class: 'mv-card-head' }, [el('h4', {}, ['在线地图（可选）'])]),
          el('p', { class: 'mv-map-note' }, ['地图模块暂时不可用：' + ((err && err.message) || '未知原因') + '。'])
        ]);
      }
      host.appendChild(mapSection);
      return;
    }

    // 概览
    const nearest = located[0];
    const stats = distanceSummary(rows);
    const summary = el('div', { class: 'mv-summary' }, [
      summaryCard('已定位', stats.located + ' / ' + stats.total, stats.coverage + '% 的投递记录有坐标', stats.coverage >= 80 ? 'good' : 'neutral'),
      summaryCard('最近机会', nearest ? window.Geo.formatDistance(nearest.km) : '—', nearest ? nearest.company : '暂无可计算记录', 'good'),
      summaryCard('平均距离', isFinite(stats.averageKm) ? window.Geo.formatDistance(stats.averageKm) : '—', '所有已定位公司的直线距离', 'neutral'),
      summaryCard('最远机会', stats.farthest ? window.Geo.formatDistance(stats.farthest.km) : '—', stats.farthest ? stats.farthest.company : '暂无可计算记录', stats.farthest ? 'warn' : 'neutral')
    ]);
    host.appendChild(summary);

    if (!located.length) {
      host.appendChild(el('p', { class: 'mv-empty' }, [
        '还没有可计算的公司。新增或编辑投递记录时填上「公司所在地」（从招聘平台抄即可，如「北京·朝阳区」），这里就会自动算出距离。'
      ]));
    } else {
      // 离线对比图
      const chartCard = el('div', { class: 'mv-card' }, [
        el('div', { class: 'mv-card-head' }, [
          el('h4', {}, ['相对位置']),
          el('span', { class: 'mv-hint' }, ['以出发地为原点；圈距按比例，仅示意方向与远近'])
        ]),
        buildCompareSvg(origin, located, 720, 380),
        el('div', { class: 'mv-legend' }, window.Geo.BANDS.map((b) =>
          el('span', { class: 'mv-legend-item' }, [
            el('i', { class: 'mv-legend-dot mv-band-' + b.key }), b.label
          ])
        ))
      ]);
      host.appendChild(chartCard);

      // 距离排序条
      const maxKm = located[located.length - 1].km || 1;
      const list = el('div', { class: 'mv-list' }, located.map((r, i) => {
        const pct = Math.max(2, Math.round(r.km / maxKm * 100));
        return el('div', { class: 'mv-row' }, [
          el('span', { class: 'mv-rank' }, [String(i + 1)]),
          el('div', { class: 'mv-row-main' }, [
            el('div', { class: 'mv-row-top' }, [
              el('b', {}, [r.company]),
              el('span', { class: 'mv-dist' }, [window.Geo.formatDistance(r.km)]),
              el('span', { class: 'mv-band mv-band-' + r.band.key }, [r.band.label])
            ]),
            el('div', { class: 'mv-bar-wrap' }, [
              el('div', { class: 'mv-bar mv-band-' + r.band.key, style: 'width:' + pct + '%' })
            ]),
            el('div', { class: 'mv-row-sub' }, [
              r.place ? el('span', {}, [r.place]) : null,
              el('span', { class: 'mv-src' }, [levelText(r.level)]),
              el('button', {
                class: 'mv-mini', type: 'button',
                onclick: (e) => { e.stopPropagation(); onPickCompany(host, ctx, r); }
              }, ['改精确位置'])
            ])
          ])
        ]);
      }));
      host.appendChild(el('div', { class: 'mv-card' }, [
        el('div', { class: 'mv-card-head' }, [
          el('h4', {}, ['由近到远']),
          el('span', { class: 'mv-hint' }, [
            '以出发地「' + origin.label + '」（' +
            ((origin.coords || [origin.lat, origin.lng])[0]).toFixed(2) + ', ' +
            ((origin.coords || [origin.lat, origin.lng])[1]).toFixed(2) +
            '）为基准 · 直线距离，不是通勤时间'
          ])
        ]),
        list
      ]));
    }

    // 缺位置的公司：给出快捷入口
    if (unlocated.length) {
      host.appendChild(el('div', { class: 'mv-card' }, [
        el('div', { class: 'mv-card-head' }, [el('h4', {}, ['还没定位的公司'])]),
        el('div', { class: 'mv-chips' }, unlocated.map((r) => el('button', {
          class: 'mv-chip', type: 'button',
          onclick: () => openPlaceDialog(host, ctx, r.app)
        }, [r.company, r.place ? el('span', { class: 'mv-chip-sub' }, [' · ' + r.place + ' 认不出']) : null])))
      ]));
    }

    // 在线地图（可选）：**整块失败也只降级这一块**，离线对比部分必须照常可用
    let mapSection = null;
    try {
      mapSection = await buildMapSection(host, ctx, origin, located);
    } catch (err) {
      mapSection = el('div', { class: 'mv-card' }, [
        el('div', { class: 'mv-card-head' }, [el('h4', {}, ['在线地图（可选）'])]),
        el('p', { class: 'mv-map-note' }, ['地图模块暂时不可用：' + ((err && err.message) || '未知原因') + '。上面的离线距离对比不受影响。'])
      ]);
    }
    host.appendChild(mapSection);
  }

  function originSourceText(o) {
    if (o.source === 'map') return '地图点选';
    if (o.source === 'manual') return '手动经纬度';
    return '按城市近似（' + (o.level === 'district' ? '区级' : '城市中心') + '）';
  }
  function levelText(level) {
    if (level === 'map') return '地图点选';
    if (level === 'manual') return '手动填写';
    if (level === 'district') return '区级近似';
    if (level === 'city') return '城市近似';
    return '已定位';
  }

  // ---------------- 在线地图区块 ----------------
  async function buildMapSection(host, ctx, origin, located) {
    const card = el('div', { class: 'mv-card mv-map-card' });
    const tiles = await loadTileConfig();
    const sources = await UI.call(window.api.map.sources());
    // 默认使用官方腾讯地图源；不在前端暴露密钥，后续地址解析/SDK 请求走授权代理。
    const currentId = tiles.sourceId || 'tencent';
    const builtin = (sources && sources.builtin) || [];
    const all = builtin.slice();
    if (sources && sources.hasCustom) {
      all.push({ id: 'custom', name: sources.customName || '自定义瓦片源', datum: sources.customDatum || 'wgs84', maxZoom: 19, attribution: '自定义源' });
    }
    const cur = all.find((s) => s.id === currentId) || builtin[0];

    let enabled = !!tiles.enabled;
    const mapHost = el('div', { class: 'mv-map-host' });
    const controls = el('div', { class: 'mv-map-controls' });
    const attribution = el('div', { class: 'mv-attr' });
    const cacheLine = el('div', { class: 'mv-cache' });

    const head = el('div', { class: 'mv-card-head' }, [
      el('h4', {}, ['在线地图（可选）']),
      el('span', { class: 'mv-hint' }, ['开启后瓦片经主进程取回；不开启则不联网'])
    ]);
    card.appendChild(head);
    card.appendChild(el('p', { class: 'mv-map-note' }, [
      '离线那张相对位置图已经能看出远近。在线地图是用来「核对具体位置」的：可以直接在地图上点一下，把出发地或某家公司定到精确坐标。'
    ]));
    card.appendChild(controls);
    card.appendChild(attribution);
    card.appendChild(mapHost);
    card.appendChild(cacheLine);

    let map = null;
    let targetState = null;
    let targetLine = null;

    function rebuildControls() {
      controls.innerHTML = '';
      if (!all.length) {
        controls.appendChild(el('span', { class: 'mv-hint' }, ['没有可用的瓦片源']));
        return;
      }
      const sel = el('select', { class: 'mv-select' }, all.map((s) => el('option', { value: s.id, selected: s.id === currentId ? 'selected' : null }, [s.name])));
      sel.value = currentId;
      sel.addEventListener('change', async () => {
        const s = all.find((x) => x.id === sel.value);
        await saveTileConfig({ sourceId: sel.value });
        if (map && s) map.setSource(s.id, s.datum, s.maxZoom || 19);
        renderAttr(s);
      });
      controls.appendChild(sel);
      controls.appendChild(el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: async () => {
          // 这里曾经写成 render()：函数签名是 render(host, ctx)，于是进函数第一句
          // host.innerHTML 就抛 TypeError，而 async onclick 里的异常没人接 ——
          // 表现就是「点了按钮完全没反应」。现在两个都修：
          // 参数传对，且失败时给出可见提示而不是静默什么都不发生。
          try {
            enabled = !enabled;
            await saveTileConfig({ enabled: enabled });
            await render(host, ctx);
          } catch (err) {
            enabled = !enabled; // 回滚，避免按钮文字与真实状态不一致
            UI.toast('切换地图失败：' + ((err && err.message) || err), 'err');
          }
        }
      }, [enabled ? '关闭地图（停止联网）' : '开启地图']));
      controls.appendChild(el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: () => openTileCustomDialog(host, ctx)
      }, ['自定义瓦片源']));
      controls.appendChild(el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: async () => {
          if (!enabled) {
            // 关闭状态下按钮要完成用户说的「点选」前置动作，而不是打开一个
            // 仍然不能点地图的表单；开启后重新渲染会自动进入出发地点选目标。
            try {
              await saveTileConfig({ enabled: true });
              await render(host, ctx);
            } catch (err) {
              UI.toast('开启地图失败：' + ((err && err.message) || err), 'err');
            }
            return;
          }
          if (map && targetState && targetLine) {
            targetState.type = 'origin';
            targetLine.textContent = '当前点选目标：出发地（点地图即可改）';
            map.setTarget(targetState);
          }
        }
      }, [enabled ? '在地图上点选出发地' : '开启地图并点选出发地']));
      controls.appendChild(el('span', { class: 'mv-hint' }, [enabled ? '' : '（未开启，不发起网络请求）']));
    }

    function renderAttr(s) {
      const src = s || cur;
      attribution.textContent = '底图版权：' + (src.attribution || '—') +
        (src.note ? '（' + src.note + '）' : '');
    }

    async function refreshCache() {
      try {
        const st = await UI.call(window.api.map.cacheStats());
        cacheLine.textContent = '瓦片缓存：' + st.files + ' 块 / ' + (st.bytes / 1024 / 1024).toFixed(1) + 'MB' +
          '（缓存让同一片区域第二次打开不再联网）';
        cacheLine.appendChild(el('button', {
          class: 'mv-mini', type: 'button',
          onclick: async () => { await UI.call(window.api.map.clearCache()); await refreshCache(); }
        }, ['清空缓存']));
      } catch (_) { cacheLine.textContent = ''; }
    }

    rebuildControls();
    renderAttr(cur);
    await refreshCache();

    if (enabled) {
      const center = origin ? [origin.coords ? origin.coords[0] : origin.lat, origin.coords ? origin.coords[1] : origin.lng] : [35, 105];
      targetState = { type: 'origin' };
      targetLine = el('div', { class: 'mv-target' }, ['当前点选目标：出发地']);
      mapHost.appendChild(targetLine);
      // 有出发地就锁在出发地身上（z11 城市级）。fitAll 只留给用户主动点
      // 「显示全部投递点」——否则一开机视野被拉到全国包围盒中心，用户以为
      // 屏幕中间就是自己，点下去出发地跑偏几百公里（真实出过的事故）。
      map = createMap(mapHost, {
        center: center, zoom: origin ? 11 : (located.length ? 10 : 12), sourceId: cur.id, datum: cur.datum,
        maxZoom: cur.maxZoom, located: located, fitAll: !origin, target: targetState,
        home: origin ? center : null, homeLabel: origin ? '出发地' : '',
        onPick: async (ll, target) => {
          await applyPick(host, ctx, ll, target, targetLine);
        }
      });
      host._mvMap = map;
      const nav = el('div', { class: 'mv-map-nav' }, [
        el('span', { class: 'mv-map-nav-label' }, ['视野']),
        el('button', { class: 'mv-mini', type: 'button', title: '缩小', onclick: () => map.zoomBy(-1) }, ['−']),
        el('button', { class: 'mv-mini', type: 'button', title: '放大', onclick: () => map.zoomBy(1) }, ['＋']),
        el('button', { class: 'mv-mini', type: 'button', onclick: () => map.fitAll() }, ['显示全部投递点']),
        el('button', {
          class: 'mv-mini', type: 'button',
          onclick: () => origin
            ? map.recenter(origin.coords ? origin.coords[0] : origin.lat, origin.coords ? origin.coords[1] : origin.lng, 12)
            : map.recenter(35, 105, 4)
        }, [origin ? '回到出发地' : '回到全国']),
        el('button', {
          class: 'mv-mini', type: 'button', title: '使用浏览器定位设置我的位置',
          onclick: () => locateUser(host, ctx)
        }, ['定位我'])
      ]);
      mapHost.appendChild(nav);
      // 每家公司一个「定到地图上」按钮
      const pickRow = el('div', { class: 'mv-chips' }, [
        el('button', {
          class: 'mv-chip', type: 'button',
          onclick: () => { targetState.type = 'origin'; targetLine.textContent = '当前点选目标：出发地（点地图即可改）'; map.setTarget(targetState); }
        }, ['目标：出发地'])
      ].concat(located.map((r) => el('button', {
        class: 'mv-chip', type: 'button',
        onclick: () => {
          targetState.type = 'app'; targetState.appId = r.app.id;
          targetLine.textContent = '当前点选目标：' + r.company + '（点地图即可改）';
          map.setTarget(targetState);
          map.recenter(r.coords[0], r.coords[1], 13);
        }
      }, [r.company]))));
      mapHost.appendChild(pickRow);
    } else {
      mapHost.appendChild(el('div', { class: 'mv-map-note mv-map-permission' }, [
        '地图当前未开启联网。点击“开启地图”后，可查看公司标记、手动点选位置，并使用“定位我”获取当前位置。'
      ]));
    }
    return card;
  }

  async function locateUser(host, ctx) {
    if (!navigator.geolocation) { UI.toast('当前系统不支持定位', 'err'); return; }
    // 权限预检：被系统/用户拒绝时立刻说清楚，不再白等 12 秒。
    // （主进程已对 geolocation 显式放行，正常走不到 denied；这条是双保险。）
    try {
      const st = await navigator.permissions.query({ name: 'geolocation' });
      if (st.state === 'denied') {
        UI.toast('定位权限被拒绝，请在系统设置中允许本应用定位', 'err');
        return;
      }
    } catch (_) { /* 没有 permissions API 的环境：忽略，直接请求 */ }
    UI.toast('正在获取当前位置…', 'ok');
    // 硬超时兜底：无论 getCurrentPosition 的回调来不来（权限挂起、provider 卡死都实测见过），
    // 15 秒后必须给用户一个能行动的交代，绝不让「正在定位」永远转下去。
    let settled = false;
    const guard = setTimeout(() => {
      if (settled) return;
      settled = true;
      UI.toast('定位超时：本机没有可用定位源（无 GPS/WiFi 定位或网络不通）。可以直接点地图选位置。', 'err');
    }, 15000);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      const lat = Number(pos.coords.latitude), lng = Number(pos.coords.longitude);
      if (!isFinite(lat) || !isFinite(lng)) { UI.toast('系统返回的定位坐标无效', 'err'); return; }
      await saveOrigin({ label: '我的当前位置', lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), source: 'geolocation', accuracy: Number(pos.coords.accuracy || 0) });
      UI.toast('已获取当前位置，距离将按当前位置重新排序', 'ok');
      if (ctx.onChanged) await ctx.onChanged();
    }, (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      // code 1=拒绝 2=拿不到 3=超时。本机无定位源时这三种都会发生，
      // 提示统一指向可行动的替代方案：点地图选位置。
      const msg = err && err.code === 1 ? '定位权限被拒绝，请在系统设置中允许本应用定位' :
        err && err.code === 2 ? '暂时无法获取位置：本机没有可用定位源。可以直接点地图选位置。' :
          '定位超时：未在 12 秒内拿到位置，本机可能没有可用定位源。可以直接点地图选位置。';
      UI.toast(msg, 'err');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  // 点选落地的公共保护：pick 出来的点离「这个对象原来的位置」太远时必须先确认
  // ——用户大概率只是点偏了。真实事故：视野被 fitAll 拉到全国中心（陕甘），
  // 用户点了屏幕中间想选成都，出发地坐标直接跑偏 660km，而标签还写着「成都」。
  // 返回 true 表示继续保存。
  async function confirmFarPick(kind, name, prevCoords, lat, lng) {
    if (!prevCoords) return true;
    const km = window.Geo.haversineKm(prevCoords, [lat, lng]);
    if (!isFinite(km) || km <= 30) return true;
    const near = window.Geo.nearestPlace(lat, lng, 150);
    const where = near ? '「' + near.cityKey + '」附近' : '未知区域';
    return UI.modalConfirm('改' + kind + '位置？',
      '这一点在' + where + '（' + lat.toFixed(4) + ', ' + lng.toFixed(4) + '），' +
      '距当前' + kind + '「' + name + '」约 ' + Math.round(km) + ' km。\n确定要把' + kind + '改到这儿吗？',
      '确定修改');
  }

  async function applyPick(host, ctx, ll, target, targetLine) {
    const [lat, lng] = ll;
    const near = window.Geo.nearestPlace(lat, lng, 150);
    const where = near ? '「' + near.cityKey + '」附近' : '未知区域';
    if (target && target.type === 'app' && target.appId) {
      const app = (ctx.applications || []).find((a) => a.id === target.appId);
      if (!app) return;
      const prev = isFinite(app.lat) && isFinite(app.lng) ? [Number(app.lat), Number(app.lng)] : null;
      if (!(await confirmFarPick('公司', app.company || '该公司', prev, lat, lng))) {
        if (targetLine) targetLine.textContent = '已取消，位置未变';
        return;
      }
      await UI.call(window.api.applications.save(ctx.userId, Object.assign({}, app, {
        lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), placeSource: 'map'
      })));
      UI.toast('已把「' + app.company + '」定到 ' + where + '（' + lat.toFixed(4) + ', ' + lng.toFixed(4) + '）', 'ok');
    } else {
      const prev = _origin
        ? [(_origin.coords ? _origin.coords[0] : _origin.lat), (_origin.coords ? _origin.coords[1] : _origin.lng)]
        : null;
      if (!(await confirmFarPick('出发地', (_origin && _origin.label) || '原位置', prev, lat, lng))) {
        if (targetLine) targetLine.textContent = '已取消，出发地未变';
        return;
      }
      // 标签跟着坐标走：30km 内算微调、沿用旧名；隔得远就用反查城市名——
      // 绝不能再出现「标签写着成都、坐标在陕西」这种错位
      const km = prev ? window.Geo.haversineKm(prev, [lat, lng]) : Infinity;
      const keepLabel = prev && isFinite(km) && km <= 30 && _origin && _origin.label;
      const o = {
        label: keepLabel ? _origin.label : (near ? near.cityKey : '地图点选'),
        place: near ? near.cityKey : '',
        lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), source: 'map'
      };
      await saveOrigin(o);
      UI.toast('出发地已设为' + where + '（' + lat.toFixed(4) + ', ' + lng.toFixed(4) + '）' +
        (prev && isFinite(km) ? '，距原位置 ' + Math.round(km) + ' km' : ''), 'ok');
    }
    if (targetLine) targetLine.textContent = '已更新，可继续点选下一个目标';
    if (ctx.onChanged) await ctx.onChanged();
  }

  // ---------------- 弹窗：设置出发地 ----------------
  async function openOriginDialog(host, ctx, mode) {
    const cur = (await loadOrigin()) || {};
    const data = await UI.modalForm('设置出发地', [
      { name: 'label', label: '名称', value: cur.label || '', placeholder: '如：我的学校 / 住的地方' },
      { name: 'place', label: '所在城市或区县', value: cur.place || '', placeholder: '如：绵阳 / 北京·朝阳区 / 杭州' },
      { name: 'lat', label: '纬度（选填，填了就用它）', value: cur.source === 'manual' && cur.lat ? String(cur.lat) : '', placeholder: '如：31.4289' },
      { name: 'lng', label: '经度（选填）', value: cur.source === 'manual' && cur.lng ? String(cur.lng) : '', placeholder: '如：104.7555' }
    ], '保存');
    if (!data) return;
    const label = String(data.label || '').trim() || '出发地';
    const latRaw = String(data.lat || '').trim(), lngRaw = String(data.lng || '').trim();
    let coords = null, source = 'city', level = 'city';
    if (latRaw && lngRaw) {
      const la = Number(latRaw), ln = Number(lngRaw);
      if (!isFinite(la) || !isFinite(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) {
        UI.toast('经纬度不在合法范围', 'err'); return;
      }
      coords = [la, ln]; source = 'manual'; level = 'manual';
    } else {
      const p = window.Geo.parseLocation(data.place);
      if (!p) {
        UI.toast('认不出「' + String(data.place || '') + '」在哪里，请换个写法或直接填经纬度', 'err');
        return;
      }
      coords = p.coords; level = p.level; source = p.level;
    }
    await saveOrigin({ label: label, place: String(data.place || '').trim(), lat: coords[0], lng: coords[1], source: source, level: level });
    UI.toast('出发地已保存', 'ok');
    if (mode === 'pick') UI.toast('可以在地图上点选来改成精确位置', 'ok');
    if (ctx.onChanged) await ctx.onChanged();
  }

  // ---------------- 弹窗：给某家公司改位置 ----------------
  async function openPlaceDialog(host, ctx, app) {
    const data = await UI.modalForm('「' + app.company + '」的位置', [
      { name: 'place', label: '公司所在地', value: app.place || '', placeholder: '如：北京·朝阳区 / 深圳 南山' },
      { name: 'lat', label: '纬度（选填，比地址更准）', value: isFinite(app.lat) ? String(app.lat) : '', placeholder: '选填' },
      { name: 'lng', label: '经度（选填）', value: isFinite(app.lng) ? String(app.lng) : '', placeholder: '选填' }
    ], '保存');
    if (!data) return;
    const patch = { place: String(data.place || '').trim() };
    const latRaw = String(data.lat || '').trim(), lngRaw = String(data.lng || '').trim();
    if (latRaw && lngRaw) {
      const la = Number(latRaw), ln = Number(lngRaw);
      if (!isFinite(la) || !isFinite(ln)) { UI.toast('经纬度不合法', 'err'); return; }
      patch.lat = la; patch.lng = ln; patch.placeSource = 'manual';
    } else if (!patch.place) {
      patch.lat = undefined; patch.lng = undefined; patch.placeSource = undefined;
    } else if (!window.Geo.parseLocation(patch.place)) {
      UI.toast('认不出「' + patch.place + '」，请写成「城市·区县」或直接填经纬度', 'err');
      return;
    } else {
      patch.lat = undefined; patch.lng = undefined; patch.placeSource = undefined;
    }
    await UI.call(window.api.applications.save(ctx.userId, Object.assign({}, app, patch)));
    UI.toast('位置已更新', 'ok');
    if (ctx.onChanged) await ctx.onChanged();
  }

  async function onPickCompany(host, ctx, row) {
    await openPlaceDialog(host, ctx, row.app);
  }

  // ---------------- 弹窗：自定义瓦片源 ----------------
  async function openTileCustomDialog(host, ctx) {
    const data = await UI.modalForm('自定义瓦片源', [
      { name: 'name', label: '名称', value: '', placeholder: '如：内网自建地图' },
      { name: 'url', label: '瓦片地址模板', value: '', placeholder: 'https://example.com/{z}/{x}/{y}.png' },
      { name: 'datum', label: '坐标系（wgs84 或 gcj02）', value: 'wgs84', placeholder: 'wgs84' }
    ], '保存（留空则清除）');
    if (!data) return;
    const res = await window.api.map.setCustomSource(String(data.name || ''), String(data.url || ''), String(data.datum || 'wgs84'));
    if (!res.ok) { UI.toast(res.error, 'err'); return; }
    UI.toast(String(data.url || '').trim() ? '自定义瓦片源已保存' : '已清除自定义瓦片源', 'ok');
    if (ctx.onChanged) await ctx.onChanged();
  }

  window.MapView = {
    render: render,
    distanceRows: distanceRows,
    distanceSummary: distanceSummary,
    resolveAppCoords: resolveAppCoords,
    loadOrigin: loadOrigin,
    saveOrigin: saveOrigin,
    // 供测试/诊断用：地图交互数学（纯函数）+ 当前地图实例
    _internal: {
      zoomAroundCenter: zoomAroundCenter,
      panCenterByPixels: panCenterByPixels,
      clampZoom: clampZoom,
      metersPerPixel: metersPerPixel,
      niceScaleBar: niceScaleBar,
      fmtMeters: fmtMeters,
      current: null
    }
  };
})();
