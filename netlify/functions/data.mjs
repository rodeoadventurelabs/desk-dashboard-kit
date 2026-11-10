// GET /api/data?key=<DASH_KEY>
// Everything the page needs that isn't mock data: weather, Strava, and Google.
import { hasKey, json } from '../lib/common.mjs';
import * as strava from '../lib/strava.mjs';
import * as google from '../lib/google.mjs';
import { getWeather } from '../lib/weather.mjs';

export default async (req) => {
  if (!hasKey(req)) return json({ error: 'unauthorized' }, 401);

  const out = { generatedAt: Date.now(), strava: null, google: null, weather: null, status: {} };

  try {
    out.weather = await getWeather();
    out.status.weather = out.weather ? (out.weather.stale ? 'stale' : 'ok') : 'error';
  } catch (err) {
    console.error(err);
    out.status.weather = 'error';
  }

  try {
    if (await strava.isConnected()) {
      out.strava = await strava.getWeek();
      out.status.strava = out.strava ? (out.strava.stale ? 'stale' : 'ok') : 'error';
      if (out.strava) {
        out.strava.year = await strava.getYear();
        out.strava.load = await strava.getLoad();
      }
    } else {
      out.status.strava = 'not-connected';
    }
  } catch (err) {
    console.error(err);
    out.status.strava = 'error';
  }

  try {
    if (await google.isConnected()) {
      out.google = await google.getToday();
      out.status.google = out.google ? (out.google.stale ? 'stale' : 'ok') : 'error';
    } else {
      out.status.google = 'not-connected';
    }
  } catch (err) {
    console.error(err);
    out.status.google = 'error';
  }

  return json(out);
};

export const config = { path: '/api/data' };
