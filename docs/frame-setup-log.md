# Frame setup log

Running notes for the photo-frame takeover (spec phase 1), following
[wesbos/photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard) `docs/pf1007l-start-here.md`.
Rule from the guide: ask before every write, verified backup before any write, one change at a time, record the undo first.

## 2026-11-10: arrival and read-only checks

**Host:** Windows 11. adb = Google Android SDK Platform-Tools 37.0.1, unzipped to a local tools folder (zip SHA-256 `45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99`; adb.exe, AdbWinApi.dll, AdbWinUsbApi.dll, fastboot.exe all validly signed by Google LLC).

**USB:** the supplied cable carries data. Windows sees `USB\VID_1F3A&PID_1002` (composite: mass storage + "Android" ADB interface). No extra driver was needed.

**ADB:** works out of the box, no test-app password needed. `adb devices -l` → `device product:astar_m86_8723cs model:AEEZO`. ADB runs as root with no authorization prompt.

| Check | Result |
|---|---|
| `id` | `uid=0(root)` |
| Fingerprint | `AEEZO/astar_m86_8723cs/astar-m86_8723cs:6.0.1/MOB30R/20260410:eng/test-keys` |
| Firmware date | 20260410, in the guide's tested table (`321-OS-AIMOR.0.20260410`) |
| Android / SDK / ABI | 6.0.1 / 23 / armeabi-v7a |
| Platform | `astar` (Allwinner A33), board `exdroid` |
| Screen | 1280×800, density 160 |
| SELinux | Disabled |
| `persist.sys.usb.config` | `mass_storage,adb` (ADB already persistent) |
| `adb_enabled` | 1 |
| WebView | `com.android.webview` 44.0.2403.119 at `/system/app/webview` (stock) |
| Vendor apps present | `com.efercro.os.aimor` (running), `com.yhk.qeota` (running), `com.DeviceTest` |
| Port 7806 (vendor command channel) | No connection |
| Wi-Fi | Radio **on**, but no saved network: scanning, not connected, no IP, no route |
| Partitions | `boot` → `mmcblk0p6`, `system` → `mmcblk0p7` |
| Free space | 12.1 GB of 12.4 GB on /data (/sdcard) |

**Status:** the frame has never been online, so the vendor app hasn't reached its server. Don't join a Wi-Fi network until the vendor app is blocked or disabled (guide: `docs/aimor-remote-root-shell.md`).

Nothing has been written to the frame yet.

## 2026-11-10: verified backup (read-only on the frame)

Captured over USB with `adb -d exec-out 'dd if=/dev/block/by-name/<part> bs=1048576'` from Git Bash (binary-safe; PowerShell 5.1 `>` would corrupt it). Each partition was read twice and compared, then hashed on the frame with `/sbin/busybox sha256sum`. Stored in `private/frame-backups/` (git-ignored), with `SHA256SUMS`.

| Backup | Bytes | SHA-256 | Checks |
|---|---|---|---|
| `a33-system-20260410.img` (mmcblk0p7, starts at sector 237568) | 1,073,741,824 | `cfcc312353aa49df5a365a721cd7f8bb5f02b59a042a3bd0cb428867b7f15b43` | Two PC reads identical; matches the frame's own hash (and MD5 `7a1f9445…185e`); 0 chunks of 0xCC filler |
| `a33-boot-20260410.img` (mmcblk0p6, starts at sector **172032**, the guide's T6 value) | 33,554,432 | `5643859435adfa0435b180c206bd38c130151e55c1054b5a36d77d5a870e4c34` | Two PC reads identical; matches the frame's own hash; 0 chunks of 0xCC |
| `a33-stock-webview-44.0.2403.119.tar` (`/system/app/webview`) | 41,364,480 | `cdd0d689ff91fd5f94d7cc11e880f602ff675c487adddc4497935178b6c5d138` | `webview.apk` (`e8334af7…3cc3`) and `oat/arm/webview.odex` (`32fee2a1…c7a8`) inside it hash the same as on the frame |

Each also has a `.gz` copy (gzip `-t` passed; decompressing reproduces the SHA-256 above).

**Not captured** (as the guide notes for this sample backup): userdata, the hardware boot areas, and the other partitions.

## 2026-11-10: kiosk app built and installed; first test on the frame (still offline)

**The frame has no browser app**, only `com.android.webview`, so a page needs an app that hosts a WebView.

**Build host tools** (in a local tools folder):
- Eclipse Temurin JDK 17.0.21+9 (zip SHA-256 `98518ecf…f84b`, matched)
- Android build-tools 34.0.0 (`build-tools_r34-windows.zip`, SHA-1 `62cfde1b…fd47`, matched Google's index)
- Android platform 34 (`platform-34-ext7_r03.zip`, SHA-1 `1f2e9478…103d`, matched). The user accepted the Android SDK license.

**Kiosk source:** `wesbos/photo-frame-dashboard` `dashboard/kiosk` at commit `34c91641e3cd`, sparse-cloned outside the repo. Reviewed before building:
- no JavaScript bridge, never bypasses certificate errors, http/https only
- logs URLs without their query (keeps the key out of logcat)
- remote debugging off by default
- the accessibility service only draws Back/Home buttons and can't read the screen
- the only extra network call is Android's `connectivitycheck.gstatic.com` probe

One local change: `DEFAULT_URL` → `https://YOUR-SITE.netlify.app/`. Built with `build.ps1`, which created a debug signing key at `%USERPROFILE%\.android\debug.keystore`. Output `homehq.apk`: 33,400 bytes, SHA-256 `3a25b620f6f6fe93527a3a18e4295af7f5d3e39568a718ff9fc3e7a20b8c58e5`, package `com.wesbos.homehq` 1.2, min SDK 23.

**First write to the frame (user approved):** `adb -d install homehq.apk`, installed to `/data/app/com.wesbos.homehq-1`. **Undo:** `adb -d uninstall com.wesbos.homehq`. It is not the home screen; nothing was disabled.

**Test:** `adb -d reverse tcp:8787 tcp:8787` forwarded the PC's local preview over USB (the forward lasts until reboot or `adb reverse --remove-all`). Opened with `am start -a android.intent.action.VIEW -d http://127.0.0.1:8787/... -n com.wesbos.homehq/.MainActivity`, a VIEW link, so it's not saved as the kiosk URL.

| Result on WebView 44.0.2403.119 at 1280×800 | |
|---|---|
| Layout, fonts, SVG icons, Strava ring, load switch, scrolling lists | All correct; no JavaScript errors |
| Takeover, split screen, night prompt | Render correctly |
| Map | Blank offline (Leaflet and tiles come from the internet); retest once online |
| Expand-map icon (⤢) | Showed an empty box: the Android 6 font lacks the glyph. **Fixed** with drawn SVG icons |
| Clock | Shows Dec 31, 1969: no network time while offline |
| CPU (kiosk process, `top`) | Dashboard or plain alert: 0–1%. 5-minute pulse: 35–55% when animating background-color, **~30%** after switching to an opacity-faded layer (stepping it didn't help further) |

**Conclusion:** the dashboard works on the stock WebView 44, so the guide's WebView 106 swap (a `/system` write) isn't needed for now.

## 2026-11-10: lockdown (T8), user approved each step

Before: AiMOR's `cn.nineox.robot.aimor.activity.NavigationActivity` was the home screen, with no default chosen.

| # | Change | Command | Undo | Verified |
|---|---|---|---|---|
| 1 | Offer the kiosk as Home | `am start -n com.wesbos.homehq/.MainActivity --ez home true` | same with `--ez home false` | `enabledComponents: com.wesbos.homehq.Home` |
| 2 | Make it the default Home | On the frame: Home chooser → **Home HQ** → **Always** (user tapped; touch works) | Settings → Home, or clear defaults | `package-restrictions.xml`: `com.wesbos.homehq/.Home always="true"` |
| 3 | Prove the way back | User: two-finger hold 1.5 s → kiosk menu → Android settings → back | n/a | Works |
| 4 | Disable AiMOR | `pm disable com.efercro.os.aimor` | `pm enable com.efercro.os.aimor` | `enabled="2"`, process gone |
| 5 | Disable updater | `pm disable com.yhk.qeota` | `pm enable com.yhk.qeota` | `enabled="2"`, process gone |
| 6 | Disable test app | `pm disable com.DeviceTest` | `pm enable com.DeviceTest` | `enabled="2"` |

**Gotcha:** `input keyevent KEYCODE_HOME` over adb didn't leave the Settings app on this firmware, but a HOME intent (`am start -a android.intent.action.MAIN -c android.intent.category.HOME`) resolved to Home HQ.

**Reboot** (`adb reboot`): the screen stayed on the boot logo for several minutes, and the frame was off USB the whole time. It came back on its own after about 5½ minutes (no replug or power cycle needed). The guide notes `adb reboot` can be slow or hang on these units and suggests power cycles instead.

**After reboot:**
- ADB still root over USB (`mass_storage,adb`)
- Home HQ came up by itself ("Connect to Wi-Fi?"); the "Always" Home choice survived
- All three vendor apps still `enabled="2"`, no vendor processes, no port-7806 connection
- SELinux still Disabled
- Wi-Fi radio on, no network

Lockdown complete. Next: join Wi-Fi, save the keyed kiosk URL, re-check port 7806 online.

## 2026-11-10: on Wi-Fi

- The user joined Wi-Fi on the frame: a LAN IP by DHCP. The clock set itself by network time (`auto_time` 1).
- **No port-7806 connection and no other outbound TCP sessions**; no vendor processes.
- **Time zone** was America/New_York. Set to Denver (user approved): `service call alarm 3 s16 America/Denver`. Undo: same with `America/New_York`.
- Live site in the kiosk: map tiles, radar and markers render. Wind failed with `Certificate error 3` (untrusted CA): Android 6 lacks Let's Encrypt's current root, which Open-Meteo uses. Netlify (`*.netlify.app`), OSM tiles and IEM radar load fine. Fixed by relaying wind through `/api/wind` (v0.5.1).
- CPU with the map shown and no wind animation: 0–1%. Wind-animation CPU is still to measure after v0.5.1 deploys.

## 2026-11-10: v0.5.1 deployed; live data on the frame

- `/api/wind` works from the frame (no certificate errors in logcat). Wind streaks animate.
- The user saved the keyed kiosk URL themselves (`--es url …?key=…`). Logcat shows only `https://YOUR-SITE.netlify.app/ (query … not logged)`, so the key isn't in the log.
- Live on the frame: Strava week/year/load, weather, AQI, wind, Google Calendar (today + tomorrow), Tasks. Clock in Denver time.
- **CPU, kiosk process (`top`, 1 s samples):** animated wind ~30% average (0–48%); static arrows (`?wind=static`) 0–1%; no map animation 0–1%. Device temp 41 °C.

## 2026-11-10: portrait (v0.6.0)

- Kiosk rebuilt with `screenOrientation="sensorPortrait"` and reinstalled with `adb -d install -r` (user approved). Undo: rebuild with `sensorLandscape` and reinstall.
- Kept across the reinstall: the saved keyed URL, the Home alias (`enabledComponents: com.wesbos.homehq.Home`). The preferred-Home entry changed to `always="false"`, but Home still resolves to Home HQ, because it's the only enabled Home app (AiMOR is disabled). Watch for this if a Home chooser ever appears.
- The frame had restarted during the move (uptime ~1 min); it rejoined Wi-Fi by itself (new DHCP address). Still no port-7806 connection.
- v0.6.0 deployed: the frame shows the portrait layout at 800×1280 with live data, no console errors.
- **CPU with wind at 10 fps:** ~25% average (0–37%), down from ~30% (0–48%) at 20 fps.

## 2026-11-10: 5-tap navigation overlay (v0.7.0 kiosk)

- Kiosk reinstalled (`adb -d install -r`); saved keyed URL kept.
- Permission granted (user approved): `pm grant com.wesbos.homehq android.permission.WRITE_SECURE_SETTINGS`. **Undo:** `pm revoke com.wesbos.homehq android.permission.WRITE_SECURE_SETTINGS`, then `settings put secure enabled_accessibility_services ""` and `settings put secure accessibility_enabled 0`.
- On start the kiosk enabled its accessibility service itself (`enabled_accessibility_services = com.wesbos.homehq/com.wesbos.homehq.NavigationService`).
- Outside the dashboard, an invisible 120×120 dp tap zone sits in the bottom-right corner; 5 quick taps (within 3 s) show Back / Dashboard for 15 s. **The user confirmed it works from Wi-Fi settings.** (`adb shell input tap` is too slow to test it: 5 taps took 8.4 s.)

## 2026-11-10: hardware notes and animation benchmark

- **No SystemUI** runs on this firmware: no navigation bar, no status bar, no on-screen Back/Home outside the kiosk. Input devices: `gslX680` (touch), `sc7a20` (accelerometer), `lightsensor`, `axp22-supplyer` (power), `sunxi-ths` (thermal), `headset`. No hardware Back key.
- **GPU:** ARM Mali-400 MP, OpenGL ES 2.0. **WebGL is available** in WebView 44.
- **Benchmark** (`design/anim-bench.html`, 800×200 area, kiosk process CPU from `top`, ~10 one-second samples each):

| Technique | Avg CPU |
|---|---|
| Idle | 0% |
| CSS transform animation: 3 drifting cloud layers | 26% |
| CSS transform animation: 3 tiled snow layers | 27% |
| Canvas 2D, 60 flakes, 10 fps | 15% |
| Canvas 2D, 150 flakes, 10 fps | 14% |
| Canvas 2D, 150 flakes, 5 fps | 12% |
| Canvas 2D, 150 flakes, 20 fps | 22% |
| WebGL, 300 point sprites (GPU-animated), 10 / 20 / 30 fps | 16% / 19% / 28% |

**Living-sky scenes** (`site/lab/sky.html`, full 768×186 header, before the cloud/rain savings): clear day 0%, clear night 9%, frigid 14%, cloudy 14%, snow 14%, rain 21%, windy 12%, storm 11%. A single drifting cloud cost as much as a full sky, so clouds now start at 25% cover; rain dropped to 12 fps. Dashboard with sky clouds and no map wind: ~15–23%.

**WebView 44 rendering bugs found and fixed:** an off-canvas radial gradient drew a hard vertical seam (now linear gradients), and blurred `text-shadow` on huge text is avoided. Isolated with the lab's `?hide=motion|clock|now|bg` switches.

**Live, v0.7.0** (clear afternoon, 2% cloud, wind 8 mph gusting 15): dashboard with sky and map wind at 10 fps ~18% average; after touching the map (wind at 30 fps) ~38%, dropping back after the 60 s idle reset.

**Takeaways:** CSS animation isn't composited cheaply here. Canvas and WebGL cost about the same. The cost tracks frame updates, not particle count, with a floor of about 12% for any continuous motion. Static visuals (gradients, pre-drawn art) cost nothing.
