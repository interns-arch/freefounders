import { isOlderVersion, useAppVersionInfo } from '@kaampilot/core';
import { Download, X } from '@/components/icons';
import { useState } from 'react';
import { appInfo, isInApp } from '@/lib/native-bridge';

const LATER = 'ff-app-update-later';

/**
 * Inside the phone app only (PLAN.md §19.30, §19.40): an app older than the server's MOBILE_MIN_VERSION (GET
 * /api/platform/app-version; off unless set) shows a non-blocking banner under the header, "A new version of Kaampilot
 * is available", with the download link. The app is a shell around this web app, so almost everything reaches it by
 * itself; only a few things need a newer shell. The link opens in the phone's browser (a new window always leaves the
 * app), which downloads the APK and installs it over the old app. Hidden for the session with ×.
 */
export function AppUpdateBanner() {
  const inApp = isInApp();
  const info = useAppVersionInfo(inApp).data;
  const [later, setLater] = useState(() => {
    try {
      return sessionStorage.getItem(LATER) === '1';
    } catch {
      return false;
    }
  });
  const version = appInfo()?.version;
  if (!inApp || later || !info?.apkUrl || !isOlderVersion(version, info.minVersion)) return null;
  const close = () => {
    try {
      sessionStorage.setItem(LATER, '1');
    } catch {
      /* private mode */
    }
    setLater(true);
  };
  const href = info.apkUrl.startsWith('/') ? `${window.location.origin}${info.apkUrl}` : info.apkUrl;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-primary/20 bg-primary/8 px-3 py-1.5 text-[13px] text-foreground lg:px-6">
      <Download className="size-4 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1">
        A new version of Kaampilot is available{version ? ` (you have ${version})` : ''}.{' '}
        <a href={href} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
          Download the update
        </a>
      </p>
      <button type="button" onClick={close} aria-label="Hide the update message" className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none">
        <X className="size-4" />
      </button>
    </div>
  );
}
