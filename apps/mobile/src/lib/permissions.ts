/**
 * Asked once when the app opens (founder, 2026-10-13): location and camera, with Android's own "Allow / Don't allow"
 * pop-ups, so the punch later just works. Only what has not been decided yet is asked; a "Don't allow" is respected
 * (the punch then explains and offers "Allow location" / the phone's Settings). Returns the camera answer.
 */
import { Camera } from 'expo-camera';
import * as Location from 'expo-location';

export async function askPermissionsAtStart(): Promise<{ granted: boolean; canAskAgain: boolean } | null> {
  const loc = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (loc && !loc.granted && loc.canAskAgain) await Location.requestForegroundPermissionsAsync().catch(() => null);
  let cam = await Camera.getCameraPermissionsAsync().catch(() => null);
  if (cam && !cam.granted && cam.canAskAgain) cam = (await Camera.requestCameraPermissionsAsync().catch(() => null)) ?? cam;
  return cam;
}
