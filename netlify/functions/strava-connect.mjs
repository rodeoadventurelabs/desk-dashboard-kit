// GET /api/strava/connect?key=<DASH_KEY>
// Starts Strava OAuth. Requires the dashboard key so nobody else can link their account.
import { randomBytes } from 'node:crypto';
import { hasKey, store, html } from '../lib/common.mjs';
import { authorizeUrl } from '../lib/strava.mjs';

export default async (req) => {
  if (!hasKey(req)) return html('<p>Not authorized.</p>', 401);
  if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) {
    return html('<p>Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in Netlify first.</p>', 500);
  }
  const state = randomBytes(24).toString('hex');
  await store().setJSON('strava/oauth-state', { state, created: Date.now() });
  const origin = new URL(req.url).origin;
  return Response.redirect(authorizeUrl(origin, state), 302);
};

export const config = { path: '/api/strava/connect' };
