// GET /api/google/callback?code=...&state=...
// Google redirects here after you approve. Checks the one-use state, saves the refresh token,
// and fetches today's events and tasks once so you can see it worked.
import { store, html, escapeHtml } from '../lib/common.mjs';
import { exchangeCode, refreshToday, SCOPES } from '../lib/google.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const s = store();
  const saved = await s.get('google/oauth-state', { type: 'json' });
  await s.delete('google/oauth-state'); // one use only

  if (url.searchParams.get('error')) {
    return html('<p>Google connection was cancelled (' + escapeHtml(url.searchParams.get('error')) + ').</p>', 400);
  }
  const state = url.searchParams.get('state') || '';
  if (!saved || saved.state !== state || Date.now() - saved.created > 10 * 60 * 1000) {
    return html('<p>This link expired or was not started from the dashboard. Start again from /api/google/connect.</p>', 400);
  }

  try {
    const granted = await exchangeCode(url.searchParams.get('code') || '', url.origin);
    const missing = SCOPES.filter((sc) => granted.indexOf(sc) === -1);
    if (missing.length) {
      return html('<p>Connected, but Google didn\'t grant: ' + escapeHtml(missing.join(', ')) +
        '. Start again and allow both Calendar and Tasks.</p>', 400);
    }
    const today = await refreshToday();
    const ev = today ? today.events.filter((e) => !e.allDay).length : 0;
    const tk = today ? today.tasks.filter((t) => !t.done).length : 0;
    return html('<h2>Google connected</h2><p>Found ' + ev + ' timed event' + (ev === 1 ? '' : 's') +
      ' today and tomorrow, and ' + tk + ' open task' + (tk === 1 ? '' : 's') + '.</p><p>You can close this tab.</p>');
  } catch (err) {
    console.error(err);
    return html('<p>Couldn\'t finish connecting to Google. Check the client ID, secret, and redirect URI, then try again.</p>', 502);
  }
};

export const config = { path: '/api/google/callback' };
