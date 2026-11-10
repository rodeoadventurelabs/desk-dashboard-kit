# Changelog

All notable changes to this project are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.7.1] - 2026-11-10

Documentation for sharing: anyone can build their own from this repo.

### Added
- `docs/SETUP.md`: step-by-step guide, covering:
  - hardware (exact frame model and firmware) and accounts,
  - personalizing the settings files,
  - Netlify, env vars, Strava, Google,
  - the frame takeover (checks, backup, kiosk, Home app, disabling vendor apps, Wi-Fi, time zone, keyed URL, Back button),
  - daily use, updating, troubleshooting, performance, licensing.
- `kiosk/`: our kiosk changes as `rodeo-kiosk.patch` against wesbos/photo-frame-dashboard `34c91641`, with build/install notes and the upstream MIT license.

### Changed
- README rewritten for the current feature set (portrait, living sky, Strava load, Google, alerts), with hardware and "built with" details.
- NWS User-Agent contact comes from the `DASH_CONTACT` env var instead of being hard-coded.
- Personal details removed from docs and mock data (family names, street address, LAN addresses). Personal settings are clearly marked in `config.js` and `calendars.mjs`.

## [0.7.0] - 2026-11-10

### Added
- **Living-sky header** (`js/sky.js`):
  - **Sky:** colors follow the sun's position, computed locally from Work's coordinates (night → dawn → muted day → sunset), turn greyer with cloud cover, and show stars on clear nights. Painted off-screen and used as the header's background image, so it costs nothing between 5-minute updates.
  - **Motion,** on one canvas that runs only while something moves: clouds drift with the wind (from 25% cover, 6 fps), rain slants with the wind (12 fps), snow drifts (12 fps), leaves tumble past when wind (or 85% of gusts) reaches `sky.leafMph` (12 mph). Lightning flashes with a bolt every 8–25 s on thunderstorm codes (95–99) or NWS thunderstorm/tornado alerts, never more than 3 flashes a second.
  - **Clock:** icicles hang from the digits at ≤ 20 °F; snow caps sit on them while snowing. Static, no animation cost. Clock digits are now individual spans, rebuilt once a minute.
  - Pauses under takeovers and night mode.
- Lab page `lab/sky.html` to preview every scene (presets and sliders), on the frame or a desktop. Mock data only.
- Weather now includes cloud cover, precipitation rate and wind gusts.
- Map wind: 10 fps ambient, **30 fps while the map is being touched**, back to 10 when it resets after 60 s idle (`map.wind.boostFps`). Streak speed stays the same at either rate.

### Fixed (frame WebView 44 rendering)
- An off-canvas radial gradient (the horizon glow) rendered with a hard vertical seam; replaced with linear gradients.
- A blurred `text-shadow` on the 139 px clock is avoided; hard shadows only.

### Kiosk app (built, not yet installed)
- Navigation overlay outside the dashboard is hidden until **5 quick taps in the bottom-right corner** (120×120 dp); then Back / Dashboard show for 15 s.

## [0.6.0] - 2026-11-10

### Changed
- **Portrait layout, 800×1280**, approved from the design mockup (`design/portrait-mock.html`). Rows: clock + current conditions, Strava strip, map (768×260), 10-day forecast strip, then events | commute + tasks.
- **All type 20% larger.**
- Two takeovers stack top/bottom; the night prompt's buttons stack vertically.
- Wind animation at 10 fps (was 20), with double the step size so it moves at the same speed.
- Commute card drops the per-route ETA column (still on the commute takeover). Advice wording is shorter so it fits on one line.
- The weather data time sits on the conditions line ("Partly cloudy · 1:45").
- Kiosk app rebuilt with `screenOrientation="sensorPortrait"`.

### Added
- `tools/serve_nocache.py`: local preview server that sends `Cache-Control: no-store`, so edits show up without stale CSS/JS.

## [0.5.1] - 2026-11-10

First fixes from testing on the real frame (Android 6, WebView 44).

### Fixed
- Map wind failed on the frame: Android 6 doesn't trust Open-Meteo's certificate authority. Wind now goes through a same-origin relay, `/api/wind`. It's public but limited to at most 64 numeric points in a North America box, and CDN-cached for 10 minutes. The page falls back to Open-Meteo directly (the local preview has no `/api`).
- Map expand/home buttons showed empty boxes: the Android 6 font lacks those symbols. They're now drawn SVG icons.
- The 5-minute pulse fades an overlay's opacity instead of animating background-color (35–55% → ~30% CPU on the frame).

### Changed
- Caching for `/api/*` is set by each function instead of a blanket `no-store` header rule.
- `docs/frame-setup-log.md` records the frame takeover: read-only checks, verified backup, kiosk build/install, lockdown, Wi-Fi.

## [0.5.0] - 2026-11-09

### Added
- Live weather, replacing the mock: current temperature, feels-like, conditions and wind, plus the 10-day forecast (Open-Meteo); US AQI (Open-Meteo Air Quality); active alerts (National Weather Service). Forecast point is Work, rounded to ~1 km (`DASH_LAT` / `DASH_LON` override it). Refreshed every 15 minutes; each source can fail on its own without blanking the others.
- Conditions card shows "Updated 4:45" (or "stale", or "mock data"), and a moon icon for clear nights.

### Fixed
- The mock "Winter Weather Advisory" pill and mock temperatures no longer show once the page has live data.

## [0.4.1] - 2026-11-09

### Added
- Events and Tasks lists scroll (touch or mouse wheel); the card titles stay in place. A list left untouched for 60 seconds returns to the top. Re-renders keep your place while you're scrolling.
- Calendar card shows **Tomorrow** below today's events.
- On a computer with a mouse, clicking an event opens it in Google Calendar in a new tab. On the frame's touchscreen events aren't links, so a tap never navigates the kiosk away.

## [0.4.0] - 2026-11-09

### Added
- Google Calendar and Tasks (read-only), via `/api/google/connect` and `/api/google/callback`. The refresh token is kept in Netlify Blobs; today's and tomorrow's events and all task lists are refreshed every 15 minutes.
- Calendars are matched by name in `netlify/lib/calendars.mjs`: your own calendar (counts), shared family calendars (dimmed; count only if they name you, invite you, or match a keyword), an out-of-office calendar and US Holidays (dimmed, never count). Declined events are dropped; events marked free and all-day events never trigger alerts. Duplicate events across the two family calendars are shown once.
- Tasks from every list: open first by due date, then the ones completed today (greyed out).
- The page uses live events and tasks when opened with `?key=...`. Multi-day all-day events show on each day they cover.

## [0.3.1] - 2026-11-09

### Added
- Year-to-date ride miles in the Strava strip ("2026: 1,234 mi"). Summed from activities since Jan 1 (Denver time) so private rides count, refreshed hourly.
- Training load line: CTL (42-day fitness), ATL (7-day fatigue) and TSB (form = CTL − ATL), from 240 days of Relative Effort across all sports, refreshed hourly. Relative Effort is scaled ×1.4 to match Strava's Fitness & Freshness; checked against it on 2026-11-09 (93 / 57 / 36 on both). TSB is colored: red below −30 (overreaching risk), green −30 to −10 (productive), grey −10 to +5, blue above +5 (fresh).
- A small switch on that line hides or shows the numbers; each screen remembers its choice. Default set by `strava.showLoad` in `config.js`.

### Changed
- Weekly Strava goal raised to 150 miles.

## [0.3.0] - 2026-11-09

### Added
- Netlify Functions (`netlify/functions/`) with Netlify Blobs storage:
  - `/api/strava/connect` and `/api/strava/callback`: one-time Strava OAuth, gated by the dashboard key and a one-use state value.
  - `/api/data`: key-protected JSON for the page (Strava for now).
  - `refresh`: scheduled every 15 minutes to refresh the Strava week.
- Live Strava weekly totals (Mon–Sun, Denver time): miles, moving time, climbing, daily bars. Counts all bike ride types, including private rides.
- The page loads live data when opened with `?key=...`, polls every 3 minutes, and falls back to mock data without a key. A small label shows "via Strava", "Strava · stale" or "mock data".

## [0.2.0] - 2026-11-09

### Added
- Interactive map with Leaflet 1.9.4: dark OpenStreetMap base, NWS NEXRAD radar tiles (Iowa Environmental Mesonet), work and home markers with a dashed line.
- Animated wind streaks from a 6×6 Open-Meteo grid over the visible map, colored by speed. `?wind=static` shows arrows instead.
- Pan and pinch-zoom, an expand-to-full-screen button, a home-view button, and a 60-second idle reset.
- Wind pill shows live wind at the map center.

### Changed
- Wind streaks thinned: `fade` 0.8, `pxPerParticle` 900.
- Finished events collapse into an "N earlier" line.

### Notes
- CARTO Dark Matter tiles now need an API key, so the base map is OSM with a CSS dark filter.
- Deployed coordinates are rounded to ~1 km until the secret token exists.

## [0.1.0] - 2026-11-09

### Added
- Static mock of the full 1280×800 layout with mock data: clock, events, tasks, Strava strip, commute planner, current conditions, 10-day forecast.
- Event takeovers with Got it / Snooze, the 5-minute pulse, split screen for overlaps, and the commute takeover.
- Night mode prompt with auto-entry after 2 minutes, and a dim clock-only night screen.
- First deploy to Netlify (`rodeo-desk-dashboard`).
