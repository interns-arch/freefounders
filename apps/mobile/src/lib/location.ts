/**
 * The phone's position for the web app (punch with an office geofence, "use my location" in HR settings): asks for the
 * permission on first use, high accuracy, 10 s at most, then a recent last-known fix. Errors are meant for the person.
 */
import * as Location from 'expo-location';
import { Platform } from 'react-native';

export type PositionResult =
  | { ok: true; latitude: number; longitude: number; accuracy: number | null }
  | { ok: false; message: string; openSettings?: boolean; permission?: boolean };

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function currentPosition(): Promise<PositionResult> {
  let perm = await Location.getForegroundPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) {
    return perm.canAskAgain
      ? { ok: false, message: 'Kaampilot needs your location (your company checks that you are at the office). Tap "Allow location" and choose "Allow".', permission: true }
      : {
          ok: false,
          message: 'Location is blocked for this app. Open the phone’s Settings → Apps → Kaampilot (or Expo Go) → Permissions → Location, choose "Allow only while using the app", then try again.',
          openSettings: true,
          permission: true,
        };
  }
  if (!(await Location.hasServicesEnabledAsync())) {
    // Android's own "Turn on location?" pop-up (OK / No thanks), as other apps show; nothing happens on iOS.
    if (Platform.OS === 'android') await Location.enableNetworkProviderAsync().catch(() => {});
    if (!(await Location.hasServicesEnabledAsync())) {
      return {
        ok: false,
        message: 'Location (GPS) is off on this phone. Tap "Allow location" and choose OK, or swipe down from the top of the screen and turn on Location.',
        permission: true,
      };
    }
  }
  try {
    const p = await timeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 10_000);
    return { ok: true, latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy ?? null };
  } catch {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000, requiredAccuracy: 200 }).catch(() => null);
    if (last) return { ok: true, latitude: last.coords.latitude, longitude: last.coords.longitude, accuracy: last.coords.accuracy ?? null };
    return { ok: false, message: 'Could not find your location in 10 seconds. Move near a window or outside, check that Location is on, and try again.' };
  }
}
