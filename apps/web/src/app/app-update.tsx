import { isOlderVersion, useAppVersionInfo } from '@freefounders/core';
import { Download } from '@/components/icons';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { appInfo, isInApp } from '@/lib/native-bridge';

const LATER = 'ff-app-update-later';

/**
 * Inside the phone app only: an app older than the server's minimum (GET /api/platform/app-version, PLAN.md §19.30;
 * original app 0980b4d) asks once per session to update. The app is a shell around this web app, so almost everything
 * reaches it by itself; a few things need a newer shell (voice needs 1.1.0). "Update now" opens the APK in the phone's
 * browser (a link in a new window always leaves the app), which downloads it and installs it over the old app.
 */
export function AppUpdatePrompt() {
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
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update the app — one time</DialogTitle>
          <DialogDescription>
            A new version of the Kaampilot app is ready (you have {version}). It adds <strong>punch-in reminders</strong> (the phone rings or vibrates if you forget to punch in) and{' '}
            <strong>voice tasks</strong> (speak a task and the form fills itself).
            After this update, changes keep arriving on their own.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Tap <strong className="text-foreground">Update now</strong>: your phone&rsquo;s browser opens and downloads it.</li>
          <li>Open the download and tap <strong className="text-foreground">Update</strong>. If the phone asks, allow &ldquo;install unknown apps&rdquo; for the browser.</li>
          <li>Open Kaampilot again: you stay signed in.</li>
        </ol>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Later
          </Button>
          <Button asChild>
            <a href={info.apkUrl.startsWith('/') ? `${window.location.origin}${info.apkUrl}` : info.apkUrl} target="_blank" rel="noreferrer" onClick={() => setTimeout(close, 500)}>
              <Download /> Update now
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
