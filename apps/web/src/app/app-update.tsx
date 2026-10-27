import { isOlderVersion, useAppVersionInfo } from '@kaampilot/core';
import { Download, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { useState } from 'react';
import { appInfo, isInApp } from '@/lib/native-bridge';

const LATER = 'ff-app-update-later';
/** "Later" on the pop-up: hidden for 24 hours (the banner stays). */
const POPUP_LATER = 'ff-app-update-popup-later';
const DAY_MS = 24 * 60 * 60_000;

function popupSnoozed(): boolean {
  try {
    const until = Number(localStorage.getItem(POPUP_LATER) || 0);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

/** The update the phone app needs, or null (in a browser, an up-to-date app, or MOBILE_MIN_VERSION off). */
function useNeededUpdate() {
  const inApp = isInApp();
  const info = useAppVersionInfo(inApp).data;
  const version = appInfo()?.version;
  if (!inApp || !info?.apkUrl || !isOlderVersion(version, info.minVersion)) return null;
  // Absolute, so the phone's browser (which gets a new window) can download it.
  const href = info.apkUrl.startsWith('/') ? `${window.location.origin}${info.apkUrl}` : info.apkUrl;
  return { version, href };
}

/**
 * Inside the phone app only (PLAN.md §19.30, §19.40): an app older than the server's MOBILE_MIN_VERSION (GET
 * /api/platform/app-version; off unless set) shows a non-blocking banner under the header, "A new version of Kaampilot
 * is available", with the download link. The app is a shell around this web app, so almost everything reaches it by
 * itself; only a few things need a newer shell. The link opens in the phone's browser (a new window always leaves the
 * app, in every shell since 1.0.0), which downloads the APK. Hidden for the session with ×.
 */
export function AppUpdateBanner() {
  const update = useNeededUpdate();
  const [later, setLater] = useState(() => {
    try {
      return sessionStorage.getItem(LATER) === '1';
    } catch {
      return false;
    }
  });
  if (!update || later) return null;
  const close = () => {
    try {
      sessionStorage.setItem(LATER, '1');
    } catch {
      /* private mode */
    }
    setLater(true);
  };
  return (
    <div role="status" className="flex items-center gap-2 border-b border-primary/20 bg-primary/8 px-3 py-1.5 text-[13px] text-foreground lg:px-6">
      <Download className="size-4 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1">
        A new version of Kaampilot is available{update.version ? ` (you have ${update.version})` : ''}.{' '}
        <a href={update.href} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
          Download the update
        </a>
      </p>
      <button type="button" onClick={close} aria-label="Hide the update message" className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none">
        <X className="size-4" />
      </button>
    </div>
  );
}

/**
 * The same update as a pop-up when the app opens (2026-10-27: the Android id changed to com.kaampilot.app in 1.3.0,
 * so the new APK installs as a second app and the old one must be removed by hand). "Download update" is a link with
 * a new window: every shell (1.0.0 to 1.2.x) hands a new window to the phone's browser, which downloads the APK.
 * The address is shown too, to copy if nothing opens. "Later" hides the pop-up for 24 hours; the banner stays.
 */
export function AppUpdateDialog() {
  const update = useNeededUpdate();
  const [later, setLater] = useState(popupSnoozed);
  if (!update) return null;
  const snooze = () => {
    try {
      localStorage.setItem(POPUP_LATER, String(Date.now() + DAY_MS));
    } catch {
      /* private mode: hidden until the app is opened again */
    }
    setLater(true);
  };
  return (
    <Dialog open={!later} onOpenChange={(open) => !open && snooze()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update Kaampilot</DialogTitle>
          <DialogDescription>A new version of the Kaampilot app is available. Install it, then uninstall this old app.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-sm">
          <p>After installing, sign in again and allow location and camera.</p>
          <p className="text-muted-foreground">
            If the download does not start, copy this address into your browser:{' '}
            <span className="font-medium break-all text-foreground select-all">{update.href}</span>
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={snooze}>
            Later
          </Button>
          <Button asChild allowReadOnly>
            <a href={update.href} target="_blank" rel="noreferrer">
              <Download aria-hidden />
              Download update
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
