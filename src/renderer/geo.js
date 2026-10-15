'use strict';

// ============================================================
//  「投递地点与距离」纯逻辑层（无 DOM、无网络、无 IPC）
//
//  职责：
//    1. 位置文本解析：把「北京·朝阳区」「上海市浦东新区」「深圳 南山」这类
//       用户从招聘平台抄下来的写法，映射到内置坐标表里的城市 / 区县
//    2. 大圆距离（Haversine）：本地计算，离线可用，结果确定
//    3. 坐标系转换：WGS-84 ⇄ GCJ-02（火星坐标）
//       —— 为什么要它：内置表是 WGS-84，而高德/腾讯瓦片是 GCJ-02、
//          OSM 瓦片是 WGS-84。不换算就会出现「点放偏了 500m」这种看起来对、其实错的问题。
//          实测：直接混用会让同一地点在两种底图上差 0.5–1.5km。
//    4. 瓦片投影（Web Mercator）：经纬度 ⇄ 瓦片像素
//
//  坐标口径：**本应用内部的经纬度一律是 WGS-84**。
//    地图点选捕获到的坐标，会按瓦片源声明的坐标系先转成 WGS-84 再存。
// ============================================================

(function () {
  const EARTH_R = 6371.0088; // 平均地球半径（km），IUGG 推荐值
  const PI = Math.PI;
  const DEG = PI / 180;

  // ---------- 1) 距离 ----------
  /** 两点大圆距离（km）。参数：[纬度, 经度] */
  function haversineKm(a, b) {
    if (!a || !b) return NaN;
    const lat1 = Number(a[0]), lng1 = Number(a[1]);
    const lat2 = Number(b[0]), lng2 = Number(b[1]);
    if (![lat1, lng1, lat2, lng2].every((x) => isFinite(x))) return NaN;
    const dLat = (lat2 - lat1) * DEG;
    const dLng = (lng2 - lng1) * DEG;
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** 距离展示：不足 1km 用米。刻意不写「通勤 X 分钟」——直线距离推不出通勤时间 */
  function formatDistance(km) {
    if (!isFinite(km)) return '—';
    if (km < 1) return Math.round(km * 1000) + ' m';
    if (km < 10) return km.toFixed(1) + ' km';
    if (km < 1000) return Math.round(km) + ' km';
    return Math.round(km / 100) / 10 + ' 千公里';
  }

  /** 距离分档：用于配色与文案。全部口径都是「直线距离」 */
  const BANDS = [
    { max: 5, key: 'very-close', label: '很近', hint: '直线 5km 以内' },
    { max: 15, key: 'close', label: '较近', hint: '直线 5–15km' },
    { max: 40, key: 'medium', label: '一般', hint: '直线 15–40km' },
    { max: 100, key: 'far', label: '较远', hint: '直线 40–100km' },
    { max: Infinity, key: 'very-far', label: '很远', hint: '直线 100km 以上' }
  ];
  function bandOf(km) {
    if (!isFinite(km)) return { key: 'unknown', label: '未定位', hint: '还没有坐标' };
    for (const b of BANDS) if (km < b.max) return b;
    return BANDS[BANDS.length - 1];
  }

  // ---------- 1b) 坐标 → 最近城市（反查） ----------
  // 地图上点选的位置要能说清「这是哪儿」：只丢一串经纬度给用户，
  // 点偏了 600km 也看不出来（真实踩过的坑：出发地标签还是「成都」，
  // 坐标已经跑到陕西）。反查内置城市表，超过 maxKm 没有城市就返回 null。
  function nearestPlace(lat, lng, maxKm) {
    const table = window.CityGeo && window.CityGeo.table;
    if (!table || !isFinite(Number(lat)) || !isFinite(Number(lng))) return null;
    lat = Number(lat); lng = Number(lng);
    const limit = isFinite(maxKm) ? Number(maxKm) : 120;
    let best = null;
    for (const key in table) {
      if (key.indexOf('|') >= 0) continue; // 只取城市级点，区县太密会把「市」拆碎
      const c = table[key];
      if (!c || !isFinite(Number(c[0])) || !isFinite(Number(c[1]))) continue;
      const km = haversineKm([lat, lng], [Number(c[0]), Number(c[1])]);
      if (!best || km < best.km) {
        best = { cityKey: key, coords: [Number(c[0]), Number(c[1])], km: km };
      }
    }
    if (!best || best.km > limit) return null;
    return { cityKey: best.cityKey, coords: best.coords, km: best.km, level: 'city' };
  }

  // ---------- 2) 坐标系转换（标准算法）----------
  // GCJ-02 是对 WGS-84 做的非线性偏移；BD-09 又在 GCJ-02 上再偏一次。
  // 本应用只处理 WGS-84 与 GCJ-02，不引入 BD-09（内置表已转成 WGS-84）。
  const A = 6378245.0;                 // 克拉索夫斯基椭球长半轴
  const EE = 0.00669342162296594323;   // 第一偏心率平方
  function outOfChina(lat, lng) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }
  // 港澳台：地理上落在中国大陆的包围盒内，但官方制图用 WGS-84，并不施加 GCJ-02 偏移。
  // 若照搬上面那条包围盒判定，会给香港的坐标平白加 555m 偏移 —— 在瓦片上就是「点放偏了」。
  // （量级 0.5km，正好卡在肉眼能看出来、又不至于让距离结论出错的位置，所以单独排除。）
  const NO_OFFSET_REGIONS = [
    { name: '香港', lat: [22.13, 22.58], lng: [113.81, 114.45] },
    { name: '澳门', lat: [22.09, 22.23], lng: [113.52, 113.61] },
    { name: '台湾', lat: [21.85, 25.35], lng: [119.30, 122.10] }
  ];
  function inNoOffsetRegion(lat, lng) {
    for (const r of NO_OFFSET_REGIONS) {
      if (lat >= r.lat[0] && lat <= r.lat[1] && lng >= r.lng[0] && lng <= r.lng[1]) return true;
    }
    return false;
  }
  /** 该点是否需要施加 GCJ-02 偏移 */
  function needsGcjOffset(lat, lng) {
    return !outOfChina(lat, lng) && !inNoOffsetRegion(lat, lng);
  }
  function transformLat(x, y) {
    let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    r += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
    r += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
    return r;
  }
  function transformLng(x, y) {
    let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    r += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
    r += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
    return r;
  }
  /** [纬度, 经度] WGS-84 → GCJ-02；境外与港澳台原样返回 */
  function wgs84ToGcj02(lat, lng) {
    lat = Number(lat); lng = Number(lng);
    if (!isFinite(lat) || !isFinite(lng) || !needsGcjOffset(lat, lng)) return [lat, lng];
    const dLat = transformLat(lng - 105.0, lat - 35.0);
    const dLng = transformLng(lng - 105.0, lat - 35.0);
    const radLat = lat * DEG;
    let magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    return [
      lat + (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI),
      lng + (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI)
    ];
  }
  /** [纬度, 经度] GCJ-02 → WGS-84（反向一次迭代，残差 < 0.5m）*/
  function gcj02ToWgs84(lat, lng) {
    lat = Number(lat); lng = Number(lng);
    if (!isFinite(lat) || !isFinite(lng) || !needsGcjOffset(lat, lng)) return [lat, lng];
    const g = wgs84ToGcj02(lat, lng);
    return [lat * 2 - g[0], lng * 2 - g[1]];
  }
  /** 按声明的坐标系转成内部统一的 WGS-84。datum: 'wgs84' | 'gcj02' */
  function toWgs84(lat, lng, datum) {
    return datum === 'gcj02' ? gcj02ToWgs84(lat, lng) : [Number(lat), Number(lng)];
  }
  /** WGS-84 转成某个瓦片源需要的坐标系 */
  function fromWgs84(lat, lng, datum) {
    return datum === 'gcj02' ? wgs84ToGcj02(lat, lng) : [Number(lat), Number(lng)];
  }

  // ---------- 3) 位置文本解析 ----------
  const table = (window.CityGeo && window.CityGeo.table) || {};
  const normalize = (window.CityGeo && window.CityGeo.normalizeCityName) ||
    ((s) => String(s == null ? '' : s).trim());

  const cityKeys = [];
  const districtsOf = {};
  Object.keys(table).forEach((k) => {
    const i = k.indexOf('|');
    if (i < 0) cityKeys.push(k);
    else {
      const city = k.slice(0, i), dist = k.slice(i + 1);
      (districtsOf[city] = districtsOf[city] || []).push(dist);
    }
  });
  // 长键优先：避免「海南」抢走「海南藏族自治州」、或「吉林」抢走「吉林市」这类子串误判
  cityKeys.sort((a, b) => b.length - a.length);
  Object.keys(districtsOf).forEach((c) => districtsOf[c].sort((a, b) => b.length - a.length));

  /**
   * 从一串自由文本里认出城市与区县。
   * 支持：「北京·朝阳区」「上海市浦东新区」「深圳 南山」「杭州」「成都高新区」「北京市」
   * 返回 { cityKey, districtKey, coords, label, matched } | null
   */
  function parseLocation(raw) {
    const text = String(raw == null ? '' : raw).replace(/[\s　]+/g, '');
    if (!text) return null;
    // 1) 找城市：长键优先，命中即止
    let cityKey = null;
    for (const c of cityKeys) {
      if (text.indexOf(c) >= 0) { cityKey = c; break; }
    }
    if (!cityKey) {
      // 退一步：整串归一化后直接查表（处理「北京市」「延边朝鲜族自治州」等）
      const n = normalize(text);
      if (n && table[n]) cityKey = n;
    }
    if (!cityKey) return null;
    // 2) 在该城市的区县里找最长的命中
    const rest = text.split(cityKey).join('');
    let districtKey = null;
    for (const d of districtsOf[cityKey] || []) {
      if (d && rest.indexOf(d) >= 0) { districtKey = d; break; }
    }
    const key = districtKey ? cityKey + '|' + districtKey : cityKey;
    const coords = table[key];
    if (!coords) return null;
    return {
      cityKey: cityKey,
      districtKey: districtKey,
      coords: [coords[0], coords[1]],
      label: districtKey ? cityKey + districtKey : cityKey,
      // 'district' 比 'city' 精确一个量级（1–3km vs 5–10km），界面据此提示
      level: districtKey ? 'district' : 'city',
      matched: key
    };
  }

  /** 城市候选（供输入框补全）：按前缀/包含匹配 */
  function suggestCity(raw, limit) {
    const q = normalize(raw);
    if (!q) return cityKeys.slice(0, limit || 20);
    const hit = cityKeys.filter((c) => c.indexOf(q) >= 0);
    hit.sort((a, b) => (a.indexOf(q) - b.indexOf(q)) || (a.length - b.length));
    return hit.slice(0, limit || 20);
  }

  // ---------- 4) Web Mercator 瓦片投影 ----------
  function lngLatToWorldPixel(lng, lat, z) {
    const scale = 256 * Math.pow(2, z);
    const x = (lng + 180) / 360 * scale;
    const s = Math.sin(lat * DEG);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * PI)) * scale;
    return [x, y];
  }
  function worldPixelToLngLat(x, y, z) {
    const scale = 256 * Math.pow(2, z);
    const lng = x / scale * 360 - 180;
    const n = PI - 2 * PI * y / scale;
    const lat = 180 / PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return [lat, lng];
  }

  window.Geo = {
    haversineKm, formatDistance, bandOf, BANDS,
    wgs84ToGcj02, gcj02ToWgs84, toWgs84, fromWgs84, outOfChina, needsGcjOffset, inNoOffsetRegion,
    parseLocation, suggestCity, nearestPlace,
    lngLatToWorldPixel, worldPixelToLngLat,
    _internal: { cityKeys: cityKeys, districtsOf: districtsOf }
  };
})();
