// Scheduled every 15 minutes: refresh cached data so page requests stay fast and cheap.
import * as strava from '../lib/strava.mjs';
import * as google from '../lib/google.mjs';
import { refreshWeather } from '../lib/weather.mjs';

export default async () => {
  try {
    await refreshWeather();
  } catch (err) {
    console.error('Weather refresh failed', err);
  }
  try {
    if (await strava.isConnected()) await strava.refreshWeek();
  } catch (err) {
    console.error('Strava refresh failed', err);
  }
  try {
    if (await google.isConnected()) await google.refreshToday();
  } catch (err) {
    console.error('Google refresh failed', err);
  }
};

export const config = { schedule: '*/15 * * * *' };
