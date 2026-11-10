// Shared helpers for the dashboard's Netlify Functions (server side, modern JS is fine here).
import { getStore } from '@netlify/blobs';
import { timingSafeEqual } from 'node:crypto';

export const TZ = process.env.DASH_TZ || 'America/Denver';

// One store for everything: tokens, OAuth state, cached data.
export function store() {
  return getStore({ name: 'dashboard', consistency: 'strong' });
}

// The secret key from the page URL (?key=...) or an X-Dash-Key header.
export function hasKey(req) {
  const expected = process.env.DASH_KEY || '';
  if (expected.length < 24) return false; // refuse to run with a missing or weak key
  const url = new URL(req.url);
  const given = req.headers.get('x-dash-key') || url.searchParams.get('key') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export function html(body, status = 200) {
  const page = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<title>Desk Dashboard</title><body style="font:18px system-ui,sans-serif;background:#0b0b0c;color:#ececea;padding:32px">' +
    body + '</body>';
  return new Response(page, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Epoch ms of local midnight on Jan 1 of the current year, in TZ.
export function yearStartMs(now = new Date(), tz = TZ) {
  const year = +new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(now);
  const guess = Date.UTC(year, 0, 1);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(guess)).map((x) => [x.type, x.value])
  );
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - guess;
  return { year, ms: guess - offset };
}

// Epoch ms of local midnight on the Monday of the current week, in TZ.
export function weekStartMs(now = new Date(), tz = TZ) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  // Offset between TZ wall-clock and UTC right now.
  const wallAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offset = wallAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  const mondayWallUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day - dow, 0, 0, 0);
  return mondayWallUtc - offset; // close enough across a DST change (off by at most an hour)
}
