# Automation Task — mobile app

The Android app is a thin shell (Capacitor) that opens the live site
`https://partsexpressonline.com` (v2; v1 used http://52.66.83.8:7001, which still works). Every deploy of the website shows up in the app by
itself, so staff install the APK **once** and never download it again.

iPhone users: Safari → Share → **Add to Home Screen** (steps on `/install`).

## When do I need a new APK?
Only if the app shell itself changes: a new server address, a new app icon,
or new phone permissions. Website changes never need one.

## Build the APK (Windows)
Tools live in `C:\Users\OM\AppData\Local\apkbuild` (JDK 21, Android SDK,
Gradle 8.11.1). The **release signing key** is
`apkbuild\automation-task-release.jks`; its password is in
`mobile\android\keystore.properties` (not in git). **Back both up** — an
updated APK must be signed with the same key or phones refuse to install it
over the old one.

```bash
cd mobile
npm install
npx cap sync android
cd android
JAVA_HOME='C:\Users\OM\AppData\Local\apkbuild\jdk-21.0.12.1+1' \
ANDROID_HOME='C:\Users\OM\AppData\Local\apkbuild\sdk' \
C:/Users/OM/AppData/Local/apkbuild/gradle-8.11.1/bin/gradle.bat assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`. Bump
`versionCode` / `versionName` in `android/app/build.gradle` first.

To publish it, copy it to `frontend/public/downloads/automation-task.apk`
(git-ignored) and deploy the web app; it is offered at `/install`.

## Server address
Set in `capacitor.config.json` (`server.url`) and `www/*.html`. When the site
moves to an HTTPS domain, change all three, rebuild, and staff install the
new APK once.
