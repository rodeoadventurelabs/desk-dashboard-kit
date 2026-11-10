# Desk Dashboard — Build Spec

A dark-mode, always-on desk dashboard running on a hacked 10.1" Android photo frame. It shows calendar, tasks, Strava weekly progress, weather, an always-on radar, and a bike-commute planner, and takes over the screen before events.

## 1. Hardware

- **Device:** AiMOR 10.1" photo frame (Amazon "Overall Pick"). Expected board: **PF1007L (Allwinner A33)**. Confirm in Settings → About before doing anything.
- **Screen:** 1280×800 panel, used in **portrait (800×1280)** since 2026-11-10. Touch works (confirmed on arrival). The kiosk app is built with `screenOrientation="sensorPortrait"`.
- **Takeover guide:** https://github.com/wesbos/photo-frame-dashboard, starting with `docs/pf1007l-start-here.md`.
- **Keep the frame OFF Wi-Fi until the vendor app is removed.** That app accepts root shell commands from the vendor's server. Follow the repo's rules: verified backup before any write, one change at a time, ask before every write.
- **Kiosk:** use the repo's `dashboard/kiosk/` WebView app and set `DEFAULT_URL` to the Netlify URL.
  - Set `setMediaPlaybackRequiresUserGesture(false)` on the WebView, or the chime (section 7) won't play without a tap.
- **Expect an old WebView and a weak CPU.** Check the WebView version early and target it. Avoid heavy animation.
  - Android builds for the A33 likely ship a Chromium WebView older than 57. Until the real version is known, assume **no CSS Grid** (use flexbox), and write plain ES5-style JS or transpile to it. No CSS variables if the version is below 49.
  - Record the exact version in phase 1 and update this section before phase 2.

## 2. Architecture

- **Hosting:** Netlify. The account is already connected to Claude and used for another project; create a **new, separate Netlify site** for this.
- **Front end:** a static single page with dark theme, built for the frame's WebView.
- **Netlify Functions:** handle the OAuth flows and API calls. Tokens never live on the frame.
  - **Static secrets** (OAuth client IDs and secrets, the dashboard access token) go in Netlify environment variables.
  - **Refresh tokens go in Netlify Blobs.** Strava can issue a new refresh token on every refresh, and the function must save it; environment variables can't be written at runtime. Keep Google's refresh token in Blobs too, for consistency.
- **Google OAuth app setup:** an app left in "Testing" mode gets refresh tokens that **expire after 7 days**. If the Google account is on Google Workspace, use the **Internal** user type. Otherwise, publish the app to production and accept the "unverified app" warning (fine for a single user).
- **Netlify Scheduled Function:** runs **every 15 minutes**, fetches all data sources, and caches one combined JSON blob in Netlify Blobs.
  - The map (section 4) is **interactive and runs in the page** with Leaflet: base tiles, radar tiles, and wind data load directly in the browser. If the frame can't handle it, fall back to a server-built static radar image stored in Blobs.
- **Page behavior:** the page polls the cached JSON every ~2–5 minutes, so it's cheap. The clock, countdowns, and commute ETAs are computed **client-side every few seconds** from cached data.
- **Time zone:** functions run in UTC. All "today," "this week" (Mon–Sun), evening-event, commute, and night-mode logic uses the **time zone from config** (IANA name, e.g. `America/Los_Angeles`), on both server and client.
- **Saved state:** a small write endpoint stores dashboard state in Blobs: events or series marked "mine" (section 6), the night-mode snooze (section 8), and takeover dismiss/snooze state. Both the frame and the phone remote (section 9) write to it.
- **Access control:** the page shows private calendar data, so don't leave the URL open. Use a long secret token in the URL or a header, checked by **every** function that serves data or saves state.

## 3. Data sources

| Feature | Source | Scope / notes |
|---|---|---|
| Calendar | Google Calendar API | `calendar.readonly`. Read the user's own calendars plus the family calendar. |
| Tasks | Google Tasks API (same lists as the Gmail and Tasks apps) | `tasks.readonly` for v1. Write access (tap to complete) is a possible v2. |
| Strava | Strava API v3, OAuth | `read,activity:read_all` (read-only; `read_all` so rides set to "Only You" count). Sum the current week's rides, Mon–Sun in the configured time zone, all bike types including virtual. The API doesn't expose in-app goals, so the **weekly goal is a config value**. **Built (v0.3.0).** Also: year-to-date ride miles, and CTL/ATL/TSB from 240 days of Relative Effort ×1.4 (matches Strava Fitness & Freshness), with an on/off switch. |
| Forecast + current | Open-Meteo forecast API (free, no key) | 10-day daily highs and lows, conditions, current temperature, wind. |
| AQI | Open-Meteo Air Quality API (preferred; no key) or EPA AirNow (needs a free API key) | Current US AQI. |
| Alerts | National Weather Service API (api.weather.gov) | Active alerts for the location. Free; requires a User-Agent header: `rodeo-desk-dashboard (<DASH_CONTACT>)`, contact set as a Netlify env var. |
| Base map | OpenStreetMap standard tiles (`tile.openstreetmap.org`), darkened with a CSS filter | No key. Follow the OSM tile usage policy (light use, attribution shown). CARTO Dark Matter was the first choice, but its tiles now require an API key, and its free tier is non-commercial. |
| Radar | NWS NEXRAD composite as map tiles from the Iowa Environmental Mesonet (`nexrad-n0q-900913`) | US only, no key. Refreshed every 5 minutes. Attribution shown. |
| Wind on map | Open-Meteo current wind, sampled on a 6×6 grid over the visible map | Refetched every 15 minutes and when the view moves. Drawn as **animated streaks** (Windy-style), colored by speed. `?wind=static` switches to a dense grid of static arrows; use it if the frame struggles. |
| Geocoding | US Census Bureau batch geocoder | One-time lookup of work and home. Exact results are in `private/locations.json` (not deployed). |

**Licensing note:** Open-Meteo's free API is for non-commercial use. A business desk may need its paid plan; check before relying on it long-term.

All locations (shop, home, forecast point) go in a **config file**, not hard-coded.

## 4. Layout (800×1280 portrait)

Changed from landscape on 2026-11-10 to save desk space. All type is 1.2× the original landscape sizes. Design review mockup: `design/portrait-mock.html`. Rows, top to bottom:

1. **Header (living sky):** large clock and date on the left; current conditions on the right (icon and temperature, then conditions with the data time, "feels-like · wind" on one line, and the alert pill if any are active). Behind them, a sky that follows the sun and cloud cover, with weather motion (clouds, rain, snow, leaves above 12 mph, lightning on thunderstorm signals) and clock effects (icicles ≤ 20 °F, snow caps while snowing). Motion runs only while needed, at 6–12 fps. Lab: `site/lab/sky.html`.
2. **Strava strip, full width:** goal ring with % complete, miles vs. goal, moving time, climbing, year-to-date miles, the CTL/ATL/TSB line with its switch, and seven daily bars (Mon–Sun).
3. **Radar map, full width** (768×260), details below.
4. **10-day forecast strip:** ten columns of day, icon, high, low.
5. **Bottom row:** Today and Tomorrow events on the left (scrolls); the Commute card above Tasks on the right (Tasks scrolls).

**Events:** colored left bar per calendar; family calendar events appear dimmed. **Tasks:** completed items stay visible for the day, greyed out with a strikethrough.

**Radar map:**
  - Dark OpenStreetMap base with the NEXRAD precipitation overlay
  - Work and home markers (from `site/js/config.js`), with a dashed line between them
  - Animated wind streaks colored by speed
  - Timestamp ("Radar · 4:45")
  - AQI and wind pills in the top corners; the wind pill shows live wind at the map center
  - **Drag to pan, pinch to zoom** (zoom 5–13)
  - **Expand** button: the map fills the screen; **Home** button: back to the work/home view
  - After 60 seconds untouched, the map collapses and returns to the work/home view
- **Location privacy:** while the site has no secret token, the deployed markers are rounded to about 1 km. Exact coordinates go in only once the data is behind the token (phase 3).
- **Wind animation** runs at 10 fps (halved from 20 after measuring ~30% CPU on the frame), and at 30 fps while the map is being touched, until it resets after 60 s idle.

**Commute card** (section 5): per route, the leave-by time and minutes of slack. The per-route ETA column was dropped for width in portrait; the ETA still shows on the commute takeover.

**Takeovers in portrait:** one takeover fills the screen; two at once stack top (orange, due first) and bottom (blue).

## 5. Commute planner

**Config**
- Commute days: **Monday–Friday** (a config list). On other days the commute card is hidden and the commute takeover never fires.
- Routes: Quick = 40 min, Middle = 50 min, Long way = 70 min.
- Pack-up time = 10 min.
- Default "home by" = **6:30 PM**.

**Per-route display**
- **ETA if packing starts now:** now + 10 + route time.
- **Leave-by time:** home-by − route time − 10.
- **Color:**
  - Green: 10+ minutes of slack
  - Yellow: 0–9 minutes of slack
  - Red: late, showing "late Xm"

**Nudge line** (one line under the routes)
- "Long way still on. Start packing up by X."
- "Long way's gone. Pack up by X to make it."
- "You'll be late. Go now, quick route."

**Calendar-aware "home by"**
- If an evening event on a calendar that counts (see section 6) starts too soon after 6:30 PM, home-by = event start − buffer.
- **Default buffer: 30 minutes.**
- **Per-event override:** a tag in the event title or description, like `[home 60]` or `[home 0]` (minutes).
- **Optional keyword defaults** in config, e.g. `dinner: 45`.

**Commute takeover:** a full-screen takeover (same style as section 7) at the last pack-up time for the quick route (home-by − 40 − 10). It uses the same Got it / Snooze buttons as event takeovers.

## 6. Calendar rules

- **The user's own work and personal calendars:** shown, trigger alerts, and affect home-by.
- **Family calendar:** shown dimmed. It triggers alerts and affects home-by **only if** one of these is true:
  - the user's name (the variants in `netlify/lib/calendars.mjs`, e.g. a first name and nickname) appears in the title,
  - the user is listed as an attendee,
  - the title matches a configurable keyword list, or
  - the user has marked that event or recurring series as "mine" by tapping it on the dashboard.
- Example: "Kid's soccer" stays dimmed and silent unless marked "mine."
- **Excluded from alerts:** all-day events, declined events, and events marked free (`transparency: transparent`).

## 7. Event takeover alerts

**At 30 minutes before** any event that counts, the dashboard is replaced by a full-screen card:
- Event type icon (call, lunch, meeting) and calendar name
- "Starts in XX min" in large type, with a live countdown
- Event title, time range, and meeting type or location (Meet, Zoom, phone, address)
- Two buttons:
  - **Got it:** returns to the normal layout and shows a slim countdown bar at the top until the event starts.
  - **Snooze 10 min:** hides the takeover for 10 minutes.

**At 5 minutes before**, the takeover returns and **pulses**, even if "Got it" or Snooze was tapped at 30 minutes:
- A slow "breathing" background change, about one cycle every two seconds. Never a fast flash; stay well under three flashes per second.
- Stops when "Got it" is tapped or when the event starts.

**Overlapping takeovers (split screen)**
- When two takeovers are due at once (two events, or an event and the commute), the screen **splits into two halves**, one per takeover.
- Each half gets its own primary color so they can't be confused: **orange (`#F26A2E`)** for the one due first (left), **blue (`#5b8def`)** for the other (right). The color tints the half's header band and its countdown.
- Each half has its own Got it / Snooze buttons and its own 5-minute pulse. Dismissing one half lets the other fill the screen.
- More than two at once: show the two soonest, plus a "+N more" note on the right half.

**Chime:** play a soft chime when a takeover appears, if the frame's speaker works.

## 8. Night mode

The dashboard hides private data after hours, so nobody passing the desk (e.g. the cleaning crew) can read calendar or task details.

**Night mode screen:** a dim clock and date only. No events, tasks, Strava, commute, or alert details. Brightness kept as low as the WebView/kiosk allows.

**Start at 7:00 PM** (config), every day:
- At start time, show a full-screen prompt: "Night mode starting in 2:00," with a countdown and two buttons:
  - **Stay on 1 hour:** snoozes night mode. When the hour is up, the prompt appears again.
  - **Night mode now:** enters night mode immediately.
- If nobody taps within **2 minutes**, night mode starts automatically.
- The prompt itself shows no private data.

**While in night mode**
- Event and commute takeovers are suppressed, since they'd show event details. A tap anywhere shows the prompt again with "Stay on 1 hour" so you can get the full dashboard back.
- Night mode ends at **6:00 AM** (config).

**Snooze state** is saved server-side (section 2) so a reload doesn't drop you back into night mode.

## 9. Phone remote and input fallback

The frame is listed as a touch screen, but touch may fail or be unreliable on the real board. Nothing on the dashboard should depend on touch alone.

**Works with no input at all**
- Takeovers close themselves when the event (or the quick-route pack-up time) starts.
- Night mode starts by itself after the 2-minute prompt timeout.

**Phone remote page (`/remote`)**
- A small page on the same Netlify site, protected by the same secret token. Save it to the phone's home screen.
- Uses the dashboard's dark theme. It runs on the phone's modern browser, so it doesn't have to target the frame's old WebView.
- Shows whatever the frame is showing and offers the matching buttons:
  - Active takeover(s): **Got it** and **Snooze 10 min**, one set per takeover when the screen is split
  - Night mode prompt or night mode: **Stay on 1 hour** and **Night mode now**
  - Always: a scrollable list of today's and upcoming family events, each with **Mark as mine** (this event or the whole series)
- Each tap writes to the save endpoint (section 2).

**How the frame picks up remote taps**
- Takeover dismiss/snooze state moves from `localStorage` to Blobs, so the frame and the phone share it. The frame keeps a `localStorage` copy as a fallback if a fetch fails.
- While a takeover or the night-mode prompt is showing, the frame checks a small state endpoint every **10–15 seconds**. Otherwise it relies on the normal 2–5 minute poll.

**Physical buttons (optional)**
- If the frame has power, back, or menu buttons, the kiosk app can map them to key events the page listens for: e.g. short press = Got it, long press = Snooze. Confirm which buttons exist and what key codes they send in phase 1.

## 10. Visual design

- **Dark mode everywhere:**
  - Background near-black (`#0b0b0c`)
  - Cards `#18181a` with 8px radius
  - Primary text `#ececea`, secondary text `#9a9a96`
- **Accent:** Strava-like orange (`#F26A2E`) for the goal ring, bars, and highlights. Don't use Strava's logo or trademarks.
- **Status colors:** green `#8fd8a8`, amber `#f2b36b`, red `#f28b82`; cool blue `#5b8def` for secondary calendars and radar UI.
- **Readability:** large, glanceable type that reads from across the desk. No gradients, shadows, or decorative animation.

## 11. Performance and privacy

- **Map:** Leaflet 1.9.4 (about 40 KB gzipped) from cdnjs. Radar tiles refresh every 5 minutes, not a constant loop.
- **Wind animation** is the biggest CPU cost. It runs at 20 fps, stops while the map is moving or a takeover or night mode covers it, and has a static fallback (`?wind=static`). The CSS filter that darkens the map tiles also costs GPU time. Measure both on the frame in phase 2.
- **Page weight:** keep it light. Minimal JS, no big frameworks unless the WebView handles them well. Test on the real frame early.
- **OAuth scopes:** request read-only scopes only.
- **No accounts on the frame:** no Google or Strava logins and no tokens. The frame only loads the dashboard URL.
- **Disable the frame's vendor apps and updaters** per the repo's guidance.

## 12. Build phases

1. **Frame takeover:** follow the wesbos repo for the PF1007L. Get ADB and root, back up, remove the vendor app, install the kiosk app (with the media autoplay setting from section 1). Record the WebView version, whether touch works, and which physical buttons exist.
2. **Static mock:** build the full layout on Netlify with mock data, load it on the frame, and check performance and readability.
3. **Weather:** add forecast, AQI, alerts, radar, and wind, plus the 15-minute scheduled function and cache.
4. **Google:** add OAuth, Calendar (including family calendar filtering), and Tasks.
5. **Strava:** add OAuth, weekly totals, and the goal ring.
6. **Logic:** commute planner, calendar-aware home-by, event takeovers, split-screen overlaps, the 5-minute pulse, snooze/dismiss state, night mode, and the phone remote page.
7. **Polish:** chime, the "mark as mine" tap, physical button mapping (if any), keyword configs, and error states (stale data indicator if a fetch fails).

## 13. Config values to fill in

- Time zone (IANA name)
- Commute days (default Mon–Fri)
- Night mode start and end (default 7:00 PM and 6:00 AM), prompt timeout (2 min), snooze length (1 hour)
- ~~Shop and home coordinates~~ Done: geocoded, in `private/locations.json` (rounded copies in `site/js/config.js`)
- Weekly Strava goal (miles)
- Which Google calendars are "mine" vs. family
- Name variants and keywords that mark family events as "mine"
- Keyword buffer defaults (e.g. dinner: 45)
- Units: °F and miles

## 14. Open questions for later

- Tap to complete tasks (needs Tasks write scope)?
- Wind-adjusted commute times on headwind days?
- Different home-by times by day of week?
