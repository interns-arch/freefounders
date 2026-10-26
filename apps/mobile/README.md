# Kaampilot Android app (Expo): the web app in a native shell

PLAN.md §19.17. The phone app **is the Kaampilot web app** (`apps/web`): the same screens, look and features (Home
with attendance first, Attendance / Tasks / Assets / Admin, the bottom bar…), shown full-screen in a WebView. The shell
adds only what a WebView cannot do by itself:

| Native part | Why |
|---|---|
| Punch **location** (expo-location, high accuracy, 10 s) | Android's WebView refuses the browser's GPS on plain `http://` |
| Punch **selfie** (expo-camera front camera, Retake / Use photo, JPEG 0.6, ≤ 720 px) | same for the browser camera; and a better camera |
| **Downloads** (reports CSV/XLSX, payroll, form submissions, Assets photos) → saved + Android share sheet | a WebView cannot save files |
| **Print** (ID cards, labels) → Android print dialog (also "Save as PDF") | a WebView cannot print |
| **Voice draft** (speak a task) → the phone's speech recogniser (expo-speech-recognition) after Android's microphone pop-up, words back to the web app | a WebView on plain `http://` gets no microphone (PLAN.md §19.30; app 1.1.0+, not in Expo Go) |
| **Punch-in reminder** (expo-notifications): local notifications that ring / vibrate at the chosen time on the chosen days, even with the app closed; a tap opens Attendance | a web page cannot wake a closed phone (PLAN.md §19.32; app 1.2.0+) |
| Back button, pull-to-refresh, splash, "Can't reach Kaampilot" screen with a server-address field | |
| Links to other sites, `tel:`, `mailto:`, WhatsApp → the phone's apps | |

**No face matching anywhere** (founder, 2026-10-12; PLAN.md §19.18): a punch is the office geofence + a selfie stored
with it, in the app and in the browser. Face check was removed from the web app and the Tasks API.

Sign-in is the web's own: the refresh cookie is kept in the WebView's cookie store, so the app opens signed in.

## Try it on your Android phone

1. On the PC: `npm run dev` (repo root). It prints the addresses for phones, e.g. `http://192.168.137.1:8080`
   (laptop hotspot) and `http://192.168.2.72:8080` (office Wi-Fi). Switch the hotspot on **before** `npm run dev`, or
   restart it after: the Tasks API accepts the PC's network addresses that exist when the suite starts.
2. First time only: `npm --prefix apps/mobile ci` (or `npm run setup`).
3. Start the app server: `npm run mobile` (repo root). It prints a QR code.
4. Phone: connect to the laptop's hotspot (or the same Wi-Fi), install **Expo Go** from the Play Store, scan the QR.
5. The web app opens (sign in once, e.g. `owner` / `Demo@1234` on demo data). On a phone it lands on Attendance.

**Which address the app opens:** `EXPO_PUBLIC_WEB_URL` from `apps/mobile/.env` (copy `.env.example`; never commit
`.env`; restart `npm run mobile` after a change), else `app.json` `extra.webUrl` (`http://192.168.137.1:8080`).
**On the phone** the address can be changed without rebuilding: when the page cannot load, the "Can't reach
Kaampilot" screen shows the address, **Try again** and **Change server address** (kept on the phone; "Use the
default" goes back). Check the server from the phone's own browser: `http://<PC address>:8080/api/platform/health`.

**Windows Firewall:** allow Node.js on **Private networks** (ports 8080 and 8081), otherwise the phone cannot reach the PC.

**Permissions** (asked for "Expo Go" while testing): Location the first time a punch needs it (office geofence on) or
"use my location" in HR settings; Camera for the punch selfie, and the first time a photo picker is opened (so
"Camera" is offered next to the gallery). Blocked? Android Settings → Apps → Expo Go → Permissions.

## The bridge

The shell puts `window.KaampilotApp = { platform: 'android', version, camera, capabilities }` into every page before it loads
(`src/lib/injected.ts`). The web side is `apps/web/src/lib/native-bridge.ts` (`isInApp()`, `appRequest()`,
`saveFile()`, `printPage()`); it is used only when `window.KaampilotApp` and `window.ReactNativeWebView` exist.

```
web → app   window.ReactNativeWebView.postMessage(JSON)
  {"id":"r1","type":"location"}
  {"id":"r2","type":"photo","title":"Check in","optional":false}
  {"id":"r3","type":"download","filename":"attendance-daily-2026-10-12.xlsx","mime":"…","base64":"…"}
  {"id":"r4","type":"print","html":"<html>…"}
  {"id":"r5","type":"voice","lang":"en-IN"}        ("hi-IN" for Hindi)      {"id":"r6","type":"voice-stop"}   (Done)
  {"id":"r7","type":"reminder-set","settings":{"enabled":true,"time":"09:20","days":[1,2,3,4,5,6],"mode":"ring-vibrate","followUpMinutes":10}}
  {"id":"r8","type":"reminder-get"}   {"id":"r9","type":"reminder-skip-today"}   {"id":"rA","type":"reminder-off"}
  {"id":"rB","type":"reminder-test","mode":"vibrate"}           (one reminder in 5 s)
app → web   webview.postMessage(JSON)  → a "message" event on document (Android)
  {"id":"r1","ok":true,"data":{"latitude":12.97,"longitude":77.59,"accuracy":8}}
  {"id":"r2","ok":true,"data":"data:image/jpeg;base64,…"}      (data null = "Punch without a photo", optional only)
  {"id":"r2","ok":false,"error":"cancelled"}
  {"id":"r3","ok":true,"data":{"saved":true,"name":"…"}}
  {"id":"r5","ok":true,"data":{"text":"Rahul ko kal 5 baje tak quotation bhejna hai"}}
  {"id":"r5","ok":false,"error":"…","code":"permission","permission":"microphone","settings":true}   (or "code":"unavailable")
  {"id":"r7","ok":true,"data":{"settings":{…},"permission":"granted","next":"2026-10-23T03:50:00.000Z","skipped":null}}
  {"id":"r7","ok":false,"error":"…","code":"permission","permission":"notifications","settings":true}
  {"id":"rX","ok":false,"error":"<message for the person>"}
events from the injected script (no id, no answer)
  {"type":"scroll","atTop":true}        pull-to-refresh only when the page is scrolled to the top
  {"type":"camera-for-files"}           a photo picker wants the camera permission first
```

The injected script also answers `navigator.geolocation.getCurrentPosition` with the app's GPS (ids `g…`).
Punch inside the app (`apps/web/src/features/hr/punch.tsx`): photo off/optional/required → none / native camera with "Punch without a photo" / native camera; location only when the
company has a geofence, and the app's reason is shown when it fails (GPS off, blocked, no fix in 10 s).

## Punch-in reminder (PLAN.md §19.32, app 1.2.0+)

Each person sets it in the web app (Attendance → Today, or account menu → Punch-in reminder; only shown when the shell
lists `reminders` in `capabilities`): time (default 10 min before office start), days (default the company's working
days, 1 = Monday … 7 = Sunday), Vibrate / Ring / Ring + vibrate, and "remind again after 10 min" (`followUpMinutes`).
The shell (`src/lib/reminders.ts`) keeps the settings on the phone (expo-secure-store) and schedules **local
notifications** with expo-notifications; the plan is the pure `src/lib/reminder-plan.ts`:

- one **weekly** notification per chosen day (+ the follow-up; after midnight it rings the next weekday);
- `reminder-skip-today` (sent by the web after a check-in in the app): a weekly repeat cannot skip one week, so that
  day's reminders (and a follow-up of the day before ringing after midnight) become one-off notifications for the next
  4 weeks; the plan is rebuilt at every app start, so from the next day it is weekly again;
- Android channels: `punch-reminders` (sound + vibration), `punch-reminders-ring`, `punch-reminders-vibrate`; high
  importance, on the lock screen. Permission: Android 13+ asks "Allow notifications?" when the reminder is switched on.

**Limits (the truth):**
- **Timing**: expo-notifications uses an exact alarm when Android allows it, else an inexact one. `SCHEDULE_EXACT_ALARM`
  is declared, so it is exact on Android 12–13; on Android 14+ only if the person allows Settings → Apps → Kaampilot →
  **Alarms & reminders** (off by default). Otherwise Android may ring a few minutes late, more in battery saver / Doze.
- **Ringing** is the notification sound (silenced by Do Not Disturb or silent mode), not a full-screen alarm clock.
- **Reboot / app update**: kept. expo-notifications stores scheduled notifications and re-registers them on
  `BOOT_COMPLETED`, `REBOOT`, `QUICKBOOT_POWERON` and `MY_PACKAGE_REPLACED` (checked in its 57.0.23 source:
  `NotificationsService.kt`, `ExpoSchedulingDelegate.kt`). **Force stop** (or a phone maker's aggressive battery mode)
  cancels Android alarms until the app is opened again.
- Skipping works only for a check-in **in the app** (or when Today/Home is opened after checking in elsewhere).
- Settings stay on this phone; a new phone starts from the company defaults (nothing is saved on the server).

## Checks

```
npm --prefix apps/mobile run typecheck     # tsc --noEmit
npm --prefix apps/mobile test              # node:test: bridge protocol, links, server address, injected script, files, selfie size, oklch, reminder plan
cd apps/mobile && npx expo export --platform android   # the JS bundle builds
cd apps/mobile && npx expo-doctor
npx --prefix e2e playwright test -c e2e/playwright.config.ts web-app-shell.spec.ts   # the web app inside a simulated shell
```

## Layout

```
src/app/_layout.tsx, index.tsx   one screen: the shell
src/shell/shell.tsx              WebView + bridge + back button + pull-to-refresh + splash + offline screen
src/shell/selfie-camera.tsx      the punch selfie (front camera)
src/shell/offline-screen.tsx     "Can't reach Kaampilot" + server address
src/lib/protocol.ts              bridge messages, link rules, server address (pure, tested)
src/lib/injected.ts              the script injected before each page (tested)
src/lib/files.ts, photo.ts       file names / base64, selfie size (pure, tested)
src/lib/reminder-plan.ts         punch-in reminder: settings + the notifications to schedule, skip today (pure, tested)
src/lib/reminders.ts             punch-in reminder on Android (expo-notifications, channels, permission, storage)
src/lib/location.ts, native-actions.ts, server-url.ts, palette.ts   native helpers, theme colours (tokens.native.ts)
```

`apps/mobile` is outside the root npm workspace (Expo pins its own React). The only shared code it reads is
`@kaampilot/theme/native` (hex copy of the design tokens, generated by `packages/theme/scripts/build-native.mjs` and
checked by `scripts/check-web-rules.mjs`), for the splash, status bar and the shell's own screens.

The first version (separate React Native screens, §19.16) is in git history (commit `af2efa3`).

Not yet: server push notifications through the shell (the punch-in reminder is local, no push), EAS builds (an APK needs `usesCleartextTraffic` for local `http://`,
or an https staging server), the Assets QR scanner and Tasks voice notes in the app (both use the browser camera /
microphone, which a WebView allows only on https).

**Security** (docs/security/assets-web-mobile-infra.md): the app's powers (location, camera, files, print) are given only
to pages of the server address; other sites open outside, `data:` pages and foreign frames never load; plain `http://`
is accepted only for office-network addresses. For store/tester builds: an `https://` address with
`EXPO_PUBLIC_LOCK_SERVER=1` (no address field on the phone), and https-only traffic — `expo-build-properties` with
`"android": { "usesCleartextTraffic": false }` (Expo Go and local LAN testing need cleartext, so only release builds).

## Updating the installed app (PLAN.md §19.30)

Most changes reach the app by themselves (it shows the web app). A new shell is needed only for new native powers (1.1.0:
voice; 1.2.0: punch-in reminders, expo-notifications). The web app asks an older app once per session to update: `GET /api/platform/app-version` →
`MOBILE_MIN_VERSION` (default 1.1.0) and `MOBILE_APK_URL` (default `/download/kaampilot.apk`, i.e. put the built APK
at `apps/web/public/download/kaampilot.apk`; `*.apk` is git-ignored). "Update now" opens it in the phone's browser.
Raise `version` and `android.versionCode` in `app.json` for every new APK.
