// GET /api/strava/callback?code=...&state=...&scope=...
// Strava redirects here after you approve. Checks the one-time state, saves tokens, fetches the week.
import { store, html, escapeHtml } from '../lib/common.mjs';
import { exchangeCode, refreshWeek } from '../lib/strava.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const s = store();
  const saved = await s.get('strava/oauth-state', { type: 'json' });
  await s.delete('strava/oauth-state'); // one use only

  if (url.searchParams.get('error')) {
    return html('<p>Strava connection was cancelled.</p>', 400);
  }
  const state = url.searchParams.get('state') || '';
  if (!saved || saved.state !== state || Date.now() - saved.created > 10 * 60 * 1000) {
    return html('<p>This link expired or was not started from the dashboard. Start again from /api/strava/connect.</p>', 400);
  }
  const scope = url.searchParams.get('scope') || '';
  if (scope.indexOf('activity:read') === -1) {
    return html('<p>Strava didn\'t grant activity access. Start again and leave "View data about your activities" checked.</p>', 400);
  }

  try {
    const name = await exchangeCode(url.searchParams.get('code') || '', scope);
    const week = await refreshWeek();
    const miles = week ? week.miles + ' mi in ' + week.rides + ' ride' + (week.rides === 1 ? '' : 's') : 'no rides yet';
    return html('<h2>Strava connected</h2><p>Linked to ' + escapeHtml(name || 'your account') +
      '. This week so far: ' + escapeHtml(miles) + '.</p><p>You can close this tab.</p>');
  } catch (err) {
    console.error(err);
    return html('<p>Couldn\'t finish connecting to Strava. Check the client ID and secret, then try again.</p>', 502);
  }
};

export const config = { path: '/api/strava/callback' };
