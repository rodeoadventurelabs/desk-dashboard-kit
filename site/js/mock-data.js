/*
 * Mock data in the shape the scheduled function will produce (phase 3+).
 * Built relative to "today" so the mock always looks current.
 * Event "counts" is decided server-side in the real version (section 6 rules).
 */
window.buildMockData = function (base) {
  function t(h, m) {
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0, 0).getTime();
  }

  var weekIdx = (base.getDay() + 6) % 7; // Monday = 0
  var sample = [14.2, 0, 18.6, 12.3, 9.8, 32.5, 21.0];
  var daily = [];
  var miles = 0;
  for (var i = 0; i < 7; i++) {
    var v = i <= weekIdx ? sample[i] : null; // null = future day
    daily.push(v);
    if (v) { miles += v; }
  }

  var conds = ['partly', 'clear', 'clear', 'cloudy', 'snow', 'snow', 'partly', 'clear', 'rain', 'clear'];
  var highs = [52, 58, 61, 49, 34, 31, 42, 55, 47, 53];
  var lows  = [31, 33, 36, 29, 21, 18, 24, 30, 32, 29];
  var days = [];
  for (var d = 0; d < 10; d++) {
    days.push({
      date: new Date(base.getFullYear(), base.getMonth(), base.getDate() + d).getTime(),
      cond: conds[d], hi: highs[d], lo: lows[d]
    });
  }

  return {
    generatedAt: base.getTime(),

    events: [
      { id: 'e0', cal: 'family',   title: 'Recycling pickup', allDay: true, start: t(0, 0), end: t(23, 59) },
      { id: 'e1', cal: 'work',     title: 'Standup', type: 'meeting', start: t(9, 0), end: t(9, 30), where: 'Google Meet', counts: true },
      { id: 'e2', cal: 'personal', title: 'Lunch with a friend', type: 'lunch', start: t(11, 30), end: t(12, 30), where: 'Downtown', counts: true },
      { id: 'e3', cal: 'work',     title: 'Design review', type: 'meeting', start: t(14, 0), end: t(14, 45), where: 'Zoom', counts: true, link: 'https://www.google.com/calendar/' },
      { id: 'e4', cal: 'work',     title: 'Vendor call', type: 'call', start: t(16, 15), end: t(16, 45), where: 'Phone', counts: true },
      { id: 'e5', cal: 'family',   title: "Kid's soccer", type: 'meeting', start: t(17, 0), end: t(18, 0), where: 'Rec center', counts: false },
      { id: 'e6', cal: 'work',     title: 'Call with Dana', type: 'call', start: t(17, 30), end: t(17, 45), where: 'Phone', counts: true },
      { id: 'e7', cal: 'family',   title: 'Dinner with the Hendersons', type: 'lunch', start: t(19, 0), end: t(21, 0), where: 'Home', counts: true },
      // Tomorrow (shown below today; scroll to see).
      { id: 'e8', cal: 'work',     title: 'Team meeting', type: 'meeting', start: t(24 + 10, 0), end: t(24 + 10, 15), where: 'Google Meet', counts: true },
      { id: 'e9', cal: 'work',     title: 'Weekly 1:1', type: 'meeting', start: t(24 + 10, 30), end: t(24 + 11, 0), where: 'Google Meet', counts: true },
      { id: 'e10', cal: 'family',  title: 'Piano lesson', type: 'meeting', start: t(24 + 16, 0), end: t(24 + 17, 0), where: '', counts: false }
    ],

    tasks: [
      { title: 'Order chain lube', done: true },
      { title: 'Send invoices', done: false },
      { title: 'Review radar tile terms', done: false },
      { title: 'Book bike tune-up', done: true },
      { title: 'Reply to the contractor', done: false },
      { title: 'Post demo bikes', done: false },
      { title: 'Ricky bid', done: false },
      { title: 'Fix Woo deposit system', done: false },
      { title: 'Flat Tops edit', done: false }
    ],

    strava: {
      goalMi: window.DASH_CONFIG.strava.weeklyGoalMi,
      miles: Math.round(miles * 10) / 10,
      movingSec: Math.round(miles * 4.1 * 60),
      climbFt: Math.round(miles * 52),
      daily: daily,
      year: { year: base.getFullYear(), miles: 2187, rides: 143 },
      load: { ctl: 48, atl: 57, tsb: -9 }
    },

    weather: {
      current: { tempF: 48, feelsF: 44, cond: 'partly', code: 2, windMph: 12, windFrom: 315, gustMph: 19,
        cloudCover: 45, precipIn: 0, isDay: true },
      aqi: { value: 42 },
      alerts: [{ event: 'Winter Weather Advisory', severity: 'moderate' }],
      daily: days
    }
  };
};
