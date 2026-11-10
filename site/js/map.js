/*
 * Interactive weather map: CARTO dark base (OSM data), NEXRAD radar tiles,
 * work/home markers, and Windy-style animated wind streaks from Open-Meteo.
 * Pan and pinch-zoom freely; the map snaps back to the home view when idle.
 * ES5 only. Needs Leaflet 1.9 (window.L).
 */
window.DashMap = (function () {
  'use strict';

  var C, map, radar, homeBounds;
  var expanded = false, idleTimer = null, radarTimer = null;
  var card, canvas, ctx;
  var wind = null, field = null, fieldCols = 0, fieldRows = 0, FIELD_STEP = 16;
  var windKey = '', windAt = 0, windReq = null, moveTimer = null;
  var particles = [], paused = false, moving = false, running = false, lastFrame = 0, stepScale = 1;
  var hooks = {};

  // Drawn icons: the frame's Android 6 font has no glyph for the expand/close symbols.
  var ICON_EXPAND = '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" ' +
    'fill="none" stroke="#ececea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_CLOSE = '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" ' +
    'fill="none" stroke="#ececea" stroke-width="2" stroke-linecap="round"/></svg>';

  var COLORS = ['#5b8def', '#4fc3c8', '#8fd8a8', '#e6d46a', '#f2b36b', '#f28b82'];
  var LIMITS = [5, 10, 15, 20, 30, 9999]; // mph upper bounds per color

  var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame ||
    function (fn) { return window.setTimeout(function () { fn(new Date().getTime()); }, 50); };

  function colorIdx(mph) {
    for (var i = 0; i < LIMITS.length; i++) { if (mph < LIMITS[i]) { return i; } }
    return LIMITS.length - 1;
  }

  // ---------- setup ----------

  function init(opts) {
    C = window.DASH_CONFIG.map;
    hooks = opts || {};
    if (!window.L) { if (hooks.onError) { hooks.onError('Map library failed to load'); } return; }
    card = document.getElementById('radar-card');

    map = L.map('map', {
      zoomControl: false,
      minZoom: C.minZoom,
      maxZoom: C.maxZoom,
      fadeAnimation: false,       // lighter on the frame's CPU
      worldCopyJump: false
    });
    map.attributionControl.setPrefix(false);

    L.tileLayer(C.base, { className: 'dark-tiles', maxZoom: 19, attribution: C.baseAttribution }).addTo(map);
    radar = L.tileLayer(radarUrl(), { opacity: C.radar.opacity, attribution: C.radar.attribution }).addTo(map);

    var w = C.locations.work, h = C.locations.home;
    L.polyline([[w.lat, w.lon], [h.lat, h.lon]],
      { color: '#ececea', opacity: 0.75, weight: 3, dashArray: '9 7', interactive: false }).addTo(map);
    marker(w, 'work');
    marker(h, 'home');
    homeBounds = L.latLngBounds([[w.lat, w.lon], [h.lat, h.lon]]);
    goHome();

    setupCanvas();

    map.on('movestart zoomstart', function () { moving = true; clearCanvas(); });
    map.on('moveend', function () {
      moving = false;
      if (moveTimer) { window.clearTimeout(moveTimer); }
      moveTimer = window.setTimeout(function () { fetchWind(false); }, 600);
      buildField();
      start();
    });
    map.on('resize', function () { setupCanvas(); buildField(); });

    // Any touch on the map restarts the idle timer.
    var el = map.getContainer();
    el.addEventListener('touchstart', touched, false);
    el.addEventListener('mousedown', touched, false);
    el.addEventListener('wheel', touched, false);

    document.getElementById('map-expand').addEventListener('click', function () { setExpanded(!expanded); touched(); });
    document.getElementById('map-home').addEventListener('click', function () { goHome(); });

    radarTimer = window.setInterval(refreshRadar, C.radar.refreshMin * 60000);
    stamp();
    fetchWind(true);
    window.setInterval(function () { fetchWind(true); }, C.wind.refreshMin * 60000);
  }

  function marker(loc, kind) {
    var icon = L.divIcon({
      className: 'map-marker ' + kind,
      html: '<span class="mk-dot"></span><span class="mk-label">' + loc.name + '</span>',
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });
    L.marker([loc.lat, loc.lon], { icon: icon, interactive: false, keyboard: false }).addTo(map);
  }

  function goHome() {
    map.fitBounds(homeBounds, { padding: [70, 70], maxZoom: 12, animate: false });
  }

  // While someone is using the map, wind runs at the boost frame rate (30 fps); it drops back to
  // the ambient rate (10 fps) when the map resets after idleReturnSec untouched.
  var boosted = false;

  function touched() {
    boosted = true;
    if (idleTimer) { window.clearTimeout(idleTimer); }
    idleTimer = window.setTimeout(function () {
      boosted = false;
      if (expanded) { setExpanded(false); }
      goHome();
    }, C.idleReturnSec * 1000);
  }

  function windFps() { return boosted ? (C.wind.boostFps || 30) : C.wind.fps; }

  function setExpanded(on) {
    expanded = on;
    card.className = 'card radar' + (on ? ' map-full' : '');
    document.getElementById('map-expand').innerHTML = on ? ICON_CLOSE : ICON_EXPAND;
    map.invalidateSize(false);
    if (!on) { goHome(); }
  }

  // ---------- radar ----------

  function radarUrl() {
    // Bucket to the refresh interval so tiles are cached between refreshes.
    var bucket = Math.floor(new Date().getTime() / (C.radar.refreshMin * 60000));
    return C.radar.url + '?_=' + bucket;
  }
  function refreshRadar() { radar.setUrl(radarUrl()); stamp(); }
  function stamp() {
    var d = new Date(), step = C.radar.refreshMin;
    d.setMinutes(Math.floor(d.getMinutes() / step) * step, 0, 0);
    if (hooks.onRadarTime) { hooks.onRadarTime(d); }
  }

  // ---------- wind data ----------

  function fetchWind(force) {
    var b = map.getBounds().pad(0.25);
    var s = b.getSouth(), n = b.getNorth(), w = b.getWest(), e = b.getEast();
    var key = [s, n, w, e].map(function (v) { return v.toFixed(1); }).join(',');
    var fresh = new Date().getTime() - windAt < C.wind.refreshMin * 60000;
    if (!force && fresh && key === windKey) { return; }

    var g = C.wind.grid, lats = [], lons = [], i, j;
    for (i = 0; i < g; i++) {
      for (j = 0; j < g; j++) {
        // 2 decimals (~1 km) is plenty for wind and lets the server cache repeat requests.
        lats.push((s + (n - s) * i / (g - 1)).toFixed(2));
        lons.push((w + (e - w) * j / (g - 1)).toFixed(2));
      }
    }
    var qs = 'latitude=' + lats.join(',') + '&longitude=' + lons.join(',');
    // Our own relay first: the frame's Android 6 doesn't trust Open-Meteo's certificate.
    // Direct Open-Meteo is the fallback (the local preview has no /api).
    var urls = ['/api/wind?' + qs,
      'https://api.open-meteo.com/v1/forecast?' + qs + '&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=mph'];
    requestWind(urls, 0, s, n, w, e, g, key);
  }

  function requestWind(urls, attempt, s, n, w, e, g, key) {
    if (windReq) { windReq.abort(); }
    var xhr = new XMLHttpRequest();
    windReq = xhr;
    xhr.open('GET', urls[attempt], true);
    xhr.timeout = 15000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      windReq = null;
      if (xhr.status !== 200) {
        if (attempt + 1 < urls.length) { requestWind(urls, attempt + 1, s, n, w, e, g, key); return; }
        if (hooks.onError) { hooks.onError('Wind fetch failed (' + xhr.status + ')'); }
        return;
      }
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (err) { return; }
      if (!data || !data.length) { data = [data]; }
      var u = [], v = [], spd = [];
      for (var k = 0; k < data.length; k++) {
        var c = data[k].current || {};
        var mph = c.wind_speed_10m || 0, from = (c.wind_direction_10m || 0) * Math.PI / 180;
        // Direction is where the wind comes FROM; the vector points where it goes.
        u.push(-mph * Math.sin(from));
        v.push(-mph * Math.cos(from));
        spd.push(mph);
      }
      wind = { s: s, n: n, w: w, e: e, g: g, u: u, v: v };
      windKey = key;
      windAt = new Date().getTime();
      reportCenter();
      buildField();
      resetParticles();
      start();
    };
    xhr.send();
  }

  // Bilinear sample of the lat/lon grid. Returns [u, v] in mph, or null outside it.
  function sample(lat, lon) {
    if (!wind) { return null; }
    var g = wind.g;
    var fy = (lat - wind.s) / (wind.n - wind.s) * (g - 1);
    var fx = (lon - wind.w) / (wind.e - wind.w) * (g - 1);
    if (fx < 0 || fy < 0 || fx > g - 1 || fy > g - 1) { return null; }
    var x0 = Math.min(Math.floor(fx), g - 2), y0 = Math.min(Math.floor(fy), g - 2);
    var tx = fx - x0, ty = fy - y0;
    var a = y0 * g + x0, b = a + 1, c = a + g, d = c + 1;
    function lerp(arr) {
      return (arr[a] * (1 - tx) + arr[b] * tx) * (1 - ty) + (arr[c] * (1 - tx) + arr[d] * tx) * ty;
    }
    return [lerp(wind.u), lerp(wind.v)];
  }

  function reportCenter() {
    var c = map.getCenter(), uv = sample(c.lat, c.lng);
    if (!uv || !hooks.onWind) { return; }
    var mph = Math.sqrt(uv[0] * uv[0] + uv[1] * uv[1]);
    var from = (Math.atan2(-uv[0], -uv[1]) * 180 / Math.PI + 360) % 360;
    hooks.onWind(Math.round(mph), from);
  }

  // ---------- screen-space field and particles ----------

  function setupCanvas() {
    var el = map.getContainer();
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'wind-canvas';
      el.appendChild(canvas);
      ctx = canvas.getContext('2d');
    }
    canvas.width = el.clientWidth;
    canvas.height = el.clientHeight;
  }

  function clearCanvas() { if (ctx) { ctx.clearRect(0, 0, canvas.width, canvas.height); } }

  // Precompute pixel velocity every 16 px so the animation never touches Leaflet per frame.
  function buildField() {
    if (!wind || !canvas) { field = null; return; }
    var W = canvas.width, H = canvas.height, k = C.wind.speedScale;
    fieldCols = Math.ceil(W / FIELD_STEP) + 1;
    fieldRows = Math.ceil(H / FIELD_STEP) + 1;
    field = new Float32Array(fieldCols * fieldRows * 3);
    for (var r = 0; r < fieldRows; r++) {
      for (var c = 0; c < fieldCols; c++) {
        var ll = map.containerPointToLatLng([c * FIELD_STEP, r * FIELD_STEP]);
        var uv = sample(ll.lat, ll.lng), i = (r * fieldCols + c) * 3;
        if (uv) {
          field[i] = uv[0] * k;
          field[i + 1] = -uv[1] * k; // screen y points down
          field[i + 2] = Math.sqrt(uv[0] * uv[0] + uv[1] * uv[1]);
        }
      }
    }
    if (!C.wind.animate) { drawStatic(); }
  }

  function resetParticles() {
    if (!canvas) { return; }
    var count = Math.round(canvas.width * canvas.height / C.wind.pxPerParticle);
    particles = [];
    for (var i = 0; i < count; i++) { particles.push(spawn({})); }
  }

  function spawn(p) {
    p.x = Math.random() * canvas.width;
    p.y = Math.random() * canvas.height;
    p.age = Math.floor(Math.random() * 60);
    p.max = 50 + Math.floor(Math.random() * 40);
    return p;
  }

  function look(x, y) {
    var c = Math.round(x / FIELD_STEP), r = Math.round(y / FIELD_STEP);
    if (c < 0 || r < 0 || c >= fieldCols || r >= fieldRows) { return -1; }
    return (r * fieldCols + c) * 3;
  }

  function start() {
    if (!C.wind.animate || running || paused || moving || !field) { return; }
    if (!particles.length) { resetParticles(); }
    running = true;
    raf(frame);
  }

  function frame(ts) {
    if (paused || moving || !field || !C.wind.animate) { running = false; return; }
    var fps = windFps();
    if (ts - lastFrame < 1000 / fps) { raf(frame); return; }
    // Steps scale with the frame rate so streaks move at the same speed at 10 or 30 fps.
    stepScale = C.wind.fps / fps;
    lastFrame = ts;

    // Fade old trails toward transparent so the map shows through.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'rgba(0,0,0,' + C.wind.fade + ')';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';

    var paths = [], i;
    for (i = 0; i < COLORS.length; i++) { paths.push([]); }
    for (i = 0; i < particles.length; i++) {
      var p = particles[i], f = look(p.x, p.y);
      if (f < 0 || p.age++ > p.max || field[f + 2] < 0.5) { spawn(p); p.age = 0; continue; }
      var nx = p.x + field[f] * stepScale, ny = p.y + field[f + 1] * stepScale;
      paths[colorIdx(field[f + 2])].push(p.x, p.y, nx, ny);
      p.x = nx;
      p.y = ny;
    }
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (i = 0; i < paths.length; i++) {
      var seg = paths[i];
      if (!seg.length) { continue; }
      ctx.strokeStyle = COLORS[i];
      ctx.beginPath();
      for (var s = 0; s < seg.length; s += 4) { ctx.moveTo(seg[s], seg[s + 1]); ctx.lineTo(seg[s + 2], seg[s + 3]); }
      ctx.stroke();
    }
    raf(frame);
  }

  // No-animation fallback: a dense grid of speed-colored arrows.
  function drawStatic() {
    clearCanvas();
    if (!field) { return; }
    var step = 36;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (var y = step / 2; y < canvas.height; y += step) {
      for (var x = step / 2; x < canvas.width; x += step) {
        var f = look(x, y);
        if (f < 0 || field[f + 2] < 0.5) { continue; }
        var len = Math.sqrt(field[f] * field[f] + field[f + 1] * field[f + 1]);
        var dx = field[f] / len, dy = field[f + 1] / len, L2 = 9 + Math.min(field[f + 2], 30) / 3;
        var tx = x + dx * L2, ty = y + dy * L2;
        ctx.strokeStyle = COLORS[colorIdx(field[f + 2])];
        ctx.beginPath();
        ctx.moveTo(x - dx * L2, y - dy * L2);
        ctx.lineTo(tx, ty);
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - dx * 6 - dy * 4, ty - dy * 6 + dx * 4);
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - dx * 6 + dy * 4, ty - dy * 6 - dx * 4);
        ctx.stroke();
      }
    }
  }

  // Stop animating while a takeover or night mode covers the map.
  function setPaused(p) {
    if (p === paused) { return; }
    paused = p;
    if (p) { clearCanvas(); } else if (C.wind.animate) { start(); } else { drawStatic(); }
  }

  return { init: init, setPaused: setPaused };
})();
