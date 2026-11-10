# Desk Dashboard: project context

Project context for Claude Code (or any assistant) working on this repo. Setting up your own copy? Start with `docs/SETUP.md`.

## What it is

A static dashboard page on Netlify, shown full-screen on an AiMOR 10.1" photo frame (**portrait 800×1280**, touch, Android 6 with WebView 44). The spec is `desk-dashboard-spec.md`; keep it current when behavior changes, and add a CHANGELOG entry.

## Working rules

- Ask before anything that publishes or deletes: git push, creating repos, Netlify deploys or settings changes, removing files.
- Download tools only after the owner approves the specific file (name, source, size); verify checksums or signatures.
- Ask before every write to the frame, keep a verified backup before the first one, and record the undo (`docs/frame-setup-log.md`).

## Hosting

- GitHub repo on a **personal account**: Netlify's free plan can't link organization repos.
- Netlify publishes `site/` and deploys from `main` (`netlify.toml`). Visitor access: production public, previews private. "Powered by Netlify" badge off.
- Node.js is only needed for the Netlify CLI or local Functions testing.

## Server (Netlify Functions)

- `netlify/functions/*.mjs` (modern Node, ES modules), shared code in `netlify/lib/`. Storage: Netlify Blobs store `dashboard` (strong consistency): Strava and Google tokens, OAuth state, cached week/year/load, today's events and tasks, weather.
- Env vars: `DASH_KEY`, `DASH_TZ`, `DASH_CONTACT` (NWS User-Agent contact), `DASH_LAT`/`DASH_LON` (forecast point), `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- Google: calendars chosen by name in `netlify/lib/calendars.mjs`. Keep calendar IDs and family members' email addresses out of the repo.
- Never ask the owner to paste `DASH_KEY` or any secret into chat. To check live data, ask them to paste the `/api/data` JSON output instead. The owner sets secrets in the Netlify UI.
- Every `/api/*` endpoint except the OAuth callbacks checks `DASH_KEY` (the callbacks use one-use state instead). `/api/wind` is public but validated and cached.
- `@netlify/blobs` is pinned to 11.1.7. Netlify installs it at build time; there's no local `node_modules`.

## Code rules

- **ES5 only** in `site/js` (no let/const, arrows, template strings, fetch, `Element.closest`). Use XHR.
- **CSS:** flexbox only (no grid, no flex `gap`), no CSS variables, `-webkit-` prefixes on transforms and keyframes.
- WebView 44 bugs to avoid: off-canvas radial gradients (hard seams) and blurred `text-shadow` on huge text. Prefer canvas over CSS animation, and animate only while needed (see the benchmark in `docs/frame-setup-log.md`).
- Settings belong in `site/js/config.js`, not hard-coded.

## Privacy

- The page is public and shows mock data; real data only comes from `/api/data` with the key.
- Never write the owner's street addresses, family members' names or email address into committed files. Personal settings live in `site/js/config.js` (coordinates rounded to ~1 km), `netlify/lib/calendars.mjs`, Netlify env vars, and git-ignored `private/`.

## Map and data sources

- Leaflet 1.9.4 from cdnjs. Base: OSM standard tiles with a CSS dark filter (CARTO now needs an API key). Radar: IEM NEXRAD `nexrad-n0q-900913` tiles. Wind: Open-Meteo multi-point current wind via `/api/wind`.
- Open-Meteo's free tier is non-commercial; flagged in the spec.

## Local preview

`.claude/launch.json` runs `python tools/serve_nocache.py 8787 site` (no-store, so the browser never serves stale CSS/JS). Preview at 800×1280. Use `?time=HH:MM`, `?demo=<preset>`, `?wind=static`; sky scenes at `/lab/sky.html`.

## Frame

- Kiosk app: upstream source (wesbos/photo-frame-dashboard, MIT) is cloned outside the repo; **our changes are `kiosk/rodeo-kiosk.patch`** (portrait, `DEFAULT_URL`, 5-tap nav overlay). See `kiosk/README.md`. After any kiosk change, regenerate the patch with `git diff` in the upstream clone.
- Android 6 lacks Let's Encrypt's current root: third-party APIs on Let's Encrypt (Open-Meteo) must go through a Netlify function (see `/api/wind`).
- `adb reboot` takes ~5 minutes on this firmware; the frame drops off USB meanwhile.
