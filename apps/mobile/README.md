# FreeFounders Android app (Expo)

Phase 7 (PLAN.md §7, §19.16). Steps 1–2 are built: sign-in (stays signed in), Attendance first (punch in / out with GPS
+ selfie, today's status, my month calendar), Leave (balances, apply, my requests, cancel), Holidays, More (profile,
change password on the web, sign out). Light or dark follows the phone; the company brand colour replaces the green.

## Try it on your Android phone (same Wi-Fi as this PC)

1. On the PC, start FreeFounders as usual: `npm run dev` (repo root). It prints the address for phones, e.g.
   `http://192.168.2.72:8080`.
2. First time only: `npm --prefix apps/mobile ci` (or `npm run setup`, which now installs the app too).
3. If your PC's Wi-Fi address is not `192.168.2.72` (see `ipconfig` → IPv4 Address): copy `apps/mobile/.env.example`
   to `apps/mobile/.env` and put your address in `EXPO_PUBLIC_API_URL`. Never commit `.env`.
4. Start the app server: `npm run mobile` (repo root). It prints a QR code.
5. On the phone: install **Expo Go** from the Play Store, connect to the **same Wi-Fi**, open Expo Go and scan the QR.
6. Sign in (e.g. `owner` / `Demo@1234` on the demo data). Attendance opens first.

**Windows Firewall:** the first time, Windows may ask whether Node.js may use the network. Tick **Private networks** and
allow it — otherwise the phone cannot reach the PC (ports 8080 for FreeFounders and 8081 for the app server). If you
clicked "Cancel" earlier: Windows Security → Firewall → Allow an app → Node.js → tick Private.

**If the phone says "Cannot reach FreeFounders":** check both are on the same Wi-Fi (not a guest network), that
`npm run dev` is running, and open `http://<PC address>:8080/api/platform/health` in the phone's browser — it should
say `{"ok":true,...}`.

**Permissions:** the app asks for Location (only when your company has an office geofence) and Camera (only when your
company keeps a punch photo). In Expo Go they are asked for "Expo Go". If you said "Don't allow", the app shows an
"Open settings" button.

## What the punch does

Tap **Punch in** → face check on for the company? the app stops and says so (no face matching on the phone; ask the
admin to switch face check off in Attendance → HR settings) → location (high accuracy, 10 s) when the company has a
geofence → front-camera selfie (JPEG, quality 0.6, at most 720 px, Retake / Use photo; "Punch without a photo" when the
photo is optional) → `POST /tasks/api/attendance/check_in/` with `latitude`, `longitude`, `photo` (data URL). The
server decides; its answer (e.g. "You are 840 m from Head Office…") is shown as-is. Punch out is the same.

## How the monorepo is wired

- `apps/mobile` is **not** in the root npm workspace. It has its own `node_modules` and `package-lock.json`, because
  Expo SDK 57 pins React 19.2.3 / React Native 0.86 while the web app uses React 19.3 — in one workspace there would
  be two Reacts. The root `npm ci`, the web build and the web lockfile are untouched.
- The shared code is used **from source**: `@freefounders/core` (`packages/core`) and `@freefounders/theme/native`
  (`packages/theme/src/tokens.native.ts`).
  - Metro (`metro.config.js`): `watchFolders` = `packages/core`, `packages/theme`; a `resolveRequest` maps
    `@freefounders/*` through each package's `exports`, and makes every bare import inside `packages/*` (`react`,
    `@tanstack/react-query`, …) resolve from **this app's** `node_modules`. Result: one React in the bundle (checked
    with the export's source map: 0 files from the root `node_modules`). Metro only reads `apps/mobile/node_modules`.
  - TypeScript (`tsconfig.json` `paths`): the same mapping, and `react` / `@tanstack/react-query` pinned to this app's
    copies so the shared hooks type-check against the same React. Because Expo would otherwise apply these `paths` to
    the bundle too, `app.json` sets `experiments.tsconfigPaths: false` and Metro resolves the app's `@/` alias itself.
- `@freefounders/core` is set up in `src/lib/core.ts`: `configureCore({ origin: API_URL, refreshStore })`. The refresh
  store (`src/lib/refresh-store.ts`) keeps the refresh token in `expo-secure-store`; having one makes core sign in with
  `client: 'mobile'` (the Platform returns the refresh token in the body) and send it on refresh / sign-out. The access
  token stays in memory; Tasks accepts it as a Bearer token.
- Colours: React Native cannot draw `oklch()`, so `packages/theme/src/tokens.native.ts` is a **generated** hex copy of
  `tokens.ts` (`node packages/theme/scripts/build-native.mjs`). `scripts/check-web-rules.mjs` (run before every web
  typecheck/build) fails when it is out of date. `src/lib/theme.tsx` = tokens + phone light/dark + brand colour.
- Font: Plus Jakarta Sans via `@expo-google-fonts/plus-jakarta-sans` (only the five weights used).

## Checks

```
npm --prefix apps/mobile run typecheck     # tsc --noEmit (app + the shared core/theme sources)
npm --prefix apps/mobile test              # node:test: oklch→hex, secure-store refresh adapter, punch payload, dates
cd apps/mobile && npx expo export --platform android   # the whole JS bundle builds
cd apps/mobile && npx expo-doctor
```

## Layout

```
src/app/_layout.tsx            providers, fonts, sign-in gate, "Cannot reach FreeFounders" screen
src/app/index.tsx              / → Attendance or sign-in
src/app/(auth)/sign-in.tsx     sign-in
src/app/(tabs)/                attendance · leave · holidays · more (bottom tabs)
src/app/leave-apply.tsx        apply for leave (modal)
src/features/attendance/       punch card, punch flow (use-punch), selfie camera, month calendar
src/features/leave/            balances + my requests
src/components/ui.tsx          Text, Card, Button (≥ 48 dp), Pill, Notice, Skeleton, ErrorState, Field…
src/lib/                       core wiring, API address, theme, punch rules + payload, location, dates, colours
test/                          unit tests (node --test)
```

Not yet: Home, Tasks, Assets, push notifications, documents on leave, a staging server, EAS builds (see PLAN.md §19.16).
