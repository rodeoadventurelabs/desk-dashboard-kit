# Kiosk app (Android)

The frame shows the dashboard through a small full-screen WebView app, **Home HQ**, from Wes Bos's
[photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard) project (`dashboard/kiosk/`, MIT license, see
[UPSTREAM-LICENSE](UPSTREAM-LICENSE)). This folder holds only **our changes**, as a patch against upstream commit
`34c91641e3cdd159756e3f1dcc15914148b2beff` (2026-11-04).

## What the patch changes

| File | Change |
|---|---|
| `AndroidManifest.xml` | `screenOrientation="sensorPortrait"` (was `sensorLandscape`): the dashboard is 800×1280 portrait. |
| `MainActivity.java` | `DEFAULT_URL` → `https://YOUR-SITE.netlify.app/`. **Change this to your own site** (or ignore it: the URL you save with `--es url` wins). |
| `NavigationService.java` | Outside the dashboard, the Back / Dashboard bar is hidden. An invisible 120×120 dp tap zone sits in the bottom-right corner; **5 quick taps** (within 3 s) show the bar for 15 s. The firmware has no Android navigation bar, so this is the only way back from Settings without a restart. |

## Build

Needs (Windows paths shown; see [../docs/SETUP.md](../docs/SETUP.md) for downloads and checksums):
- JDK 17 (e.g. Eclipse Temurin 17)
- Android build-tools **34.0.0** and platform **android-34**, unzipped into an SDK folder:
  `android-sdk\build-tools\34.0.0\` and `android-sdk\platforms\android-34\`

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/wesbos/photo-frame-dashboard.git kiosk-src
cd kiosk-src
git sparse-checkout set dashboard/kiosk
git checkout 34c91641e3cdd159756e3f1dcc15914148b2beff
git apply ../rodeo-desk-dashboard/kiosk/rodeo-kiosk.patch
```

Edit `DEFAULT_URL` in `dashboard/kiosk/src/com/wesbos/homehq/MainActivity.java` to your site, then build (PowerShell):

```bash
$env:ANDROID_HOME = "C:\path\to\android-sdk"; $env:JAVA_HOME = "C:\path\to\jdk-17"; $env:Path = "$env:JAVA_HOME\bin;$env:Path"
cd dashboard\kiosk
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
```

Output: `dashboard\kiosk\build\homehq.apk` (~33 KB, package `com.wesbos.homehq`). The first build creates a debug signing key at `%USERPROFILE%\.android\debug.keystore`; keep it, because later reinstalls must be signed with the same key (or you'll have to uninstall first, which drops the saved URL).

macOS/Linux: same steps with `ANDROID_HOME=/path/to/sdk bash build.sh`.

## Install and set up on the frame

```bash
adb -d install -r dashboard/kiosk/build/homehq.apk
```

Then follow [../docs/SETUP.md](../docs/SETUP.md) step 8 (make it the Home app, save your URL, grant the navigation permission).

| Task | Command |
|---|---|
| Save the dashboard URL (with your key) | `adb -d shell "am start -n com.wesbos.homehq/.MainActivity --es url 'https://YOUR-SITE.netlify.app/?key=YOUR_KEY'"` |
| Offer it as the Home app | `adb -d shell am start -n com.wesbos.homehq/.MainActivity --ez home true`, then pick **Home HQ → Always** on the frame |
| Enable the 5-tap Back/Dashboard overlay | `adb -d shell pm grant com.wesbos.homehq android.permission.WRITE_SECURE_SETTINGS`, then restart the kiosk |
| Open a page once without saving it | `adb -d shell am start -a android.intent.action.VIEW -d 'URL' -n com.wesbos.homehq/.MainActivity` |
| Kiosk controls on the frame | Hold **two fingers** still, about an inch apart, for 1.5 s |
| Remote debugging (only while debugging) | launch with `--ez debug true` |
| Uninstall | `adb -d uninstall com.wesbos.homehq` |
