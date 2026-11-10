# Rodeo Desk Dashboard

> **This is a starter copy.** Personal settings are placeholders: map coordinates (central Denver), calendar names, your name variants, `YOUR-SITE` URLs. Fill them in by following [docs/SETUP.md](docs/SETUP.md) step 2. The [CHANGELOG](CHANGELOG.md) and [docs/frame-setup-log.md](docs/frame-setup-log.md) record how the original was built and tested.

An always-on, dark-mode desk dashboard on a hacked **AiMOR 10.1" photo frame**, standing in **portrait (800×1280)**. Large, glanceable type: everything is 20% larger than the first build.

- **Living-sky header:** big clock and current conditions over a sky that follows the sun and the clouds. Rain, snow and blowing leaves animate across it, lightning flashes on thunderstorm signals, icicles hang from the clock when it's frigid, and snow caps it while snowing.
- **Strava:** weekly miles vs. goal, moving time, climbing, daily bars, year-to-date miles, and CTL / ATL / TSB (fitness, fatigue, form) calibrated to Strava's Fitness & Freshness, with an on/off switch.
- **Radar map:** dark OpenStreetMap, live NEXRAD radar, work/home markers, and animated wind streaks. Pan, pinch, full screen.
- **10-day forecast, AQI, NWS alerts.**
- **Google Calendar and Tasks:** today and tomorrow (scrolls). Family calendars dimmed unless an event involves you. Click an event on a computer to open it in Google Calendar.
- **Commute planner:** leave-by times per route, slack, and a "home by" that moves for evening events.
- **Full-screen alerts** 30 and 5 minutes before events (two at once split the screen), a commute "last call", and a **night mode** that hides private data after 7 PM unless you snooze it.

Once deployed, your site shows mock data without the key; preview every sky scene at `/lab/sky.html`.

## Build your own

**→ [docs/SETUP.md](docs/SETUP.md)**: step by step, from the frame purchase to a locked-down kiosk.

| | |
|---|---|
| **Frame** | AiMOR 10.1" Digital Picture Frame (32 GB, 1280×800 IPS touch), board PF1007L (Allwinner A33), Android 6.0.1, firmware 20260410, WebView 44 |
| **Hosting** | Netlify (free plan): static page + Functions + Blobs + a 15-minute scheduled refresh |
| **Data** | Open-Meteo (forecast, AQI, wind), NWS (alerts), IEM NEXRAD (radar), OpenStreetMap (map), Strava API, Google Calendar + Tasks APIs |
| **Kiosk app** | [wesbos/photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard) Home HQ, plus [our patch](kiosk/) (portrait, 5-tap Back/Dashboard overlay) |
| **Built with** | Claude Code (desktop app), model **Claude Opus 5.5** |

## Repository layout

```
site/                      The page Netlify publishes
  index.html
  css/dashboard.css
  js/config.js             Your settings: time zone, commute, night mode, goal, map locations, sky
  js/app.js                Clock, cards, commute logic, alerts, night mode, live-data polling
  js/sky.js                Living-sky header
  js/map.js                Leaflet map: radar, markers, wind streaks
  js/mock-data.js          Sample data shown without a key
  lab/sky.html             Preview every sky scene (presets + sliders)
netlify/functions/         /api/data, /api/wind, Strava + Google OAuth, 15-min refresh
netlify/lib/               Shared server code: key check, Blobs, Strava, Google, weather
netlify/lib/calendars.mjs  Your settings: which calendars, name variants, keywords
kiosk/                     Patch + build notes for the Android kiosk app
docs/SETUP.md              Step-by-step guide
docs/frame-setup-log.md    Everything done to the original frame, with undo commands and benchmarks
design/                    Design-review mockups and the animation benchmark
tools/serve_nocache.py     Local preview server (no caching)
desk-dashboard-spec.md     The build spec
CHANGELOG.md               Version history
CLAUDE.md                  Project context for Claude Code
private/                   NOT in Git: exact coordinates, frame backups
```

## Run it locally

```bash
python tools/serve_nocache.py 8787 site
```

Open http://localhost:8787 (best at 800×1280).

| Parameter | What it does |
|---|---|
| `?key=…` | Live data from `/api/data` (only on the deployed site) |
| `?time=17:25` | Starts the clock at that time today |
| `?demo=takeover` | Also `morning`, `pulse`, `split`, `commute`, `late`, `nightprompt`, `night` |
| `?wind=static` | Static wind arrows instead of animated streaks |

## Server settings (Netlify environment variables)

| Variable | What it is |
|---|---|
| `DASH_KEY` | Long random key; the page and every `/api/*` call need it (secret) |
| `DASH_TZ` | Time zone for weeks, days and events (default `America/Denver`) |
| `DASH_CONTACT` | Email or URL sent to the National Weather Service in the User-Agent |
| `DASH_LAT`, `DASH_LON` | Optional forecast point override |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | From strava.com/settings/api (secret) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client, Web application (secret) |

One-time connections, after the variables are deployed:
- Strava: `/api/strava/connect?key=<DASH_KEY>`
- Google: `/api/google/connect?key=<DASH_KEY>`

Frame URL: `/?key=<DASH_KEY>`.

## Deploying

Push to `main`; Netlify deploys automatically (about 20 seconds). Branches get private preview URLs.

## Privacy

- The page itself is public and shows only mock data. Real data comes from `/api/data`, which requires the key. Each function sets its own caching: `no-store` for anything private.
- Tokens (Strava, Google) live in Netlify Blobs, never on the frame or in Git. Secrets live in Netlify environment variables.
- Map coordinates in `config.js` are rounded to ~1 km. Exact ones stay in git-ignored `private/`.
- The kiosk logs URLs without their query string, so the key never appears in the frame's log.
- The frame's vendor apps (which accept root commands from the vendor's server) are disabled; see [docs/frame-setup-log.md](docs/frame-setup-log.md).
