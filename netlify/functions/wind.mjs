// GET /api/wind?latitude=<list>&longitude=<list>
// Same-origin relay for the map's wind grid. The frame's Android 6 doesn't trust the certificate
// authority Open-Meteo uses, so the page can't call it directly; this server can.
// Public (weather isn't private) but tightly limited: numbers only, at most 64 points, a North
// America box, and coordinates rounded so the CDN can cache repeat requests for 10 minutes.

const MAX_POINTS = 64;

function parseList(s, min, max) {
  if (!s || s.length > 2000) return null;
  const out = s.split(',').map(Number);
  if (!out.length || out.length > MAX_POINTS) return null;
  for (const v of out) { if (!Number.isFinite(v) || v < min || v > max) return null; }
  return out.map((v) => v.toFixed(2));
}

export default async (req) => {
  const u = new URL(req.url);
  const lat = parseList(u.searchParams.get('latitude'), 15, 72);
  const lon = parseList(u.searchParams.get('longitude'), -170, -50);
  if (!lat || !lon || lat.length !== lon.length) {
    return new Response(JSON.stringify({ error: 'bad grid' }), {
      status: 400, headers: { 'content-type': 'application/json' }
    });
  }

  const om = new URL('https://api.open-meteo.com/v1/forecast');
  om.searchParams.set('latitude', lat.join(','));
  om.searchParams.set('longitude', lon.join(','));
  om.searchParams.set('current', 'wind_speed_10m,wind_direction_10m');
  om.searchParams.set('wind_speed_unit', 'mph');

  const res = await fetch(om.toString());
  const body = await res.text();
  return new Response(body, {
    status: res.ok ? 200 : 502,
    headers: {
      'content-type': 'application/json',
      // Overrides the /api/* no-store rule: wind is public and changes slowly.
      'cache-control': 'public, max-age=300',
      'netlify-cdn-cache-control': 'public, s-maxage=600'
    }
  });
};

export const config = { path: '/api/wind' };
