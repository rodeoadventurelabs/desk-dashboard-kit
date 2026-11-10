// Live weather: Open-Meteo (current + 10-day), Open-Meteo Air Quality (US AQI),
// and National Weather Service active alerts. Cached in Blobs, refreshed every 15 minutes.
import { store, TZ } from './common.mjs';

const CACHE_KEY = 'weather/now';
const MAX_AGE = 20 * 60 * 1000;

// Forecast point: set DASH_LAT / DASH_LON (defaults are a placeholder in central Denver) (no need for more precision for weather).
// Override with DASH_LAT / DASH_LON env vars.
const LAT = Number(process.env.DASH_LAT || 39.75);
const LON = Number(process.env.DASH_LON || -105.00);

// NWS asks for a User-Agent with contact info so they can reach you about problems.
// Set DASH_CONTACT (an email or URL) in Netlify; it isn't committed to the repo.
const NWS_UA = 'rodeo-desk-dashboard' + (process.env.DASH_CONTACT ? ' (' + process.env.DASH_CONTACT + ')' : '');

// WMO weather codes (Open-Meteo) -> the page's condition names.
export function condFromCode(code) {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return 'cloudy';
}

async function getJSON(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('Weather request failed: ' + res.status + ' ' + url.split('?')[0]);
  return res.json();
}

async function forecast() {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', LAT);
  u.searchParams.set('longitude', LON);
  // cloud_cover, precipitation and wind_gusts_10m feed the living-sky header.
  u.searchParams.set('current', 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,' +
    'wind_gusts_10m,cloud_cover,precipitation,is_day');
  u.searchParams.set('precipitation_unit', 'inch');
  u.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  u.searchParams.set('forecast_days', '10');
  u.searchParams.set('temperature_unit', 'fahrenheit');
  u.searchParams.set('wind_speed_unit', 'mph');
  u.searchParams.set('timezone', TZ);
  const d = await getJSON(u.toString());
  const c = d.current;
  return {
    current: {
      tempF: Math.round(c.temperature_2m),
      feelsF: Math.round(c.apparent_temperature),
      cond: condFromCode(c.weather_code),
      code: c.weather_code,
      windMph: Math.round(c.wind_speed_10m),
      windFrom: Math.round(c.wind_direction_10m),
      gustMph: c.wind_gusts_10m == null ? null : Math.round(c.wind_gusts_10m),
      cloudCover: c.cloud_cover == null ? null : Math.round(c.cloud_cover),
      precipIn: c.precipitation == null ? null : c.precipitation,
      isDay: c.is_day === 1,
      time: c.time
    },
    daily: d.daily.time.map((date, i) => ({
      date, // YYYY-MM-DD, local
      cond: condFromCode(d.daily.weather_code[i]),
      code: d.daily.weather_code[i],
      hi: Math.round(d.daily.temperature_2m_max[i]),
      lo: Math.round(d.daily.temperature_2m_min[i]),
      pop: d.daily.precipitation_probability_max ? d.daily.precipitation_probability_max[i] : null
    }))
  };
}

async function airQuality() {
  const u = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  u.searchParams.set('latitude', LAT);
  u.searchParams.set('longitude', LON);
  u.searchParams.set('current', 'us_aqi');
  u.searchParams.set('timezone', TZ);
  const d = await getJSON(u.toString());
  const v = d.current && d.current.us_aqi;
  return v == null ? null : { value: Math.round(v) };
}

async function alerts() {
  const d = await getJSON(`https://api.weather.gov/alerts/active?point=${LAT},${LON}&status=actual`, {
    'user-agent': NWS_UA, accept: 'application/geo+json'
  });
  return (d.features || []).map((f) => ({
    event: f.properties.event,
    severity: String(f.properties.severity || '').toLowerCase(),
    ends: f.properties.ends || f.properties.expires || null,
    headline: f.properties.headline || ''
  }));
}

export async function refreshWeather() {
  // Each source can fail on its own; keep whatever worked.
  const [fc, aq, al] = await Promise.allSettled([forecast(), airQuality(), alerts()]);
  if (fc.status !== 'fulfilled') throw fc.reason;
  const data = {
    ...fc.value,
    aqi: aq.status === 'fulfilled' ? aq.value : null,
    alerts: al.status === 'fulfilled' ? al.value : [],
    point: { lat: LAT, lon: LON },
    errors: [aq, al].filter((r) => r.status === 'rejected').map((r) => String(r.reason && r.reason.message)),
    fetchedAt: Date.now()
  };
  await store().setJSON(CACHE_KEY, data);
  return data;
}

export async function getWeather() {
  const cached = await store().get(CACHE_KEY, { type: 'json' });
  if (cached && Date.now() - cached.fetchedAt < MAX_AGE) return cached;
  try {
    return await refreshWeather();
  } catch (err) {
    console.error(err);
    return cached ? { ...cached, stale: true } : null;
  }
}
