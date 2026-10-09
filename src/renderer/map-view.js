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

  // ---------------- 在线地图：极简滑动瓦片地图 ----------------
  // 不引第三方库（渲染层至今零依赖），够用即可：拖动平移、滚轮缩放、点击取坐标。
  function createMap(host, ctx) {
    const state = {
      center: null,          // [lat, lng] WGS-84
      zoom: 11,
      sourceId: ctx.sourceId || 'osm',
      datum: ctx.datum || 'wgs84',
      maxZoom: ctx.maxZoom || 19,
      tiles: new Map(),      // key -> img element
      markers: [],
      target: ctx.target || { type: 'origin' },
      dragging: false,
      last: null,
      renderTimer: null,
      clickHandled: false,
      inflight: 0,
      queue: []
    };
    const W = 768, H = 420;
    const NS = 'http://www.w3.org/2000/svg';

    const wrap = el('div', { class: 'mv-map-wrap' });
    const canvas = el('div', { class: 'mv-map-canvas' });
    const layer = el('div', { class: 'mv-map-tiles' });
    const overlay = document.createElementNS(NS, 'svg');
    overlay.setAttribute('class', 'mv-map-overlay');
    overlay.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    const status = el('div', { class: 'mv-map-status' });
    canvas.appendChild(layer);
    canvas.appendChild(overlay);
    wrap.appendChild(canvas);
    wrap.appendChild(status);
    host.appendChild(wrap);

    const datumCenter = () => window.Geo.fromWgs84(state.center[0], state.center[1], state.datum);

    function project(latW, lngW) {
      // 先把 WGS-84 转成瓦片源的坐标系，再做像素投影；否则 gcj02 源会整体偏移
      const d = window.Geo.fromWgs84(latW, lngW, state.datum);
      const p = window.Geo.lngLatToWorldPixel(d[1], d[0], state.zoom);
      const c = datumCenter();
      const cp = window.Geo.lngLatToWorldPixel(c[1], c[0], state.zoom);
      return [p[0] - cp[0] + W / 2, p[1] - cp[1] + H / 2];
    }

    function unproject(px, py) {
      const c = datumCenter();
      const cp = window.Geo.lngLatToWorldPixel(c[1], c[0], state.zoom);
      const d = window.Geo.worldPixelToLngLat(cp[0] + (px - W / 2), cp[1] + (py - H / 2), state.zoom);
      return window.Geo.toWgs84(d[0], d[1], state.datum); // GCJ-02 源取到的点要转回 WGS-84 再存
    }

    function scheduleRender() {
      clearTimeout(state.renderTimer);
      state.renderTimer = setTimeout(renderTiles, 110);
    }

    function pump() {
      while (state.inflight < 6 && state.queue.length) {
        const job = state.queue.shift();
        state.inflight++;
        window.api.map.tile(state.sourceId, job.z, job.x, job.y).then((res) => {
          if (res && res.ok && res.data && res.data.dataUrl) {
            const img = el('img', { class: 'mv-tile', src: res.data.dataUrl, alt: '' });
            img.style.left = job.left + 'px';
            img.style.top = job.top + 'px';
            layer.appendChild(img);
            state.tiles.set(job.key, img);
            if (!job.wasCached) { state.loaded++; }
          } else {
            state.failed++;
            // 记下具体原因：否则界面上只会说「取不回来」，用户无法判断是没网、被墙还是源配错了
            state.lastError = (res && res.error) || '网络不可用';
          }
        }).catch(() => { state.failed++; })
          .then(() => { state.inflight--; pump(); });
      }
      updateStatus();
    }

    function updateStatus() {
      const total = state.queued + state.loaded + state.failed;
      const bits = [];
      if (state.inflight > 0) bits.push('加载中 ' + state.inflight);
      if (state.failed > 0) bits.push('失败 ' + state.failed);
      status.textContent = bits.length ? bits.join(' · ') : '';
      if (state.loaded === 0 && state.failed > 0) {
        // 别只说「取不回来」——用户无从判断该换源还是该查网络，直接把下一步给出来
        status.textContent = '瓦片取不回来：' + (state.lastError || '网络不可用') +
          '（不影响上面的离线距离对比；可在上方换个瓦片源再试，国内一般选高德）';
      }
      void total;
    }

    function renderTiles() {
      layer.innerHTML = '';
      state.tiles.clear();
      state.queue = [];
      state.inflight = 0;
      state.loaded = 0;
      state.failed = 0;
      const z = state.zoom;
      const c = datumCenter();
      const cp = window.Geo.lngLatToWorldPixel(c[1], c[0], z);
      const originX = cp[0] - W / 2, originY = cp[1] - H / 2;
      const x0 = Math.floor(originX / 256), x1 = Math.floor((originX + W) / 256);
      const y0 = Math.floor(originY / 256), y1 = Math.floor((originY + H) / 256);
      const n = Math.pow(2, z);
      let queued = 0;
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          if (y < 0 || y >= n) continue;
          const wrapX = ((x % n) + n) % n; // 经度方向环绕
          state.queue.push({
            key: z + '/' + wrapX + '/' + y, z: z, x: wrapX, y: y,
            left: Math.round(x * 256 - originX), top: Math.round(y * 256 - originY)
          });
          queued++;
        }
      }
      state.queued = queued;
      pump();
      drawOverlay();
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

    // 拖动
    canvas.addEventListener('mousedown', (e) => {
      state.dragging = true;
      state.last = [e.clientX, e.clientY];
      state.moved = 0;
      canvas.classList.add('dragging');
    });
    window.addEventListener('mousemove', (e) => {
      if (!state.dragging) return;
      const dx = e.clientX - state.last[0], dy = e.clientY - state.last[1];
      state.last = [e.clientX, e.clientY];
      state.moved += Math.abs(dx) + Math.abs(dy);
      const c = datumCenter();
      const cp = window.Geo.lngLatToWorldPixel(c[1], c[0], state.zoom);
      const d = window.Geo.worldPixelToLngLat(cp[0] - dx, cp[1] - dy, state.zoom);
      state.center = window.Geo.toWgs84(d[0], d[1], state.datum);
      drawOverlay();
      layer.style.transform = 'translate(' + 0 + 'px,' + 0 + 'px)';
      scheduleRender();
    });
    window.addEventListener('mouseup', (e) => {
      if (!state.dragging) return;
      state.dragging = false;
      canvas.classList.remove('dragging');
      // 拖动距离很小 → 视为点击取坐标
      if (state.moved < 4) {
        const rect = canvas.getBoundingClientRect();
        const px = (e.clientX - rect.left) * (W / rect.width);
        const py = (e.clientY - rect.top) * (H / rect.height);
        const ll = unproject(px, py);
        ctx.onPick(ll, state.target);
      }
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = state.zoom;
      state.zoom = Math.max(3, Math.min(state.maxZoom, state.zoom + (e.deltaY < 0 ? 1 : -1)));
      if (state.zoom !== before) { scheduleRender(); }
    }, { passive: false });

    state.center = ctx.center || [35.0, 105.0];
    state.zoom = ctx.zoom || 11;
    if (ctx.center) state.zoom = ctx.zoom || 12;
    renderTiles();

    return {
      state: state,
      setTarget: (t) => { state.target = t; },
      setSource: (id, datum, maxZoom) => {
        state.sourceId = id; state.datum = datum; state.maxZoom = maxZoom;
        renderTiles();
      },
      recenter: (lat, lng, zoom) => {
        state.center = [lat, lng];
        if (zoom) state.zoom = Math.max(3, Math.min(state.maxZoom, zoom));
        renderTiles();
      },
      destroy: () => { clearTimeout(state.renderTimer); }
    };
  }

  // ---------------- 主渲染 ----------------
  async function render(host, ctx) {
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
      return;
    }

    // 概览
    const nearest = located[0];
    const summary = el('div', { class: 'mv-summary' }, [
      el('span', {}, ['已定位 ' + located.length + ' 家']),
      unlocated.length ? el('span', { class: 'mv-warn' }, ['缺位置 ' + unlocated.length + ' 家']) : null,
      nearest ? el('span', {}, ['最近：' + nearest.company + ' ' + window.Geo.formatDistance(nearest.km)]) : null
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
        buildCompareSvg(origin, located, 720, 380)
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
          el('span', { class: 'mv-hint' }, ['直线距离，不是通勤时间'])
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
    // 默认用高德：本机实测（2026-10）tile.openstreetmap.org 直连 10.7s 超时不可达，
    // 而高德 164ms、OSM 德国镜像 807ms 正常。国内用户点开地图就该看到图，
    // 而不是先看到一句「取不回来」再自己去猜该换哪个源。
    // OSM 仍保留在列表里（网络能通的用户可自行切换），其版权署名照常显示。
    const currentId = tiles.sourceId || 'amap';
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
        onclick: () => openOriginDialog(host, ctx, 'pick')
      }, ['在地图上点选出发地']));
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
      const targetState = { type: 'origin' };
      const targetLine = el('div', { class: 'mv-target' }, ['当前点选目标：出发地']);
      mapHost.appendChild(targetLine);
      map = createMap(mapHost, {
        center: center, zoom: located.length ? 10 : 12, sourceId: cur.id, datum: cur.datum,
        maxZoom: cur.maxZoom, located: located, target: targetState,
        onPick: async (ll, target) => {
          await applyPick(host, ctx, ll, target, targetLine);
        }
      });
      host._mvMap = map;
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
    }
    return card;
  }

  async function applyPick(host, ctx, ll, target, targetLine) {
    const [lat, lng] = ll;
    if (target && target.type === 'app' && target.appId) {
      const app = (ctx.applications || []).find((a) => a.id === target.appId);
      if (!app) return;
      await UI.call(window.api.applications.save(ctx.userId, Object.assign({}, app, {
        lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), placeSource: 'map'
      })));
      UI.toast('已把「' + app.company + '」定到 ' + lat.toFixed(4) + ', ' + lng.toFixed(4), 'ok');
    } else {
      const o = { label: (_origin && _origin.label) || '我的位置', lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), source: 'map' };
      await saveOrigin(o);
      UI.toast('出发地已设为地图上的点（' + lat.toFixed(4) + ', ' + lng.toFixed(4) + '）', 'ok');
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
    resolveAppCoords: resolveAppCoords,
    loadOrigin: loadOrigin,
    saveOrigin: saveOrigin
  };
})();
