# FreeFounders Android app (Expo): the web app in a native shell

PLAN.md §19.17. The phone app **is the FreeFounders web app** (`apps/web`): the same screens, look and features (Home
with attendance first, Attendance / Tasks / Assets / Admin, the bottom bar…), shown full-screen in a WebView. The shell
adds only what a WebView cannot do by itself:

| Native part | Why |
|---|---|
| Punch **location** (expo-location, high accuracy, 10 s) | Android's WebView refuses the browser's GPS on plain `http://` |
| Punch **selfie** (expo-camera front camera, Retake / Use photo, JPEG 0.6, ≤ 720 px) | same for the browser camera; and a better camera |
| **Downloads** (reports CSV/XLSX, payroll, form submissions, Assets photos) → saved + Android share sheet | a WebView cannot save files |
| **Print** (ID cards, labels) → Android print dialog (also "Save as PDF") | a WebView cannot print |
| Back button, pull-to-refresh, splash, "Can't reach FreeFounders" screen with a server-address field | |
| Links to other sites, `tel:`, `mailto:`, WhatsApp → the phone's apps | |

**No face matching in the app** (founder, 2026-10-12): if the company has face check on, punching in the app shows
"Face check is on for your company; the app punches with a selfie only — ask your admin to switch face check off in
Attendance → HR settings" and nothing is sent. In a normal browser everything works exactly as before.

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
FreeFounders" screen shows the address, **Try again** and **Change server address** (kept on the phone; "Use the
default" goes back). Check the server from the phone's own browser: `http://<PC address>:8080/api/platform/health`.

**Windows Firewall:** allow Node.js on **Private networks** (ports 8080 and 8081), otherwise the phone cannot reach the PC.

**Permissions** (asked for "Expo Go" while testing): Location the first time a punch needs it (office geofence on) or
"use my location" in HR settings; Camera for the punch selfie, and the first time a photo picker is opened (so
"Camera" is offered next to the gallery). Blocked? Android Settings → Apps → Expo Go → Permissions.

## The bridge

The shell puts `window.FreeFoundersApp = { platform: 'android', version, camera }` into every page before it loads
(`src/lib/injected.ts`). The web side is `apps/web/src/lib/native-bridge.ts` (`isInApp()`, `appRequest()`,
`saveFile()`, `printPage()`); it is used only when `window.FreeFoundersApp` and `window.ReactNativeWebView` exist.

```
web → app   window.ReactNativeWebView.postMessage(JSON)
  {"id":"r1","type":"location"}
  {"id":"r2","type":"photo","title":"Check in","optional":false}
  {"id":"r3","type":"download","filename":"attendance-daily-2026-10-12.xlsx","mime":"…","base64":"…"}
  {"id":"r4","type":"print","html":"<html>…"}
app → web   webview.postMessage(JSON)  → a "message" event on document (Android)
  {"id":"r1","ok":true,"data":{"latitude":12.97,"longitude":77.59,"accuracy":8}}
  {"id":"r2","ok":true,"data":"data:image/jpeg;base64,…"}      (data null = "Punch without a photo", optional only)
  {"id":"r2","ok":false,"error":"cancelled"}
  {"id":"r3","ok":true,"data":{"saved":true,"name":"…"}}
  {"id":"rX","ok":false,"error":"<message for the person>"}
events from the injected script (no id, no answer)
  {"type":"scroll","atTop":true}        pull-to-refresh only when the page is scrolled to the top
  {"type":"camera-for-files"}           a photo picker wants the camera permission first
```

The injected script also answers `navigator.geolocation.getCurrentPosition` with the app's GPS (ids `g…`).
Punch inside the app (`apps/web/src/features/hr/punch.tsx`): face check on → the message above, no punch; photo
off/optional/required → none / native camera with "Punch without a photo" / native camera; location only when the
company has a geofence, and the app's reason is shown when it fails (GPS off, blocked, no fix in 10 s).

## Checks

```
npm --prefix apps/mobile run typecheck     # tsc --noEmit
npm --prefix apps/mobile test              # node:test: bridge protocol, links, server address, injected script, files, selfie size, oklch
cd apps/mobile && npx expo export --platform android   # the JS bundle builds
cd apps/mobile && npx expo-doctor
npx --prefix e2e playwright test -c e2e/playwright.config.ts web-app-shell.spec.ts   # the web app inside a simulated shell
```

## Layout

```
src/app/_layout.tsx, index.tsx   one screen: the shell
src/shell/shell.tsx              WebView + bridge + back button + pull-to-refresh + splash + offline screen
src/shell/selfie-camera.tsx      the punch selfie (front camera)
src/shell/offline-screen.tsx     "Can't reach FreeFounders" + server address
src/lib/protocol.ts              bridge messages, link rules, server address (pure, tested)
src/lib/injected.ts              the script injected before each page (tested)
src/lib/files.ts, photo.ts       file names / base64, selfie size (pure, tested)
src/lib/location.ts, native-actions.ts, server-url.ts, palette.ts   native helpers, theme colours (tokens.native.ts)
```

`apps/mobile` is outside the root npm workspace (Expo pins its own React). The only shared code it reads is
`@freefounders/theme/native` (hex copy of the design tokens, generated by `packages/theme/scripts/build-native.mjs` and
checked by `scripts/check-web-rules.mjs`), for the splash, status bar and the shell's own screens.

The first version (separate React Native screens, §19.16) is in git history (commit `af2efa3`).

Not yet: push notifications through the shell, EAS builds (an APK needs `usesCleartextTraffic` for local `http://`,
or an https staging server), the Assets QR scanner and Tasks voice notes in the app (both use the browser camera /
microphone, which a WebView allows only on https).
