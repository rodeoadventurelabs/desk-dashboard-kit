// Strava API v3: OAuth tokens (kept in Blobs, rotated on refresh) and the weekly ride summary.
import { store, weekStartMs, yearStartMs, TZ } from './common.mjs';

const TOKEN_KEY = 'strava/tokens';
const CACHE_KEY = 'strava/week';
const YEAR_KEY = 'strava/year';
const YEAR_MAX_AGE = 60 * 60 * 1000; // the yearly total only needs an hourly refresh
const API = 'https://www.strava.com/api/v3';

// Bike rides that count toward the weekly goal.
const RIDE_TYPES = new Set([
  'Ride', 'GravelRide', 'MountainBikeRide', 'EBikeRide', 'EMountainBikeRide', 'VirtualRide', 'Velomobile', 'Handcycle'
]);

// Read-only. activity:read_all (not activity:read) so rides set to "Only You" still count.
export const SCOPE = 'read,activity:read_all';

export function authorizeUrl(origin, state) {
  const u = new URL('https://www.strava.com/oauth/authorize');
  u.searchParams.set('client_id', process.env.STRAVA_CLIENT_ID || '');
  u.searchParams.set('redirect_uri', origin + '/api/strava/callback');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('approval_prompt', 'auto');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('state', state);
  return u.toString();
}

async function tokenRequest(params) {
  const body = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID || '',
    client_secret: process.env.STRAVA_CLIENT_SECRET || '',
    ...params
  });
  const res = await fetch('https://www.strava.com/oauth/token', { method: 'POST', body });
  if (!res.ok) throw new Error('Strava token request failed: ' + res.status);
  return res.json();
}

function keep(t) {
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at };
}

// Exchange the OAuth code from the callback; returns the athlete's first name.
export async function exchangeCode(code, grantedScope) {
  const t = await tokenRequest({ code, grant_type: 'authorization_code' });
  await store().setJSON(TOKEN_KEY, { ...keep(t), scope: grantedScope || '', athlete: t.athlete ? t.athlete.id : null, saved_at: Date.now() });
  return t.athlete ? t.athlete.firstname : '';
}

export async function isConnected() {
  return Boolean(await store().get(TOKEN_KEY, { type: 'json' }));
}

// A valid access token, refreshing (and saving the rotated refresh token) when close to expiry.
async function accessToken() {
  const s = store();
  const saved = await s.get(TOKEN_KEY, { type: 'json' });
  if (!saved) return null;
  if (saved.expires_at * 1000 > Date.now() + 5 * 60 * 1000) return saved.access_token;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refresh_token });
  await s.setJSON(TOKEN_KEY, { ...saved, ...keep(t), saved_at: Date.now() });
  return t.access_token;
}

// Fetch this week's rides (Mon-Sun, local time) and cache the summary.
export async function refreshWeek() {
  const token = await accessToken();
  if (!token) return null;
  const start = weekStartMs();
  const res = await fetch(`${API}/athlete/activities?after=${Math.floor(start / 1000)}&per_page=100`, {
    headers: { authorization: 'Bearer ' + token }
  });
  if (!res.ok) throw new Error('Strava activities request failed: ' + res.status);
  const acts = await res.json();

  const daily = [0, 0, 0, 0, 0, 0, 0];
  let meters = 0, movingSec = 0, climbM = 0, rides = 0;
  for (const a of acts) {
    if (!RIDE_TYPES.has(a.sport_type || a.type)) continue;
    // start_date_local is wall-clock time (its "Z" suffix is misleading); use its date part.
    const local = new Date(a.start_date_local.slice(0, 10) + 'T12:00:00Z');
    const idx = (local.getUTCDay() + 6) % 7;
    const mi = a.distance / 1609.344;
    daily[idx] += mi;
    meters += a.distance;
    movingSec += a.moving_time;
    climbM += a.total_elevation_gain || 0;
    rides++;
  }
  const summary = {
    miles: Math.round(meters / 1609.344 * 10) / 10,
    movingSec,
    climbFt: Math.round(climbM * 3.28084),
    rides,
    daily: daily.map((d) => Math.round(d * 10) / 10),
    weekStart: start,
    fetchedAt: Date.now()
  };
  await store().setJSON(CACHE_KEY, summary);

  try {
    await maybeRefreshLong(token);
  } catch (err) {
    console.error('Strava year/load refresh failed', err);
  }
  return summary;
}

const LOAD_KEY = 'strava/load';
const LOAD_HISTORY_DAYS = 240; // ~8 months, so <1% of the 42-day average falls outside the window

function localDate(ms) {
  // YYYY-MM-DD in the dashboard time zone (en-CA formats as ISO).
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

// Hourly: one pass over recent activities gives both the year-to-date ride totals and
// training load. Summing activities (not /athletes/{id}/stats) means private rides count.
async function maybeRefreshLong(token) {
  const s = store();
  const { year, ms: yearMs } = yearStartMs();
  const cached = await s.get(YEAR_KEY, { type: 'json' });
  const cachedLoad = await s.get(LOAD_KEY, { type: 'json' });
  if (cached && cachedLoad && cached.year === year && Date.now() - cached.fetchedAt < YEAR_MAX_AGE) return;

  const loadStartMs = Date.now() - LOAD_HISTORY_DAYS * 86400000;
  const after = Math.floor(Math.min(yearMs, loadStartMs) / 1000);
  const acts = [];
  for (let page = 1; page <= 15; page++) {
    const res = await fetch(`${API}/athlete/activities?after=${after}&per_page=200&page=${page}`, {
      headers: { authorization: 'Bearer ' + token }
    });
    if (!res.ok) throw new Error('Strava history request failed: ' + res.status);
    const batch = await res.json();
    acts.push(...batch);
    if (batch.length < 200) break;
  }

  // Year-to-date ride totals.
  let meters = 0, movingSec = 0, climbM = 0, rides = 0;
  for (const a of acts) {
    if (!RIDE_TYPES.has(a.sport_type || a.type)) continue;
    if (Date.parse(a.start_date) < yearMs) continue;
    meters += a.distance;
    movingSec += a.moving_time;
    climbM += a.total_elevation_gain || 0;
    rides++;
  }
  await s.setJSON(YEAR_KEY, {
    year, miles: Math.round(meters / 1609.344), rides, movingSec,
    climbFt: Math.round(climbM * 3.28084), fetchedAt: Date.now()
  });

  await s.setJSON(LOAD_KEY, computeLoad(acts, loadStartMs));
}

// CTL (fitness, 42-day) and ATL (fatigue, 7-day) exponentially weighted averages of daily
// load; TSB (form) = CTL - ATL. Strava has no TSS in its API, so daily load is the sum of
// each activity's Relative Effort (suffer_score), across all sports, like Strava's own
// Fitness & Freshness. Activities without a Relative Effort add nothing.
//
// LOAD_SCALE: Strava's chart runs ~1.4x higher than a plain average of Relative Effort.
// Calibrated 2026-11-09 against Strava Fitness & Freshness: unscaled 66 / 41 / 25,
// Strava 93 / 57 / 36, scaled 93 / 57 / 36. Re-check if the two drift apart.
const LOAD_SCALE = 1.4;

export function computeLoad(acts, startMs) {
  const byDay = {};
  let withEffort = 0;
  for (const a of acts) {
    if (a.suffer_score == null) continue;
    const day = a.start_date_local.slice(0, 10);
    byDay[day] = (byDay[day] || 0) + a.suffer_score * LOAD_SCALE;
    withEffort++;
  }
  const today = localDate(Date.now());
  let ctl = 0, atl = 0;
  const d = new Date(localDate(startMs) + 'T00:00:00Z');
  for (;;) {
    const key = d.toISOString().slice(0, 10);
    const load = byDay[key] || 0;
    ctl += (load - ctl) / 42;
    atl += (load - atl) / 7;
    if (key >= today) break;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  // Form from the rounded values, the way Strava displays it (93 - 57 = 36).
  return {
    ctl: Math.round(ctl), atl: Math.round(atl), tsb: Math.round(ctl) - Math.round(atl),
    source: 'relative-effort', activities: withEffort, days: LOAD_HISTORY_DAYS, fetchedAt: Date.now()
  };
}

export async function getYear() {
  return store().get(YEAR_KEY, { type: 'json' });
}

export async function getLoad() {
  return store().get(LOAD_KEY, { type: 'json' });
}

// Cached summary; refreshes inline if missing, stale (> 20 min), or from last week.
export async function getWeek() {
  const cached = await store().get(CACHE_KEY, { type: 'json' });
  const stale = !cached || Date.now() - cached.fetchedAt > 20 * 60 * 1000 || cached.weekStart !== weekStartMs();
  if (!stale) return cached;
  try {
    return (await refreshWeek()) || null;
  } catch (err) {
    console.error(err);
    return cached ? { ...cached, stale: true } : null;
  }
}
