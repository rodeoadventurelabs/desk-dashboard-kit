// GET /api/google/connect?key=<DASH_KEY>
// Starts Google OAuth (Calendar + Tasks, read-only). Requires the dashboard key.
import { randomBytes } from 'node:crypto';
import { hasKey, store, html } from '../lib/common.mjs';
import { authorizeUrl } from '../lib/google.mjs';

export default async (req) => {
  if (!hasKey(req)) return html('<p>Not authorized.</p>', 401);
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return html('<p>Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Netlify, then redeploy.</p>', 500);
  }
  const state = randomBytes(24).toString('hex');
  await store().setJSON('google/oauth-state', { state, created: Date.now() });
  return Response.redirect(authorizeUrl(new URL(req.url).origin, state), 302);
};

export const config = { path: '/api/google/connect' };
