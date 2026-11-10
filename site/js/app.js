/*
 * Desk Dashboard: page logic.
 * ES5 only (no let/const, arrows, template strings, fetch, Element.closest):
 * the photo frame's WebView is old.
 *
 * Preview helpers (mock only):
 *   ?time=17:25      start the clock at that time today
 *   ?demo=split      jump to a preset; see DEMOS below
 */
(function () {
  'use strict';

  var C = window.DASH_CONFIG;
  var D = null;
  var offset = 0;
  var persist = true;
  var lastMinute = -1;
  var promptStartAt = 0;

  var S = {
    dismissed: {},      // takeover key -> true
    snoozedUntil: {},   // takeover id -> ms
    stayOnUntil: 0,     // night mode snoozed until
    nightNow: false,    // "Night mode now" tapped, or prompt timed out
    wakeAt: 0           // tapped the night screen
  };
  var overlaySig = null;

  var DEMOS = {
    morning: '08:10',
    takeover: '13:35',
    pulse: '13:57',
    split: '17:25',
    commute: '17:31',
    late: '17:50',
    nightprompt: '19:00',
    night: '19:03'
  };

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var DAYS3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var COND = { clear: 'Clear', partly: 'Partly cloudy', cloudy: 'Cloudy', rain: 'Rain',
    snow: 'Snow', storm: 'Thunderstorms', fog: 'Fog' };
  var TYPE = { call: 'Call', meeting: 'Meeting', lunch: 'Lunch' };
  var COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  // ---------- helpers ----------

  function $(id) { return document.getElementById(id); }
  function now() { return new Date(new Date().getTime() + offset); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function hm(d) { var h = d.getHours() % 12; if (h === 0) { h = 12; } return h + ':' + pad(d.getMinutes()); }
  function ap(d) { return d.getHours() < 12 ? 'AM' : 'PM'; }
  function hmap(d) { return hm(d) + ' ' + ap(d); }
  function at(base, str) {
    var p = str.split(':');
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), +p[0], +p[1], 0, 0);
  }
  function addMin(d, m) { return new Date(d.getTime() + m * 60000); }
  function minsBetween(a, b) { return (b.getTime() - a.getTime()) / 60000; }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function dayKey(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function comma(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function cleanTitle(t) { return t.replace(/\[home\s+\d+\]/ig, '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); }
  function query(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function closestAction(el) {
    while (el && el !== document) {
      if (el.getAttribute && el.getAttribute('data-action')) { return el; }
      el = el.parentNode;
    }
    return null;
  }
  function fmtDur(sec) {
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h ? h + 'h ' + m + 'm' : m + 'm';
  }

  // ---------- saved state (browser only in the mock; Blobs later) ----------

  function load() {
    if (!persist) { return; }
    try {
      var raw = window.localStorage.getItem('deskdash.state');
      if (raw) {
        var s = JSON.parse(raw);
        for (var k in s) { if (s.hasOwnProperty(k)) { S[k] = s[k]; } }
      }
    } catch (e) { /* storage unavailable: run without it */ }
  }
  function save() {
    if (!persist) { return; }
    try { window.localStorage.setItem('deskdash.state', JSON.stringify(S)); } catch (e) { /* ignore */ }
  }

  // ---------- icons (inline SVG strings) ----------

  var CLOUD = 'M7 19h10.5a4 4 0 0 0 .4-7.98A5.5 5.5 0 0 0 7.3 10.1 4.5 4.5 0 0 0 7 19z';

  function wxIcon(cond, size) {
    var s = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24">';
    if (cond === 'night') {
      s += '<path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.8A7 7 0 0 1 15.5 3.5z" fill="#c9c9c4"/>';
    } else if (cond === 'clear') {
      s += '<circle cx="12" cy="12" r="4.5" fill="#f2b36b"/>' +
        '<g stroke="#f2b36b" stroke-width="2" stroke-linecap="round">' +
        '<path d="M12 2.5v2.5M12 19v2.5M2.5 12h2.5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g>';
    } else if (cond === 'partly') {
      s += '<circle cx="9" cy="8" r="4" fill="#f2b36b"/>' +
        '<path d="' + CLOUD + '" fill="#9a9a96" transform="translate(2 1.5) scale(0.92)"/>';
    } else if (cond === 'cloudy' || cond === 'fog') {
      s += '<path d="' + CLOUD + '" fill="#9a9a96" transform="translate(0 -2)"/>';
      if (cond === 'fog') { s += '<path d="M5 21h14" stroke="#9a9a96" stroke-width="2" stroke-linecap="round"/>'; }
    } else {
      s += '<path d="' + CLOUD + '" fill="#9a9a96" transform="translate(0 -4)"/>';
      if (cond === 'rain') {
        s += '<path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" stroke="#5b8def" stroke-width="2" stroke-linecap="round"/>';
      } else if (cond === 'snow') {
        s += '<g fill="#ececea"><circle cx="8" cy="19" r="1.4"/><circle cx="12" cy="21" r="1.4"/><circle cx="16" cy="19" r="1.4"/></g>';
      } else {
        s += '<path d="M12.5 15l-2.5 4h3l-1.5 4" stroke="#f2b36b" stroke-width="2" fill="none" stroke-linejoin="round"/>';
      }
    }
    return s + '</svg>';
  }

  function typeIcon(type, size, color) {
    var st = ' fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    var s = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24">';
    if (type === 'call') {
      s += '<path' + st + ' d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>';
    } else if (type === 'lunch') {
      s += '<path' + st + ' d="M7 2v20M4 2v6a3 3 0 0 0 6 0V2M17 22V2c-2.5 1.5-3.5 4-3.5 8h3.5"/>';
    } else if (type === 'commute') {
      s += '<g' + st + '><circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/>' +
        '<path d="M5.5 16l4-8h6l3 8M9.5 8l3.5 8h-7.5M14 5h3"/></g>';
    } else {
      s += '<g' + st + '><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/>' +
        '<circle cx="17" cy="9" r="2.5"/><path d="M17 14.5a5 5 0 0 1 4.5 5"/></g>';
    }
    return s + '</svg>';
  }

  function arrowIcon(fromDeg, size, color) {
    // Arrow points where the wind is blowing toward.
    var rot = (fromDeg + 180) % 360;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24">' +
      '<g transform="rotate(' + rot + ' 12 12)" stroke="' + color + '" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 20V4M6 10l6-6 6 6"/></g></svg>';
  }

  // ---------- calendar ----------

  function todaysEvents(n) {
    var list = [];
    var dayStart = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    var dayEnd = dayStart + 86400000;
    for (var i = 0; i < D.events.length; i++) {
      var e = D.events[i];
      // All-day events show on every day they cover (e.g. a multi-day OOO block).
      if (e.allDay ? (e.start < dayEnd && e.end > dayStart) : sameDay(new Date(e.start), n)) { list.push(e); }
    }
    list.sort(function (a, b) { return a.start - b.start; });
    return list;
  }

  // Desktop (mouse) only: events link to Google Calendar. On the frame's touchscreen a tap
  // must never navigate the kiosk away, so links are plain text there.
  var CAN_LINK = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);

  function eventRow(e, n, showNow) {
    var cal = C.calendars[e.cal] || { color: '#9a9a96', mine: true };
    var s = new Date(e.start), en = new Date(e.end);
    var cls = 'ev';
    if (!e.counts) { cls += ' family'; }
    if (showNow && s <= n) { cls += ' current'; }
    var inner = '<div class="ev-bar" style="background:' + cal.color + '"></div>' +
      '<div class="ev-body"><div class="ev-time">' + hm(s) + ' – ' + hmap(en) +
      (showNow && s <= n && en > n ? '<span class="ev-tag">Now</span>' : '') + '</div>' +
      '<div class="ev-title">' + esc(cleanTitle(e.title)) + '</div></div>';
    if (CAN_LINK && e.link) {
      return '<a class="' + cls + ' ev-link" href="' + esc(e.link) + '" target="_blank" rel="noopener" title="Open in Google Calendar">' +
        inner + '</a>';
    }
    return '<div class="' + cls + '">' + inner + '</div>';
  }

  function renderEvents(n) {
    var evs = todaysEvents(n);
    var chips = '', rows = '', earlier = 0, i, e;
    for (i = 0; i < evs.length; i++) {
      e = evs[i];
      if (e.allDay) {
        chips += '<span class="chip">' + esc(cleanTitle(e.title)) + '</span>';
        continue;
      }
      // Finished events collapse into one "N earlier" line to keep the rest of the day on screen.
      if (new Date(e.end) <= n) { earlier++; continue; }
      rows += eventRow(e, n, true);
    }

    // Tomorrow, below today, for scrolling ahead.
    var tmr = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 12, 0, 0);
    var next = todaysEvents(tmr), nextRows = '', nextChips = '';
    for (i = 0; i < next.length; i++) {
      e = next[i];
      if (e.allDay) { nextChips += '<span class="chip">' + esc(cleanTitle(e.title)) + '</span>'; }
      else { nextRows += eventRow(e, n, false); }
    }
    var tomorrow = (nextRows || nextChips) ? '<div class="day-head">Tomorrow · ' + DAYS3[tmr.getDay()] + '</div>' +
      (nextChips ? '<div class="allday">' + nextChips + '</div>' : '') + nextRows : '';

    setKeepingScroll('events', (chips ? '<div class="allday">' + chips + '</div>' : '') +
      (earlier ? '<div class="earlier">' + earlier + ' earlier</div>' : '') +
      (rows || '<div class="muted">Nothing else today</div>') + tomorrow);
  }

  function renderTasks() {
    var html = '';
    for (var i = 0; i < D.tasks.length; i++) {
      var t = D.tasks[i];
      html += '<div class="task' + (t.done ? ' done' : '') + '"><div class="task-box"></div>' +
        '<div class="task-text">' + esc(t.title) + '</div></div>';
    }
    setKeepingScroll('tasks', html || '<div class="muted">No open tasks</div>');
  }

  // Scrollable lists: re-rendering keeps your place, but a list left alone for 60 seconds
  // returns to the top so the frame always rests on "now".
  var SCROLL_IDLE_MS = 60000;
  var scrolledAt = {}, selfScroll = {};

  // Move a list without it counting as the user scrolling.
  function scrollTo(id, top) {
    var box = $(id);
    if (box.scrollTop === top) { return; }
    selfScroll[id] = true;
    box.scrollTop = top;
  }

  function setKeepingScroll(id, html) {
    var box = $(id), top = box.scrollTop;
    box.innerHTML = html;
    var recent = scrolledAt[id] && new Date().getTime() - scrolledAt[id] < SCROLL_IDLE_MS;
    scrollTo(id, recent ? top : 0);
  }

  function watchScroll(id) {
    $(id).addEventListener('scroll', function () {
      if (selfScroll[id]) { selfScroll[id] = false; return; }
      scrolledAt[id] = new Date().getTime();
    }, false);
    setInterval(function () {
      if (scrolledAt[id] && new Date().getTime() - scrolledAt[id] >= SCROLL_IDLE_MS) {
        scrolledAt[id] = 0;
        scrollTo(id, 0);
      }
    }, 5000);
  }

  // ---------- Strava ----------

  function renderStrava(n) {
    var st = D.strava;
    var pct = st.goalMi ? st.miles / st.goalMi : 0;
    var r = 47, c = 2 * Math.PI * r;
    var fill = Math.min(pct, 1) * c;
    var ring = '<div class="ring"><svg width="112" height="112" viewBox="0 0 112 112">' +
      '<circle cx="56" cy="56" r="' + r + '" fill="none" stroke="#2c2c2f" stroke-width="10"/>' +
      '<circle cx="56" cy="56" r="' + r + '" fill="none" stroke="#F26A2E" stroke-width="10" stroke-linecap="round"' +
      ' stroke-dasharray="' + fill.toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 56 56)"/></svg>' +
      '<div class="ring-pct">' + Math.round(pct * 100) + '%</div></div>';

    var src = st.source === 'live' ? (st.stale ? 'stale' : 'via Strava') : 'mock';
    var stats = '<div class="strava-stats"><div class="miles">' + st.miles.toFixed(1) +
      '<span class="of">/ ' + st.goalMi + ' mi</span></div>' +
      '<div class="strava-sub"><span>' + fmtDur(st.movingSec) + '</span><span>' + comma(st.climbFt) + ' ft</span></div>' +
      '<div class="strava-ytd">' + (st.year ? st.year.year + ': <b>' + comma(st.year.miles) + ' mi</b> · ' : '') +
      '<span class="strava-src' + (st.stale ? ' amber' : '') + '">' + src + '</span></div>' +
      loadLine(st.load) + '</div>';

    var max = 0, i;
    for (i = 0; i < 7; i++) { if (st.daily[i] > max) { max = st.daily[i]; } }
    var todayIdx = (n.getDay() + 6) % 7;
    var letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    var bars = '<div class="bars">';
    for (i = 0; i < 7; i++) {
      var v = st.daily[i];
      var bar;
      if (v === null || v === undefined) { bar = '<div class="bar future"></div>'; }
      else if (v === 0) { bar = '<div class="bar zero"></div>'; }
      else { bar = '<div class="bar" style="height:' + Math.max(4, Math.round(v / max * 80)) + 'px"></div>'; }
      bars += '<div class="bar-col' + (i === todayIdx ? ' today' : '') + '"><div class="bar-wrap">' + bar +
        '</div><div class="bar-day">' + letters[i] + '</div></div>';
    }
    bars += '</div>';

    $('strava').innerHTML = ring + stats + bars;
  }

  // Training load: CTL (fitness), ATL (fatigue), TSB (form). The switch hides the numbers.
  var showLoad = C.strava.showLoad !== false;
  try {
    var savedLoad = window.localStorage.getItem('deskdash.showLoad');
    if (savedLoad !== null) { showLoad = savedLoad === '1'; }
  } catch (e) { /* storage unavailable: use the config default */ }

  // TSB bands: below -30 is overreaching risk; -30 to -10 is productive training; above +5 is fresh.
  function tsbClass(tsb) {
    if (tsb < -30) { return 'red'; }
    if (tsb < -10) { return 'green'; }
    if (tsb > 5) { return 'blue'; }
    return 'muted';
  }

  function loadLine(load) {
    var sw = '<span class="switch' + (showLoad ? ' on' : '') + '"><span class="knob"></span></span>';
    if (!showLoad) {
      return '<div class="strava-load off" data-action="toggle-load">Load ' + sw + '</div>';
    }
    if (!load) {
      return '<div class="strava-load" data-action="toggle-load"><span class="muted">Load —</span> ' + sw + '</div>';
    }
    var t = load.tsb > 0 ? '+' + load.tsb : (load.tsb < 0 ? '−' + Math.abs(load.tsb) : '0');
    return '<div class="strava-load" data-action="toggle-load">CTL <b>' + load.ctl + '</b>ATL <b>' + load.atl +
      '</b>TSB <b class="' + tsbClass(load.tsb) + '">' + t + '</b>' + sw + '</div>';
  }

  function onStravaClick(ev) {
    var el = closestAction(ev.target);
    if (!el || el.getAttribute('data-action') !== 'toggle-load') { return; }
    showLoad = !showLoad;
    try { window.localStorage.setItem('deskdash.showLoad', showLoad ? '1' : '0'); } catch (e) { /* ignore */ }
    renderStrava(now());
  }

  // ---------- weather ----------

  function aqiColor(v) { return v <= 50 ? '#8fd8a8' : (v <= 100 ? '#f2b36b' : '#f28b82'); }
  function compass(deg) { return COMPASS[Math.round(deg / 45) % 8]; }

  var mapWindSeen = false; // once the map reports wind at its center, the pill follows the map

  function renderRadar() {
    var w = D.weather, v = w.aqi ? w.aqi.value : null;
    $('aqi-pill').innerHTML = v == null ? '<span class="dot" style="background:#6c6c69"></span>AQI —' :
      '<span class="dot" style="background:' + aqiColor(v) + '"></span>AQI ' + v;
    if (!mapWindSeen) { renderWindPill(w.current.windMph, w.current.windFrom); }
  }

  function renderWindPill(mph, from) {
    $('wind-pill').innerHTML = arrowIcon(from, 18, '#ececea') + mph + ' mph ' + compass(from);
  }

  // ---------- living sky (header) ----------

  var skyReady = false;

  function startSky() {
    if (!window.Sky) { return; }
    window.Sky.init({ box: $('head'), clock: $('clock') });
    skyReady = true;
    updateSky();
  }

  // Scene from the current weather and the sun's position; called on new weather and each minute.
  function updateSky() {
    if (!skyReady || !D || !D.weather) { return; }
    var loc = C.map.locations.work;
    window.Sky.setScene(window.Sky.sceneFromWeather(D.weather, { lat: loc.lat, lon: loc.lon }, now(),
      { leafMph: C.sky.leafMph }));
  }

  function startMap() {
    if (query('wind') === 'static') { C.map.wind.animate = false; }
    window.DashMap.init({
      onRadarTime: function (d) { $('radar-stamp').innerHTML = 'Radar · ' + hm(d); },
      // Live wind at the map center replaces the mock value in the pill.
      onWind: function (mph, from) { mapWindSeen = true; renderWindPill(mph, from); },
      onError: function (msg) { if (window.console) { window.console.warn(msg); } }
    });
  }

  function renderNow() {
    var w = D.weather, c = w.current, alerts = w.alerts;
    var night = c.isDay === false && (c.cond === 'clear' || c.cond === 'partly');
    var src = w.source === 'live' ?
      (w.stale ? '<span class="amber">stale ' + hm(new Date(w.fetchedAt)) + '</span>' : hm(new Date(w.fetchedAt))) :
      'mock';
    // Portrait header, right side: icon + temperature, then short lines under it.
    var html = '<div class="now-top"><div class="now-icon">' + wxIcon(night ? 'night' : c.cond, 70) + '</div>' +
      '<div class="now-temp">' + c.tempF + '<sup>°</sup></div></div>' +
      // The data source ("1:45", "mock", "stale 1:45") rides on the conditions line to save a row.
      '<div class="now-cond">' + (night && c.cond === 'clear' ? 'Clear night' : COND[c.cond]) +
        ' <span class="now-src">· ' + src + '</span></div>' +
      '<div class="now-feels">Feels ' + c.feelsF + '° · Wind ' + c.windMph + ' mph</div>';
    if (alerts && alerts.length) {
      var sev = alerts[0].severity === 'severe' || alerts[0].severity === 'extreme';
      html += '<div class="alert-pill' + (sev ? ' severe' : '') + '">' + esc(alerts[0].event) +
        (alerts.length > 1 ? ' +' + (alerts.length - 1) : '') + '</div>';
    }
    $('now').innerHTML = html;
  }

  function renderForecast() {
    var html = '';
    var days = D.weather.daily;
    for (var i = 0; i < days.length && i < 10; i++) {
      var d = days[i];
      // Live data sends local dates as YYYY-MM-DD; mock data sends epoch ms.
      var dd = typeof d.date === 'string' ?
        new Date(+d.date.slice(0, 4), +d.date.slice(5, 7) - 1, +d.date.slice(8, 10)) : new Date(d.date);
      // One column per day in the portrait strip.
      html += '<div class="fd' + (i === 0 ? ' today' : '') + '"><div class="fd-day">' + (i === 0 ? 'Today' : DAYS3[dd.getDay()]) + '</div>' +
        '<div class="fd-icon">' + wxIcon(d.cond, 34) + '</div>' +
        '<div class="fd-hi">' + d.hi + '°</div><div class="fd-lo">' + d.lo + '°</div></div>';
    }
    $('forecast').innerHTML = html;
  }

  // ---------- commute ----------

  function bufferFor(e) {
    var text = e.title + ' ' + (e.description || '');
    var m = /\[home\s+(\d+)\]/i.exec(text);
    if (m) { return +m[1]; }
    var kb = C.commute.keywordBuffers, lower = e.title.toLowerCase();
    for (var k in kb) { if (kb.hasOwnProperty(k) && lower.indexOf(k) !== -1) { return kb[k]; } }
    return C.commute.defaultBufferMin;
  }

  function commuteModel(n) {
    var cc = C.commute;
    var onDay = false;
    for (var i = 0; i < cc.days.length; i++) { if (cc.days[i] === n.getDay()) { onDay = true; } }
    if (!onDay) { return null; }

    var dflt = at(n, cc.homeBy), homeBy = dflt, why = null;
    var evs = todaysEvents(n);
    for (i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (e.allDay || !e.counts) { continue; }
      var s = new Date(e.start);
      if (s < dflt) { continue; }
      var candidate = addMin(s, -bufferFor(e));
      if (candidate < homeBy) { homeBy = candidate; why = e; }
    }

    var routes = [];
    for (i = 0; i < cc.routes.length; i++) {
      var r = cc.routes[i];
      var leaveBy = addMin(homeBy, -(r.min + cc.packMin));
      var eta = addMin(n, cc.packMin + r.min);
      var slack = Math.floor(minsBetween(n, leaveBy));
      var status = slack >= 10 ? 'green' : (slack >= 0 ? 'amber' : 'red');
      routes.push({ r: r, leaveBy: leaveBy, eta: eta, slack: slack, status: status,
        late: Math.ceil(minsBetween(homeBy, eta)) });
    }

    var longest = routes[routes.length - 1], best = null;
    for (i = routes.length - 1; i >= 0; i--) { if (routes[i].slack >= 0) { best = routes[i]; break; } }
    var nudge;
    if (best === longest) {
      // Short wording: one line in the portrait commute card.
      nudge = { text: 'Long way still on. Pack up by ' + hm(longest.leaveBy) + '.', cls: longest.status };
    } else if (best) {
      nudge = { text: "Long way's gone. " + best.r.name + ': pack up by ' + hm(best.leaveBy) + '.', cls: best.status };
    } else {
      nudge = { text: "You'll be late. Go now, quick route.", cls: 'red' };
    }

    return { homeBy: homeBy, why: why, routes: routes, nudge: nudge, quickLeaveBy: routes[0].leaveBy };
  }

  function renderCommute(n) {
    var m = commuteModel(n);
    if (!m) {
      $('commute').innerHTML = '<div class="card-title">Commute</div><div class="commute-off">No commute today</div>';
      return;
    }
    var html = '<div class="commute-head"><div class="card-title">Commute</div><div class="homeby">Home by ' + hmap(m.homeBy) +
      (m.why ? '<span class="homeby-why">' + esc(cleanTitle(m.why.title)).substring(0, 26) + ' · ' + hm(new Date(m.why.start)) +
        ' −' + bufferFor(m.why) + 'm</span>' : '') + '</div></div>';
    for (var i = 0; i < m.routes.length; i++) {
      var x = m.routes[i];
      var slackText = x.status === 'red' ? 'late ' + x.late + 'm' : x.slack + 'm';
      html += '<div class="route"><div class="route-name"><span class="dot bg-' + x.status + '"></span>' + esc(x.r.name) + '</div>' +
        '<div class="route-leave">by ' + hm(x.leaveBy) + '</div>' +
        '<div class="route-slack ' + x.status + '">' + slackText + '</div></div>';
    }
    html += '<div class="nudge ' + m.nudge.cls + '">' + esc(m.nudge.text) + '</div>';
    $('commute').innerHTML = html;
  }

  // ---------- night mode ----------

  function nightState(n) {
    var nc = C.night, t = n.getTime();
    var mins = n.getHours() * 60 + n.getMinutes();
    var sp = nc.start.split(':'), ep = nc.end.split(':');
    var ns = +sp[0] * 60 + +sp[1], ne = +ep[0] * 60 + +ep[1];
    var inWin = ns > ne ? (mins >= ns || mins < ne) : (mins >= ns && mins < ne);
    if (!inWin) {
      if (S.nightNow || S.wakeAt) { S.nightNow = false; S.wakeAt = 0; save(); }
      return 'off';
    }
    if (S.stayOnUntil > t) { return 'off'; }
    if (S.wakeAt) {
      if (t - S.wakeAt < nc.promptSec * 1000) { promptStartAt = S.wakeAt; return 'wake'; }
      S.wakeAt = 0; S.nightNow = true; save();
      return 'night';
    }
    if (S.nightNow) { return 'night'; }

    var winStart = at(n, nc.start);
    if (mins < ns) { winStart = new Date(winStart.getTime() - 86400000); }
    promptStartAt = Math.max(winStart.getTime(), S.stayOnUntil);
    if (t - promptStartAt < nc.promptSec * 1000) { return 'prompt'; }
    S.nightNow = true; save();
    return 'night';
  }

  // ---------- takeovers ----------

  function activeTakeovers(n) {
    var list = [], tc = C.takeover, t = n.getTime();
    var evs = todaysEvents(n), i;
    for (i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (e.allDay || !e.counts) { continue; }
      var m = minsBetween(n, new Date(e.start));
      if (m <= 0 || m > tc.firstMin) { continue; }
      var pulse = m <= tc.pulseMin;
      var key = e.id + ':' + (pulse ? '5' : '30');
      if (S.dismissed[key]) { continue; }
      if (!pulse && S.snoozedUntil[e.id] > t) { continue; }
      list.push({ kind: 'event', id: e.id, key: key, ev: e, due: e.start, pulse: pulse });
    }
    var cm = commuteModel(n);
    if (cm) {
      var since = minsBetween(cm.quickLeaveBy, n);
      var ckey = 'commute:' + dayKey(n);
      if (since >= 0 && since < C.commute.takeoverWindowMin && !S.dismissed[ckey] && !(S.snoozedUntil[ckey] > t)) {
        list.push({ kind: 'commute', id: ckey, key: ckey, model: cm, due: cm.quickLeaveBy.getTime(), pulse: false });
      }
    }
    list.sort(function (a, b) { return a.due - b.due; });
    return list;
  }

  function takeoverHtml(x, color, extra) {
    var band, body, actions;
    if (x.kind === 'event') {
      var e = x.ev, cal = C.calendars[e.cal] || { name: '' };
      band = typeIcon(e.type, 30, '#0b0b0c') + '<span>' + esc(cal.name) + ' · ' + (TYPE[e.type] || 'Event') + '</span>';
      body = '<div class="to-label">Starts in</div>' +
        '<div class="to-count" data-until="' + e.start + '"></div>' +
        '<div class="to-title">' + esc(cleanTitle(e.title)) + '</div>' +
        '<div class="to-meta">' + hm(new Date(e.start)) + ' – ' + hmap(new Date(e.end)) + '</div>' +
        (e.where ? '<div class="to-meta2">' + esc(e.where) + '</div>' : '');
      actions = '<button class="btn primary" data-action="got" data-key="' + x.key + '">Got it</button>' +
        (x.pulse ? '' : '<button class="btn" data-action="snooze" data-key="' + x.id + '">Snooze ' + C.takeover.snoozeMin + ' min</button>');
    } else {
      var q = x.model.routes[0];
      band = typeIcon('commute', 30, '#0b0b0c') + '<span>Commute · ' + esc(q.r.name) + ' route</span>';
      body = '<div class="to-label">Last call</div>' +
        '<div class="to-count" data-commute="1"></div>' +
        '<div class="to-title">Pack up and ride</div>' +
        '<div class="to-meta">Home by ' + hmap(x.model.homeBy) + '</div>' +
        '<div class="to-meta2">' + q.r.min + ' min ride + ' + C.commute.packMin + ' min pack-up · ETA <span data-eta="1"></span></div>';
      actions = '<button class="btn primary" data-action="got" data-key="' + x.key + '">Got it</button>' +
        '<button class="btn" data-action="snooze" data-key="' + x.key + '">Snooze ' + C.takeover.snoozeMin + ' min</button>';
    }
    return '<div class="to ' + color + (x.pulse ? ' pulse' : '') + '">' +
      '<div class="to-band">' + band + (extra ? '<span class="more">' + extra + '</span>' : '') + '</div>' +
      '<div class="to-body">' + body + '</div><div class="to-actions">' + actions + '</div></div>';
  }

  function renderOverlay(n) {
    var ov = $('overlay');
    var ns = nightState(n);
    var list = [], sig, html = '';
    if (ns !== 'off') {
      sig = ns;
    } else {
      list = activeTakeovers(n);
      var parts = [];
      for (var i = 0; i < list.length; i++) { parts.push(list[i].key); }
      sig = parts.join('|');
    }

    if (sig !== overlaySig) {
      overlaySig = sig;
      ov.className = 'overlay';
      if (ns === 'night') {
        ov.className += ' night-bg';
        html = '<div class="night" data-action="wake"><div class="night-clock" data-clock="1"></div><div class="night-date" data-date="1"></div></div>';
      } else if (ns === 'prompt' || ns === 'wake') {
        html = '<div class="np"><div class="np-title">' + (ns === 'wake' ? 'Back to night mode in ' : 'Night mode starting in ') +
          '<span class="np-count" data-np="1"></span></div>' +
          '<div class="np-sub">Calendar, tasks, and alerts stay hidden until ' + hmap(at(n, C.night.end)) + '.</div>' +
          '<div class="np-actions"><button class="btn primary" data-action="stay">Stay on ' + (C.night.stayOnMin / 60) + ' hour</button>' +
          '<button class="btn" data-action="nightnow">' + (ns === 'wake' ? 'Back to night mode' : 'Night mode now') + '</button></div></div>';
      } else if (list.length === 1) {
        html = takeoverHtml(list[0], 'orange');
      } else if (list.length >= 2) {
        ov.className += ' split';
        html = takeoverHtml(list[0], 'orange') +
          takeoverHtml(list[1], 'blue', list.length > 2 ? '+' + (list.length - 2) + ' more' : '');
      } else {
        ov.className += ' hidden';
      }
      ov.innerHTML = html;
      // Don't spend CPU animating wind under a takeover or night mode.
      // Don't spend CPU animating wind or sky under a takeover or night mode.
      var covered = ov.className.indexOf('hidden') === -1;
      if (window.DashMap) { window.DashMap.setPaused(covered); }
      if (window.Sky && skyReady) { window.Sky.setPaused(covered); }
    }
    updateOverlayText(n);
    renderTopbar(n, ns, list);
  }

  function updateOverlayText(n) {
    var ov = $('overlay'), els, i;
    els = ov.querySelectorAll('[data-until]');
    for (i = 0; i < els.length; i++) {
      var secs = Math.max(0, Math.round((+els[i].getAttribute('data-until') - n.getTime()) / 1000));
      els[i].innerHTML = secs >= 60 ? Math.ceil(secs / 60) + ' min' : '0:' + pad(secs);
    }
    var cm = null;
    els = ov.querySelectorAll('[data-commute]');
    if (els.length) {
      cm = commuteModel(n);
      var q = cm.routes[0];
      els[0].innerHTML = q.slack >= 0 ? 'Go now' : 'Late ' + q.late + 'm';
    }
    els = ov.querySelectorAll('[data-eta]');
    for (i = 0; i < els.length; i++) { els[i].innerHTML = hm((cm || commuteModel(n)).routes[0].eta); }
    els = ov.querySelectorAll('[data-np]');
    for (i = 0; i < els.length; i++) {
      var left = Math.max(0, Math.ceil(C.night.promptSec - (n.getTime() - promptStartAt) / 1000));
      els[i].innerHTML = Math.floor(left / 60) + ':' + pad(left % 60);
    }
    els = ov.querySelectorAll('[data-clock]');
    for (i = 0; i < els.length; i++) { els[i].innerHTML = hm(n); }
    els = ov.querySelectorAll('[data-date]');
    for (i = 0; i < els.length; i++) { els[i].innerHTML = DAYS[n.getDay()] + ', ' + MONTHS[n.getMonth()] + ' ' + n.getDate(); }
  }

  // Slim bar: counting events within 30 min that aren't on screen as a takeover.
  function renderTopbar(n, ns, list) {
    var bar = $('topbar'), stage = $('stage');
    var shown = {}, i;
    for (i = 0; i < list.length; i++) { shown[list[i].id] = true; }
    var next = null;
    if (ns === 'off' && !list.length) {
      var evs = todaysEvents(n);
      for (i = 0; i < evs.length; i++) {
        var e = evs[i];
        if (e.allDay || !e.counts || shown[e.id]) { continue; }
        var m = minsBetween(n, new Date(e.start));
        if (m > 0 && m <= C.takeover.firstMin) { next = e; break; }
      }
    }
    if (!next) {
      bar.className = 'topbar hidden';
      stage.className = '';
      return;
    }
    var mins = Math.ceil(minsBetween(n, new Date(next.start)));
    bar.innerHTML = '<span class="dot"></span>' + esc(cleanTitle(next.title)) + ' in ' + mins + ' min' +
      '<span class="muted">' + hmap(new Date(next.start)) + (next.where ? ' · ' + esc(next.where) : '') + '</span>';
    bar.className = 'topbar';
    stage.className = 'with-bar';
  }

  function onOverlayClick(ev) {
    var el = closestAction(ev.target);
    if (!el) { return; }
    var action = el.getAttribute('data-action'), key = el.getAttribute('data-key');
    var t = now().getTime();
    if (action === 'got') { S.dismissed[key] = true; }
    else if (action === 'snooze') { S.snoozedUntil[key] = t + C.takeover.snoozeMin * 60000; }
    else if (action === 'stay') { S.stayOnUntil = t + C.night.stayOnMin * 60000; S.nightNow = false; S.wakeAt = 0; }
    else if (action === 'nightnow') { S.nightNow = true; S.wakeAt = 0; }
    else if (action === 'wake') { S.wakeAt = t; }
    save();
    overlaySig = null;
    tick(true);
  }

  // ---------- live data (/api/data) ----------

  var KEY = query('key');

  // Days after today are "future" (no bar) rather than zero.
  function liveStrava(s, n) {
    var todayIdx = (n.getDay() + 6) % 7, daily = [];
    for (var i = 0; i < 7; i++) { daily.push(i <= todayIdx ? s.daily[i] : null); }
    return { goalMi: C.strava.weeklyGoalMi, miles: s.miles, movingSec: s.movingSec, climbFt: s.climbFt,
      daily: daily, year: s.year || null, load: s.load || null, source: 'live', stale: !!s.stale };
  }

  function loadLive() {
    if (!KEY) { return; } // no key: stay on mock data
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/data?key=' + encodeURIComponent(KEY) + '&_=' + new Date().getTime(), true);
    xhr.timeout = 20000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      if (xhr.status !== 200) { if (window.console) { window.console.warn('Live data failed: ' + xhr.status); } return; }
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
      if (data.strava) {
        D.strava = liveStrava(data.strava, now());
        renderStrava(now());
      }
      if (data.weather) {
        var w = data.weather;
        D.weather = {
          current: w.current, daily: w.daily, alerts: w.alerts || [],
          aqi: w.aqi || { value: null }, source: 'live', stale: !!w.stale, fetchedAt: w.fetchedAt
        };
        renderNow();
        renderForecast();
        renderRadar();
        updateSky();
      }
      if (data.google) {
        D.events = data.google.events || [];
        D.tasks = data.google.tasks || [];
        D.googleStale = !!data.google.stale;
        renderEvents(now());
        renderTasks();
        renderCommute(now());
        overlaySig = null; // re-check takeovers against the real calendar
      }
    };
    xhr.send();
  }

  // ---------- main loop ----------

  var lastClockText = '';

  function renderClock(n) {
    // Each character in its own span, so the sky can hang icicles / snow caps on the digits.
    // Rebuilt only when the minute changes.
    var t = hm(n);
    if (t !== lastClockText) {
      lastClockText = t;
      var html = '';
      for (var i = 0; i < t.length; i++) { html += '<span class="digit">' + t.charAt(i) + '</span>'; }
      $('clock').innerHTML = html;
      if (window.Sky && skyReady) { window.Sky.redecorate(); }
    }
    $('ampm').innerHTML = ap(n);
    $('date').innerHTML = DAYS[n.getDay()] + ', ' + MONTHS[n.getMonth()] + ' ' + n.getDate();
  }

  function renderAll(n) {
    renderEvents(n);
    renderTasks();
    renderStrava(n);
    renderRadar();
    renderNow();
    renderForecast();
    renderCommute(n);
  }

  function tick(force) {
    var n = now();
    renderClock(n);
    var minute = Math.floor(n.getTime() / 60000);
    if (force || minute !== lastMinute) {
      lastMinute = minute;
      renderEvents(n);
      renderCommute(n);
      if (minute % 5 === 0) { updateSky(); } // the sun moves; repaint the sky every 5 minutes
    }
    renderOverlay(n);
  }

  // Scale the fixed 800x1280 portrait stage to fit other screens (preview only; 1:1 on the frame).
  var STAGE_W = 800, STAGE_H = 1280;
  function fit() {
    var w = window.innerWidth, h = window.innerHeight;
    var s = Math.min(w / STAGE_W, h / STAGE_H);
    var stage = $('stage');
    var tf = s > 0.999 && s < 1.001 ? '' : 'translate(' + Math.round((w - STAGE_W * s) / 2) + 'px,' +
      Math.round((h - STAGE_H * s) / 2) + 'px) scale(' + s + ')';
    stage.style.webkitTransform = tf;
    stage.style.transform = tf;
  }

  function init() {
    var demo = query('demo'), t = query('time') || (demo && DEMOS[demo]);
    if (t) {
      var real = new Date();
      offset = at(real, t).getTime() - real.getTime();
      persist = false; // previews shouldn't leave state behind
    }
    load();

    // Phase 3 replaces this with a poll of the cached JSON (every 2-5 min).
    D = window.buildMockData(now());

    fit();
    window.addEventListener('resize', fit);
    $('overlay').addEventListener('click', onOverlayClick);
    $('strava').addEventListener('click', onStravaClick);
    watchScroll('events');
    watchScroll('tasks');

    renderAll(now());
    startMap();
    tick(true);
    startSky();
    setInterval(function () { tick(false); }, 1000);

    loadLive();
    setInterval(loadLive, 3 * 60 * 1000); // server caches; this is cheap
  }

  init();
})();
