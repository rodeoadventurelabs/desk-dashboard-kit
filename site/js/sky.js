/*
 * Living sky for the header: a static sky (gradient from the sun's position, stars, horizon glow)
 * plus one transparent canvas for weather motion (clouds, rain, snow, leaves, lightning), and
 * static clock decorations (icicles, snow caps).
 *
 * Cost on the frame (measured): any continuous motion costs ~12-20% CPU, tracking frames per
 * second rather than particle count. So the canvas runs only while something moves, at the lowest
 * fps that looks right for the slowest-needed effect, and stops entirely on calm, clear skies.
 * ES5 only.
 */
window.Sky = (function () {
  'use strict';

  var box, staticCv, sctx, motionCv, mctx, clockEl, decoEl;
  var W = 0, H = 0;
  var scene = null, running = false, lastFrame = 0, paused = false;
  var clouds = [], drops = [], leaves = [], bolt = null, flashUntil = 0, nextFlash = 0;
  var cloudSprites = [], leafSprites = [];

  var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame ||
    function (fn) { return window.setTimeout(function () { fn(new Date().getTime()); }, 66); };

  // ---------- sun position (NOAA approximation, good to ~1 degree) ----------

  function sunAltitude(date, lat, lon) {
    var rad = Math.PI / 180;
    var jd = date.getTime() / 86400000 + 2440587.5;
    var n = jd - 2451545.0;
    var L = (280.46 + 0.9856474 * n) % 360;
    var g = ((357.528 + 0.9856003 * n) % 360) * rad;
    var lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
    var eps = (23.439 - 0.0000004 * n) * rad;
    var dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
    var ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
    var gmst = (18.697374558 + 24.06570982441908 * n) % 24;
    var lst = (gmst * 15 + lon) * rad;
    var ha = lst - ra;
    var alt = Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha));
    return alt / rad;
  }

  // ---------- colors ----------

  // Sky keyframes by sun altitude: [alt, top color, bottom color]. Muted to suit a dark dashboard.
  var SKY = [
    [-18, [7, 10, 22], [14, 20, 38]],
    [-10, [12, 18, 44], [38, 34, 72]],
    [-4, [26, 38, 82], [132, 74, 70]],
    [2, [38, 66, 118], [196, 128, 82]],
    [8, [36, 72, 126], [86, 126, 176]],
    [30, [32, 74, 132], [78, 122, 176]]
  ];

  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function rgb(c, alpha) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (alpha == null ? 1 : alpha) + ')';
  }

  function skyColors(alt, cloud) {
    var i, top = SKY[0][1], bottom = SKY[0][2];
    if (alt >= SKY[SKY.length - 1][0]) { top = SKY[SKY.length - 1][1]; bottom = SKY[SKY.length - 1][2]; }
    for (i = 0; i < SKY.length - 1; i++) {
      if (alt >= SKY[i][0] && alt < SKY[i + 1][0]) {
        var t = (alt - SKY[i][0]) / (SKY[i + 1][0] - SKY[i][0]);
        top = mix(SKY[i][1], SKY[i + 1][1], t);
        bottom = mix(SKY[i][2], SKY[i + 1][2], t);
      }
    }
    // Overcast: wash toward grey, brighter grey by day.
    var day = Math.max(0, Math.min(1, (alt + 6) / 14));
    var grey = mix([18, 20, 26], [74, 80, 92], day);
    var k = Math.min(1, cloud / 100) * 0.75;
    return { top: mix(top, grey, k), bottom: mix(bottom, grey, k * 0.9), day: day };
  }

  // ---------- sprites (drawn once, reused every frame) ----------

  function makeCloud(w, h, seed) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d'), s = seed;
    function rnd() { s = (s * 9301 + 49297) % 233280; return s / 233280; }
    x.fillStyle = '#fff';
    for (var i = 0; i < 7; i++) {
      var r = h * (0.25 + rnd() * 0.22);
      var cx = w * (0.18 + rnd() * 0.64), cy = h * (0.55 + rnd() * 0.15);
      var gr = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr;
      x.beginPath(); x.arc(cx, cy, r, 0, 6.283); x.fill();
    }
    return c;
  }

  // Leaf sprite, 36x22: big enough to read from across the desk.
  function makeLeaf(color) {
    var c = document.createElement('canvas');
    c.width = 36; c.height = 22;
    var x = c.getContext('2d');
    x.fillStyle = color;
    x.beginPath();
    x.moveTo(2, 11); x.quadraticCurveTo(18, -5, 34, 11); x.quadraticCurveTo(18, 27, 2, 11);
    x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(3, 11); x.lineTo(33, 11); x.stroke();
    return c;
  }

  // ---------- setup ----------

  function init(opts) {
    box = opts.box;
    clockEl = opts.clock;
    W = box.offsetWidth; H = box.offsetHeight;
    // The static sky is painted off-screen and set as the header's background image. An on-screen
    // canvas under the clock text didn't repaint reliably on the frame's WebView 44.
    staticCv = document.createElement('canvas');
    motionCv = document.createElement('canvas');
    motionCv.className = 'sky-motion';
    decoEl = document.createElement('div');
    decoEl.className = 'sky-deco';
    staticCv.width = motionCv.width = W;
    staticCv.height = motionCv.height = H;
    box.appendChild(decoEl);
    box.appendChild(motionCv);
    sctx = staticCv.getContext('2d');
    mctx = motionCv.getContext('2d');
    for (var i = 0; i < 3; i++) { cloudSprites.push(makeCloud(260 + i * 40, 110 + i * 10, 17 + i * 31)); }
    leafSprites = [makeLeaf('#c8643a'), makeLeaf('#d9a441'), makeLeaf('#9c4a2a'), makeLeaf('#b8862f')];
  }

  /*
   * scene: { sunAlt, cloud (0-100), precip: null|'rain'|'snow', intensity (0-1),
   *          windMph, windFrom (deg), gustMph, thunder (bool), tempF, stars (bool) }
   */
  function setScene(s) {
    var prev = scene;
    scene = s;
    drawStatic();
    decorateClock();
    // Rebuild particle sets when the kind or amount changes.
    if (!prev || prev.cloud !== s.cloud) { buildClouds(); }
    if (!prev || prev.precip !== s.precip || prev.intensity !== s.intensity) { buildDrops(); }
    if (!s.thunder) { bolt = null; flashUntil = 0; }
    else if (!nextFlash) { nextFlash = new Date().getTime() + 3000; }
    start();
  }

  function setPaused(p) {
    paused = p;
    if (p) { mctx.clearRect(0, 0, W, H); } else { start(); }
  }

  // ---------- static layer ----------

  function drawStatic() {
    var c = skyColors(scene.sunAlt, scene.cloud);
    var g = sctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(c.top));
    g.addColorStop(1, rgb(c.bottom));
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, W, H);
    // Stars on clear-ish nights.
    if (scene.sunAlt < -8 && scene.cloud < 60) {
      var s = 7, n = Math.round(70 * (1 - scene.cloud / 60));
      for (var i = 0; i < n; i++) {
        s = (s * 9301 + 49297) % 233280; var x = s / 233280 * W;
        s = (s * 9301 + 49297) % 233280; var y = s / 233280 * H * 0.85;
        s = (s * 9301 + 49297) % 233280; var a = 0.25 + (s / 233280) * 0.6;
        sctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')';
        sctx.fillRect(x, y, 1.6, 1.6);
      }
    }
    // Low sun: warm glow rising from the horizon (bottom edge). Linear gradients only: the
    // frame's WebView 44 drew an off-canvas radial gradient here with a hard vertical seam.
    if (scene.sunAlt > -8 && scene.sunAlt < 8) {
      var strength = (1 - Math.abs(scene.sunAlt) / 8) * (1 - scene.cloud / 140);
      var hg = sctx.createLinearGradient(0, H, 0, H * 0.25);
      hg.addColorStop(0, 'rgba(255,170,90,' + (0.42 * strength).toFixed(2) + ')');
      hg.addColorStop(1, 'rgba(255,170,90,0)');
      sctx.fillStyle = hg;
      sctx.fillRect(0, 0, W, H);
    }
    box.style.backgroundImage = 'url(' + staticCv.toDataURL('image/png') + ')';
    box.style.backgroundSize = W + 'px ' + H + 'px';
  }

  // ---------- clock decorations (static DOM, no animation cost) ----------

  function decorateClock() {
    decoEl.innerHTML = '';
    if (!clockEl || !scene) { return; }
    var frigid = scene.tempF != null && scene.tempF <= 20;
    var snowy = scene.precip === 'snow';
    if (!frigid && !snowy) { return; }
    var boxR = box.getBoundingClientRect();
    var digits = clockEl.querySelectorAll('.digit');
    var scale = boxR.width / box.offsetWidth || 1; // the preview scales the stage
    var html = '';
    for (var i = 0; i < digits.length; i++) {
      var r = digits[i].getBoundingClientRect();
      var left = (r.left - boxR.left) / scale, width = r.width / scale;
      var top = (r.top - boxR.top) / scale, height = r.height / scale;
      if (digits[i].textContent === ':') { continue; }
      // Digit tops sit ~18% down the line box for this font; baselines ~86% (measured in the lab).
      var capTop = top + height * 0.18, base = top + height * 0.86;
      if (snowy) {
        html += '<div class="snowcap" style="left:' + (left + width * 0.08).toFixed(0) + 'px;top:' + (capTop - 4).toFixed(0) +
          'px;width:' + (width * 0.84).toFixed(0) + 'px"></div>';
      }
      if (frigid) {
        // A frosty ledge along the digit's base with 3-4 icicles of varied length hanging from it.
        var n = 3 + (i % 2), svg = '<rect x="' + (width * 0.08).toFixed(1) + '" y="0" width="' + (width * 0.84).toFixed(1) +
          '" height="5" rx="2.5"/>';
        for (var k = 0; k < n; k++) {
          var x = width * (0.16 + k * 0.68 / (n - 1)) + ((i * 7 + k * 13) % 7) - 3;
          var len = 22 + ((i * 11 + k * 17) % 24), hw = 4 + ((i + k) % 3);
          svg += '<path d="M' + (x - hw).toFixed(1) + ' 3 Q' + x.toFixed(1) + ' ' + (len * 0.55).toFixed(1) + ' ' +
            x.toFixed(1) + ' ' + len + ' Q' + x.toFixed(1) + ' ' + (len * 0.55).toFixed(1) + ' ' + (x + hw).toFixed(1) + ' 3 Z"/>';
        }
        html += '<svg class="icicles" width="' + width.toFixed(0) + '" height="50" style="left:' + left.toFixed(0) +
          'px;top:' + (base - 3).toFixed(0) + 'px"><g fill="#dff0ff" fill-opacity="0.9">' + svg + '</g></svg>';
      }
    }
    decoEl.innerHTML = html;
  }

  // ---------- particles ----------

  function windDir() {
    // Screen x direction the wind blows toward (wind "from" the west blows left to right).
    var to = ((scene.windFrom || 270) + 180) % 360;
    return Math.sin(to * Math.PI / 180) >= 0 ? 1 : -1;
  }

  function buildClouds() {
    clouds = [];
    // Below 25% cover there are no drifting clouds: on the frame even one moving wisp costs
    // ~10-14% CPU, the same as a full sky.
    var n = (scene.cloud || 0) < 25 ? 0 : Math.round(scene.cloud / 14);
    for (var i = 0; i < n; i++) {
      // Keep clouds in the upper part of the sky so they don't wash out the clock digits.
      clouds.push({ x: Math.random() * (W + 300) - 300, y: -60 + Math.random() * (H * 0.3),
        s: cloudSprites[i % cloudSprites.length], k: 0.6 + Math.random() * 0.5 });
    }
  }

  function buildDrops() {
    drops = [];
    if (!scene.precip) { return; }
    var n = Math.round((scene.precip === 'snow' ? 70 : 60) + 140 * (scene.intensity || 0.5));
    for (var i = 0; i < n; i++) {
      drops.push({ x: Math.random() * W, y: Math.random() * H, v: 0.6 + Math.random() * 0.8, r: 1 + Math.random() * 2.2,
        p: Math.random() * 6.28 });
    }
  }

  function windy() { return Math.max(scene.windMph || 0, (scene.gustMph || 0) * 0.85) >= (scene.leafMph || 12); }

  // Frames per second needed by whatever is active; 0 = nothing moves, stop the loop.
  function neededFps() {
    if (!scene) { return 0; }
    var fps = 0;
    if (clouds.length) { fps = 6; }
    if (scene.precip === 'snow' || windy() || bolt || flashUntil) { fps = 12; }
    if (scene.precip === 'rain') { fps = 12; }  // 15 fps measured ~21% CPU; 12 looks the same
    if (scene.thunder && !fps) { fps = 4; } // just enough to time the next flash
    return fps;
  }

  function start() {
    if (running || paused || !neededFps()) {
      if (!neededFps()) { mctx.clearRect(0, 0, W, H); }
      return;
    }
    running = true;
    raf(frame);
  }

  function frame(ts) {
    var fps = neededFps();
    if (paused || !fps) { running = false; mctx.clearRect(0, 0, W, H); return; }
    raf(frame);
    if (ts - lastFrame < 1000 / fps) { return; }
    var dt = Math.min(0.25, lastFrame ? (ts - lastFrame) / 1000 : 0.1);
    lastFrame = ts;
    var now = new Date().getTime(), dir = windDir(), wind = scene.windMph || 0, i, p;
    mctx.clearRect(0, 0, W, H);

    // Clouds drift with the wind.
    var nightDim = scene.sunAlt < -6 ? 0.45 : 1;
    for (i = 0; i < clouds.length; i++) {
      p = clouds[i];
      p.x += dir * (4 + wind * 0.9) * p.k * dt;
      if (dir > 0 && p.x > W + 20) { p.x = -p.s.width; }
      if (dir < 0 && p.x < -p.s.width - 20) { p.x = W; }
      mctx.globalAlpha = (0.3 + (scene.cloud || 0) / 400) * nightDim;
      mctx.drawImage(p.s, p.x, p.y, p.s.width * p.k, p.s.height * p.k);
    }
    mctx.globalAlpha = 1;

    // Rain or snow.
    if (scene.precip === 'rain') {
      var slant = dir * Math.min(0.6, wind / 40);
      mctx.strokeStyle = 'rgba(170,200,255,0.55)';
      mctx.lineWidth = 1.4;
      mctx.beginPath();
      for (i = 0; i < drops.length; i++) {
        p = drops[i];
        p.y += 440 * p.v * dt; p.x += 440 * p.v * slant * dt;
        if (p.y > H) { p.y = -14; p.x = Math.random() * W; }
        if (p.x > W) { p.x -= W; } else if (p.x < 0) { p.x += W; }
        mctx.moveTo(p.x, p.y); mctx.lineTo(p.x - slant * 14, p.y - 14);
      }
      mctx.stroke();
    } else if (scene.precip === 'snow') {
      mctx.fillStyle = 'rgba(255,255,255,0.88)';
      mctx.beginPath();
      for (i = 0; i < drops.length; i++) {
        p = drops[i];
        p.p += dt;
        p.y += 34 * p.v * dt;
        p.x += (dir * wind * 1.6 * p.v + Math.sin(p.p * 1.3) * 10) * dt;
        if (p.y > H + 4) { p.y = -4; p.x = Math.random() * W; }
        if (p.x > W + 4) { p.x = -4; } else if (p.x < -4) { p.x = W + 4; }
        mctx.moveTo(p.x + p.r, p.y); mctx.arc(p.x, p.y, p.r, 0, 6.283);
      }
      mctx.fill();
    }

    // Leaves tumble past on windy days; more and faster as it gets windier.
    if (windy()) {
      // Spawn chance per frame scales with wind, so a few leaves are usually in view.
      var maxLeaves = Math.min(10, 3 + Math.round(wind / 4));
      if (leaves.length < maxLeaves && Math.random() < 0.12 + wind / 120) {
        leaves.push({ x: dir > 0 ? -24 : W + 24, y: Math.random() * H * 0.9, a: Math.random() * 6.28,
          spin: (Math.random() - 0.5) * 6, s: leafSprites[Math.floor(Math.random() * leafSprites.length)],
          v: 0.7 + Math.random() * 0.6, bob: Math.random() * 6.28, k: 0.8 + Math.random() * 0.6 });
      }
      for (i = leaves.length - 1; i >= 0; i--) {
        p = leaves[i];
        p.x += dir * (40 + wind * 6) * p.v * dt;
        p.bob += dt * 2.2; p.y += Math.sin(p.bob) * 22 * dt + 6 * dt;
        p.a += p.spin * dt;
        if (p.x < -40 || p.x > W + 40) { leaves.splice(i, 1); continue; }
        mctx.save(); mctx.translate(p.x, p.y); mctx.rotate(p.a); mctx.scale(p.k, p.k);
        mctx.drawImage(p.s, -18, -11); mctx.restore();
      }
    } else if (leaves.length) { leaves = []; }

    // Lightning: one flash with a bolt every 8-25 s. Two short pulses, well under 3 flashes/s.
    if (scene.thunder) {
      if (now >= nextFlash) {
        bolt = makeBolt();
        flashUntil = now + 320;
        nextFlash = now + 8000 + Math.random() * 17000;
      }
      if (flashUntil && now < flashUntil) {
        var phase = flashUntil - now; // 320 -> 0
        var a = phase > 200 ? 0.32 : (phase > 120 ? 0.06 : 0.16);
        mctx.fillStyle = 'rgba(220,230,255,' + a + ')';
        mctx.fillRect(0, 0, W, H);
        if (bolt && phase > 120) { drawBolt(bolt); }
      } else if (flashUntil) { flashUntil = 0; bolt = null; }
    }
  }

  function makeBolt() {
    var x = W * (0.15 + Math.random() * 0.7), y = 0, pts = [[x, y]];
    while (y < H * 0.95) { y += 12 + Math.random() * 18; x += (Math.random() - 0.5) * 34; pts.push([x, y]); }
    return pts;
  }

  function drawBolt(pts) {
    mctx.strokeStyle = 'rgba(255,255,240,0.95)';
    mctx.lineWidth = 2.4;
    mctx.beginPath();
    mctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) { mctx.lineTo(pts[i][0], pts[i][1]); }
    mctx.stroke();
  }

  // ---------- scene from live weather ----------

  /*
   * w: dashboard weather object (current + alerts); loc: {lat, lon}; now: Date.
   * Returns a scene for setScene. Thunder = thunderstorm weather code (95-99) or an active NWS
   * thunderstorm/tornado alert. Precip intensity from the current precipitation rate.
   */
  function sceneFromWeather(w, loc, now, opts) {
    var c = w.current || {}, alerts = w.alerts || [], code = c.code, i, ev;
    var precip = null;
    if (c.cond === 'snow' || (code >= 71 && code <= 77) || code === 85 || code === 86) { precip = 'snow'; }
    else if (c.cond === 'rain' || c.cond === 'storm' || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) { precip = 'rain'; }
    var rate = c.precipIn != null ? c.precipIn : null; // inches/hour
    var intensity = rate == null ? 0.5 : Math.max(0.15, Math.min(1, rate / 0.3));
    var thunder = code >= 95;
    for (i = 0; i < alerts.length; i++) {
      ev = String(alerts[i].event || '').toLowerCase();
      if (ev.indexOf('thunderstorm') !== -1 || ev.indexOf('tornado') !== -1) { thunder = true; }
      if (ev.indexOf('winter storm') !== -1 || ev.indexOf('blizzard') !== -1) { intensity = Math.max(intensity, 0.85); }
    }
    var cloud = c.cloudCover != null ? c.cloudCover :
      ({ clear: 5, partly: 45, cloudy: 90, fog: 100, rain: 85, snow: 90, storm: 95 })[c.cond] || 30;
    return {
      sunAlt: sunAltitude(now, loc.lat, loc.lon), cloud: cloud, precip: precip, intensity: intensity,
      windMph: c.windMph || 0, windFrom: c.windFrom || 270, gustMph: c.gustMph || 0,
      thunder: thunder, tempF: c.tempF, leafMph: (opts && opts.leafMph) || 12
    };
  }

  return { init: init, setScene: setScene, setPaused: setPaused, sceneFromWeather: sceneFromWeather,
    sunAltitude: sunAltitude, redecorate: decorateClock };
})();
