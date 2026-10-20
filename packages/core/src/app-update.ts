/**
 * The phone app's update prompt (PLAN.md §19.30, original app 0980b4d). The app is the web app in a native shell, so
 * almost every change reaches it by itself; a few need a newer shell (voice needs 1.1.0, which can ask Android for the
 * microphone). GET /api/platform/app-version says which version is needed and where the APK is.
 */
import { useQuery } from '@tanstack/react-query';
import { platformApi } from './http';

export { isOlderVersion } from './app-version';

export interface AppVersionInfo {
  /** The oldest app that has everything the web app uses; null = no prompt. */
  minVersion: string | null;
  /** Where "Update now" goes (opened in the phone's browser, which downloads and installs it). */
  apkUrl: string;
}

/** GET /api/platform/app-version (public); asked only inside the phone app. */
export function useAppVersionInfo(enabled: boolean) {
  return useQuery({
    queryKey: ['platform', 'app-version'],
    queryFn: () => platformApi.get<AppVersionInfo>('/app-version'),
    enabled,
    staleTime: 60 * 60_000,
    retry: false,
  });
}
