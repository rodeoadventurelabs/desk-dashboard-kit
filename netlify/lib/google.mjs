// Google Calendar + Tasks (read-only): OAuth tokens in Blobs, today's events and tasks cached.
import { store, TZ } from './common.mjs';
import { CALENDARS, NAME_VARIANTS, FAMILY_KEYWORDS } from './calendars.mjs';

const TOKEN_KEY = 'google/tokens';
const CACHE_KEY = 'google/today';
const MAX_AGE = 20 * 60 * 1000;

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks.readonly'
];

export function authorizeUrl(origin, state) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID || '');
  u.searchParams.set('redirect_uri', origin + '/api/google/callback');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('access_type', 'offline'); // get a refresh token
  u.searchParams.set('prompt', 'consent');      // always return one, even on re-connect
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', state);
  return u.toString();
}

async function tokenRequest(params) {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    ...params
  });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  if (!res.ok) throw new Error('Google token request failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.json();
}

export async function exchangeCode(code, origin) {
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: origin + '/api/google/callback' });
  if (!t.refresh_token) throw new Error('Google returned no refresh token');
  await store().setJSON(TOKEN_KEY, {
    refresh_token: t.refresh_token, access_token: t.access_token,
    expires_at: Date.now() + (t.expires_in || 3600) * 1000, scope: t.scope || '', saved_at: Date.now()
  });
  return t.scope || '';
}

export async function isConnected() {
  return Boolean(await store().get(TOKEN_KEY, { type: 'json' }));
}

async function accessToken() {
  const s = store();
  const saved = await s.get(TOKEN_KEY, { type: 'json' });
  if (!saved) return null;
  if (saved.access_token && saved.expires_at > Date.now() + 5 * 60 * 1000) return saved.access_token;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refresh_token });
  await s.setJSON(TOKEN_KEY, {
    ...saved,
    access_token: t.access_token,
    refresh_token: t.refresh_token || saved.refresh_token, // Google rarely rotates it
    expires_at: Date.now() + (t.expires_in || 3600) * 1000,
    saved_at: Date.now()
  });
  return t.access_token;
}

async function api(token, url) {
  const res = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('Google API ' + res.status + ' for ' + url.split('?')[0]);
  return res.json();
}

// Difference between TZ wall-clock and UTC at a given instant.
function offsetMs(utcMs) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}

// Epoch ms of local midnight in TZ for a YYYY-MM-DD date (plus a day offset).
function localMidnightMs(dateStr, addDays = 0) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d + addDays);
  return guess - offsetMs(guess);
}

// Today in TZ, and the window fetched: today and tomorrow, so late-evening events are there.
function dayBounds() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  return { today, startMs: localMidnightMs(today), endMs: localMidnightMs(today, 2) };
}

function matchCalendar(cal) {
  for (const c of CALENDARS) {
    if (c.match === 'primary' ? cal.primary : cal.summary === c.match) return c;
  }
  return null;
}

function eventType(e) {
  const text = ((e.summary || '') + ' ' + (e.location || '')).toLowerCase();
  if (/\b(lunch|dinner|breakfast|coffee|brunch|drinks)\b/.test(text)) return 'lunch';
  if (/\b(call|phone)\b/.test(text) || /^\+?[\d\s().-]{7,}$/.test(e.location || '')) return 'call';
  return 'meeting';
}

function where(e) {
  if (e.hangoutLink) return 'Google Meet';
  const entry = e.conferenceData && e.conferenceData.conferenceSolution;
  if (entry && entry.name) return entry.name;
  const loc = e.location || '';
  if (/zoom\.us/i.test(loc + ' ' + (e.description || ''))) return 'Zoom';
  return loc.split('\n')[0].slice(0, 60);
}

function familyCounts(e) {
  const title = e.summary || '';
  for (const n of NAME_VARIANTS) { if (new RegExp('\\b' + n + '\\b', 'i').test(title)) return true; }
  if ((e.attendees || []).some((a) => a.self && a.responseStatus !== 'declined')) return true;
  const lower = title.toLowerCase();
  return FAMILY_KEYWORDS.some((k) => lower.indexOf(k.toLowerCase()) !== -1);
}

function shape(e, cfg) {
  const allDay = Boolean(e.start && e.start.date);
  // All-day dates are local calendar days: anchor them to local midnight, not UTC.
  const start = allDay ? localMidnightMs(e.start.date) : Date.parse(e.start.dateTime);
  const end = allDay ? localMidnightMs(e.end.date) : Date.parse(e.end.dateTime);
  const self = (e.attendees || []).find((a) => a.self);
  const declined = Boolean(self && self.responseStatus === 'declined');
  const free = e.transparency === 'transparent';
  let counts = false;
  if (!allDay && !declined && !free) {
    if (cfg.role === 'mine') counts = true;
    else if (cfg.role === 'family') counts = familyCounts(e);
  }
  return {
    id: e.id, uid: e.iCalUID || e.id, cal: cfg.key, title: e.summary || '(No title)',
    description: (e.description || '').slice(0, 500), allDay, start, end,
    // For all-day events, the page only needs the date string.
    day: allDay ? e.start.date : null,
    where: where(e), type: eventType(e), counts, declined, free, recurringId: e.recurringEventId || null,
    // Opens the event in Google Calendar (used on desktop only; the frame never navigates).
    link: /^https:\/\/(www\.)?google\.com\/calendar\//.test(e.htmlLink || '') ? e.htmlLink : null
  };
}

async function fetchEvents(token, bounds) {
  const list = await api(token, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250');
  const out = [], seen = new Set();
  for (const cal of list.items || []) {
    const cfg = matchCalendar(cal);
    if (!cfg) continue;
    const u = new URL('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(cal.id) + '/events');
    u.searchParams.set('timeMin', new Date(bounds.startMs).toISOString());
    u.searchParams.set('timeMax', new Date(bounds.endMs).toISOString());
    u.searchParams.set('singleEvents', 'true');
    u.searchParams.set('orderBy', 'startTime');
    u.searchParams.set('maxResults', '100');
    const data = await api(token, u.toString());
    for (const e of data.items || []) {
      if (e.status === 'cancelled') continue;
      const ev = shape(e, cfg);
      if (ev.declined) continue;
      // The two family calendars share events; keep the first copy (higher in CALENDARS wins).
      if (seen.has(ev.uid)) continue;
      seen.add(ev.uid);
      out.push(ev);
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

async function fetchTasks(token, bounds) {
  const lists = await api(token, 'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100');
  const out = [];
  for (const l of lists.items || []) {
    const u = new URL('https://tasks.googleapis.com/tasks/v1/lists/' + encodeURIComponent(l.id) + '/tasks');
    u.searchParams.set('showCompleted', 'true');
    u.searchParams.set('showHidden', 'true');
    u.searchParams.set('maxResults', '100');
    const data = await api(token, u.toString());
    for (const t of data.items || []) {
      if (t.deleted || !t.title) continue;
      const done = t.status === 'completed';
      // Completed tasks stay visible for the day they were completed, then drop off.
      if (done && (!t.completed || Date.parse(t.completed) < bounds.startMs)) continue;
      out.push({ title: t.title, done, due: t.due || null, list: l.title, updated: t.updated });
    }
  }
  // Open first (soonest due first), then today's completed.
  out.sort((a, b) => (a.done - b.done) || String(a.due || '9').localeCompare(String(b.due || '9')));
  return out;
}

export async function refreshToday() {
  const token = await accessToken();
  if (!token) return null;
  const bounds = dayBounds();
  const [events, tasks] = await Promise.all([fetchEvents(token, bounds), fetchTasks(token, bounds)]);
  const data = { events, tasks, today: bounds.today, fetchedAt: Date.now() };
  await store().setJSON(CACHE_KEY, data);
  return data;
}

export async function getToday() {
  const cached = await store().get(CACHE_KEY, { type: 'json' });
  const stale = !cached || Date.now() - cached.fetchedAt > MAX_AGE || cached.today !== dayBounds().today;
  if (!stale) return cached;
  try {
    return (await refreshToday()) || null;
  } catch (err) {
    console.error(err);
    return cached ? { ...cached, stale: true } : null;
  }
}
