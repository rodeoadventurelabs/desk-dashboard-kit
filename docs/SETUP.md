# Build your own desk dashboard: step by step

This guide takes you from an unopened photo frame to a working dashboard: clock, living-sky weather, radar map with wind, Google Calendar and Tasks, Strava week/year/training load, a bike-commute planner, alerts before meetings, and a night mode.

**Time:** about half a day. Most of it is account setup and waiting on the frame.
**Cost:** the frame (about $48). Everything else uses free tiers (see [Licensing and limits](#licensing-and-limits)).
**Skills:** comfortable copying commands into a terminal. No Android experience needed.

> Ask before every change to the frame, keep a verified backup before the first one, and do one change at a time. This guide follows the safety rules of the upstream takeover guide, [wesbos/photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard). Read its `docs/pf1007l-start-here.md` alongside this.

---

## 0. What you need

### Hardware (what this was built and tested on)

| | |
|---|---|
| **Frame** | **AiMOR 10.1" Digital Picture Frame**, 32 GB, 1280×800 IPS touch screen, "WiFi Photo Frame … via AiMOR App" (Amazon, sold under the Anna Bella Store listing, Black with White, 10.1 inch). |
| **Board / firmware** | Allwinner A33 (`astar_m86_8723cs`, board PF1007L), Android 6.0.1, firmware `20260410` (fingerprint `AEEZO/astar_m86_8723cs/astar-m86_8723cs:6.0.1/MOB30R/20260410:eng/test-keys`). |
| **Browser engine** | Android System WebView 44 (Chrome 44, 2015). No browser app. The dashboard code is written for this. |
| **Hardware notes** | Mali-400 MP2 GPU (WebGL works), accelerometer (auto-rotate), ambient light sensor, **no navigation bar** (the firmware doesn't run Android's SystemUI). |
| **Cable** | The USB cable in the box carried data on this unit (USB-A on the PC side). |

Other AiMOR/A33 frames may differ. **Check Settings → About first** (step 8.2); if the firmware isn't one the upstream guide has tested, stop and read its notes for your version.

### Computer and accounts

- A computer. This was built on **Windows 11** with PowerShell and Git Bash; macOS/Linux work with the equivalent commands.
- **GitHub** account (personal; see the note in step 3).
- **Netlify** account (free plan).
- **Google** account with Calendar and Tasks. Google Workspace is easiest (step 6).
- **Strava** account.

### How this was built

Designed and coded with **Claude Code** (desktop app) using **Claude Opus 5.5**, working from the spec in [../desk-dashboard-spec.md](../desk-dashboard-spec.md). [../CLAUDE.md](../CLAUDE.md) is the project context file Claude reads; if you use Claude Code too, it'll pick it up.

---

## 1. Copy the repo

1. Get a copy of this repository into **your personal GitHub account** (fork it, or create a new private repo and push a clone to it).
2. Clone it to your computer.

> **Personal account, not an organization:** Netlify's free plan can only link repositories owned by a personal account.

## 2. Make it yours (edit these files)

| File | What to change |
|---|---|
| `site/js/config.js` | `timeZone` (IANA name, e.g. `America/Denver`). `commute`: days, routes and their minutes, pack-up time, default "home by", keyword buffers. `night`: start/end. `strava.weeklyGoalMi`. `map.locations`: **work and home, rounded to 2 decimals (~1 km)**, because this file is public. `sky.leafMph`. Calendar colors. |
| `netlify/lib/calendars.mjs` | Which calendars to read, **by their name in Google Calendar**, and their role (`mine` / `family` / `other`). Your name variants (for family events that mention you) and keywords. |
| `site/js/mock-data.js` | Optional: the sample data shown without a key. |
| `kiosk/rodeo-kiosk.patch` | After applying it (step 8.6), change `DEFAULT_URL` to your site. |

Exact coordinates: keep them out of the repo. The `.gitignore` excludes a `private/` folder if you want a place for notes.

Commit and push.

## 3. Netlify site

1. Netlify → **Add new project → Import an existing project → GitHub**. If your repo isn't listed, click **Configure Netlify on GitHub** and give the Netlify app access to it.
2. Branch `main`. Leave the build command empty. Publish directory: `site` (already set in `netlify.toml`). Deploy.
3. Pick a project name; it becomes `https://YOUR-SITE.netlify.app`.
4. Project configuration → General → **Visitor access**: Customize → Private → applies to **Previews only**, so production is public (the frame can't log in) and previews stay private.
5. Turn off the **Powered by Netlify** badge (same page) so it doesn't land on the dashboard.

From now on, **every push to `main` deploys automatically**.

## 4. Secret key and environment variables

The page is public but your data isn't: every `/api/*` call needs a long secret key.

Make a key without printing it (PowerShell; copies it to the clipboard):

```bash
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); (($b | ForEach-Object { $_.ToString('x2') }) -join '') | Set-Clipboard
```

Save it in your password manager. Then in Netlify → **Project configuration → Environment variables**, add (tick **Contains secret values** for secrets):

| Variable | Value | Secret? |
|---|---|---|
| `DASH_KEY` | the key you just made | yes |
| `DASH_TZ` | your time zone, e.g. `America/Denver` | no |
| `DASH_CONTACT` | an email or URL for the National Weather Service User-Agent | no |
| `DASH_LAT`, `DASH_LON` | optional: forecast point (2 decimals is plenty) | no |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | step 5 | secret: yes |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | step 6 | secret: yes |

> **Netlify only reads environment variables at deploy time.** After adding or changing one: Deploys → **Trigger deploy → Deploy site**.

## 5. Strava

1. https://www.strava.com/settings/api → create an app. **Authorization Callback Domain:** `YOUR-SITE.netlify.app` (no `https://`, no path). One Strava app has one callback domain.
2. Put its Client ID and Client Secret in Netlify (step 4) and redeploy.
3. Open `https://YOUR-SITE.netlify.app/api/strava/connect?key=YOUR_KEY` and approve. You should land on **"Strava connected"** with this week's miles.

The dashboard asks for read-only access including private rides (`read,activity:read_all`). Tokens are stored in Netlify Blobs and refresh themselves.

## 6. Google Calendar and Tasks

1. https://console.cloud.google.com → create a project.
2. **APIs & Services → Library:** enable **Google Calendar API** and **Google Tasks API**.
3. **OAuth consent screen:**
   - **Google Workspace:** user type **Internal**. No review; tokens don't expire.
   - **Personal Gmail:** **External**, add yourself as a test user, then **Publish app** (to "In production"). Left in "Testing", Google expires the sign-in after **7 days**. An "unverified app" warning on sign-in is expected for personal use.
   - Scopes: `.../auth/calendar.readonly` and `.../auth/tasks.readonly`.
4. **Credentials → Create credentials → OAuth client ID → Web application.** Authorized redirect URI: `https://YOUR-SITE.netlify.app/api/google/callback`.
5. Put the client ID and secret in Netlify (step 4) and redeploy.
6. Open `https://YOUR-SITE.netlify.app/api/google/connect?key=YOUR_KEY` and allow both. You should see **"Google connected"** with event and task counts.

## 7. Check the data

Open `https://YOUR-SITE.netlify.app/api/data?key=YOUR_KEY`. You should see JSON with `weather`, `strava` and `google` sections, and `"status"` showing `ok` for each. The year total and training load fill in on the first scheduled refresh (every 15 minutes).

Then open `https://YOUR-SITE.netlify.app/?key=YOUR_KEY` on your computer: the real dashboard, at 800×1280 (it scales to fit). Without `?key=`, it shows mock data.

Preview helpers: `?time=17:25`, `?demo=split` (also `takeover`, `pulse`, `commute`, `nightprompt`, `night`), `?wind=static`. Sky scenes: `/lab/sky.html`.

---

## 8. Take over the frame

### 8.1 Power it up, but stay off Wi-Fi

Plug it in. **Don't connect it to Wi-Fi yet.** Its vendor app (`com.efercro.os.aimor`) keeps a connection to the vendor's server, which can send it root shell commands.

### 8.2 Confirm the model

On the frame: **Settings → About**. Note the model and firmware string. Compare with step 0 and the upstream guide.

### 8.3 Install adb and connect

1. Download Google's **Android SDK Platform-Tools** (developer.android.com/tools/releases/platform-tools). On Windows, check that `adb.exe` has a valid **Google LLC** signature (right-click → Properties → Digital Signatures).
2. Connect the frame with the USB cable and run:

```bash
adb devices -l
```

On this firmware ADB was already enabled and running **as root**, with no prompt: `device product:astar_m86_8723cs model:AEEZO`. If yours shows nothing or `unauthorized`, follow the upstream guide (section T3, including the hidden test-app route).

### 8.4 Read-only checks

```bash
adb -d shell id
adb -d shell getprop ro.build.fingerprint
adb -d shell getprop persist.sys.usb.config
adb -d shell "dumpsys package com.android.webview | grep versionName"
adb -d shell "pm list packages | grep -i -E 'aimor|efercro|yhk|devicetest'"
adb -d shell "netstat -an | grep 7806"
```

Expect `uid=0(root)`, `mass_storage,adb`, WebView `44.0.2403.119`, the three vendor packages, and **no** port-7806 connection (it never went online).

### 8.5 Back up before any change

Use **Git Bash** on Windows (PowerShell's `>` corrupts binary data). Each partition is read twice and compared, then checked against a hash computed on the frame:

```bash
mkdir -p backups && cd backups
adb -d exec-out 'dd if=/dev/block/by-name/system bs=1048576 2>/dev/null' > system.1.img
adb -d exec-out 'dd if=/dev/block/by-name/system bs=1048576 2>/dev/null' > system.2.img
adb -d exec-out 'dd if=/dev/block/by-name/boot bs=1048576 2>/dev/null' > boot.img
adb -d exec-out 'toybox tar -C /system/app -cf - webview 2>/dev/null' > stock-webview.tar
sha256sum system.1.img system.2.img boot.img
adb -d shell '/sbin/busybox sha256sum /dev/block/by-name/system /dev/block/by-name/boot'
```

The two system copies and the frame's hash must match; on this unit system was exactly 1,073,741,824 bytes and boot 33,554,432. Keep the backups somewhere safe; `private/` is git-ignored if you keep them in the repo folder.

### 8.6 Build the kiosk app

Follow [../kiosk/README.md](../kiosk/README.md):
- install JDK 17 and Android build-tools 34.0.0 + platform 34,
- clone the upstream kiosk and apply `kiosk/rodeo-kiosk.patch`,
- set `DEFAULT_URL` to your site,
- build `homehq.apk`.

### 8.7 Install it and make it the home screen

```bash
adb -d install homehq.apk
adb -d shell am start -n com.wesbos.homehq/.MainActivity --ez home true
adb -d shell am start -a android.intent.action.MAIN -c android.intent.category.HOME
```

The last command opens **Select a Home app** on the frame: tap **Home HQ**, then **Always**.

### 8.8 Prove the way back before closing the way in

On the dashboard: hold **two fingers** still, about an inch apart, for 1.5 s → the kiosk menu → **Android settings** → it opens. Then send it home with the HOME command above. Don't continue until this works.

### 8.9 Disable the vendor apps

```bash
adb -d shell pm disable com.efercro.os.aimor
adb -d shell pm disable com.yhk.qeota
adb -d shell pm disable com.DeviceTest
```

Undo any of them with `pm enable <package>`. Wait about 30 seconds, then reboot (`adb -d reboot`). **The reboot can take ~5 minutes**, during which the frame disappears from USB. That's normal on this firmware; wait.

After it's back, confirm:

```bash
adb -d shell "grep -E 'aimor|qeota|DeviceTest' /data/system/users/0/package-restrictions.xml"
adb -d shell "dumpsys activity activities | grep -m1 mResumedActivity"
```

You're looking for `enabled="2"` on all three, and Home HQ in front.

### 8.10 Wi-Fi, time zone, your URL, the Back button

1. On the frame: **Open Wi-Fi settings** (button on the kiosk's offline screen), join your network.
2. Time zone (the frame ships set to New York):
   ```bash
   adb -d shell service call alarm 3 s16 America/Denver
   ```
3. Save your keyed URL. Type your key into your own terminal, not into chats or notes:
   ```bash
   adb -d shell "am start -n com.wesbos.homehq/.MainActivity --es url 'https://YOUR-SITE.netlify.app/?key=YOUR_KEY'"
   ```
4. Turn on the hidden Back/Dashboard buttons (5 taps in the bottom-right corner):
   ```bash
   adb -d shell pm grant com.wesbos.homehq android.permission.WRITE_SECURE_SETTINGS
   adb -d shell am force-stop com.wesbos.homehq
   adb -d shell am start -a android.intent.action.MAIN -c android.intent.category.HOME
   ```
5. Confirm it stays off the vendor server: `adb -d shell "netstat -an | grep 7806"` should print nothing.
6. Stand the frame in **portrait**. The kiosk follows the tilt sensor.

---

## 9. Using it

| To do this | Do this |
|---|---|
| Get back from Android Settings | **Tap the bottom-right corner 5 times quickly**, then **Dashboard** |
| Kiosk menu (launcher, settings, Wi-Fi, reload) | Hold two fingers 1.5 s |
| Dismiss / snooze an alert | **Got it** / **Snooze 10 min** (the 5-minute pulse offers Got it only) |
| Look around the map | Drag, pinch; ⤢ full screen, ⌂ back; resets after 60 s. Wind speeds up to 30 fps while you touch it |
| Hide CTL/ATL/TSB | Tap the load line |
| Scroll events/tasks | Swipe; they jump back to the top after 60 s |
| Night mode at 7 PM | **Stay on 1 hour** or let it dim after 2 minutes |
| Open an event in Google Calendar | On a computer: click it |

## 10. Updating

- **Dashboard or server changes:** push to `main`; Netlify deploys in about 20 seconds; the frame picks it up on its next reload (Home, or the kiosk menu's Reload).
- **Kiosk app changes:** rebuild and `adb -d install -r homehq.apk`. Same signing key, so your saved URL survives.
- **Previewing locally:** `python tools/serve_nocache.py 8787 site`, then http://localhost:8787. To view it on the frame over USB: `adb -d reverse tcp:8787 tcp:8787` and open `http://127.0.0.1:8787/` with the VIEW command in `kiosk/README.md`.

## 11. Troubleshooting (things we actually hit)

| Symptom | Cause / fix |
|---|---|
| "Not authorized" on a connect link | Env vars changed after the last deploy. Trigger a deploy. Check the key matches exactly. |
| Strava: `redirect_uri invalid` | Callback domain in the Strava app isn't exactly `YOUR-SITE.netlify.app`. |
| `/api/data` shows `"google":"not-connected"` | The connect link was never completed. Open it and approve. |
| Netlify wants Pro to link the repo | The repo is in an organization. Move it to your personal account. |
| Map tiles say "API KEY REQUIRED" | CARTO now needs a key; the dashboard uses OpenStreetMap tiles darkened with CSS instead. |
| Wind (or any third-party API) fails only on the frame, `Certificate error 3` | Android 6 lacks Let's Encrypt's current root. Fetch those APIs through a Netlify function, as `/api/wind` does. |
| Strange rectangles or seams on the frame only | WebView 44 bugs: avoid off-canvas radial gradients and blurred `text-shadow` on huge text. `lab/sky.html?hide=motion\|clock\|now\|bg` helps isolate. |
| CSS/JS edits don't show in the local preview | Use `tools/serve_nocache.py`; Python's plain server lets the browser cache. |
| Clock 2 hours off | Frame time zone. See step 8.10. |
| Clock reads 1969 | No network time yet; it fixes itself on Wi-Fi. |
| `adb reboot` "hangs" | It takes ~5 minutes on this firmware. Wait, or power-cycle. |
| Reinstalling the kiosk dropped "Always" for Home | Harmless once AiMOR is disabled (Home HQ is the only home app). If a chooser appears: Home HQ → Always. |
| `adb shell input tap` can't trigger the 5-tap zone | Each simulated tap takes ~1.7 s on this frame. Test with a finger. |

## Performance (measured on this frame)

Any continuous animation costs about **12–20% CPU** on this hardware, roughly the same for CSS, canvas or WebGL; the cost follows frames per second, not how much is drawn. So the dashboard paints static things once and animates only when needed:
- Dashboard with sky and map wind: about 18%.
- While touching the map: about 38%.
- The 5-minute alert pulse: about 30%.

Full numbers are in [frame-setup-log.md](frame-setup-log.md).

## Licensing and limits

- **Kiosk app:** wesbos/photo-frame-dashboard, MIT ([../kiosk/UPSTREAM-LICENSE](../kiosk/UPSTREAM-LICENSE)).
- **Open-Meteo** (forecast, AQI, wind): the free API is for **non-commercial** use; a business should check their paid plans.
- **OpenStreetMap tiles:** follow the OSM tile usage policy (light use, attribution shown on the map).
- **Radar:** NWS NEXRAD via the Iowa Environmental Mesonet. **Alerts:** NWS (set `DASH_CONTACT`).
- **Strava** and **Google** APIs: their API terms apply; this is a single-user, read-only app.
- **Netlify free plan:** this uses scheduled functions, Blobs and about one function call per 3 minutes from the frame, well within free limits.
