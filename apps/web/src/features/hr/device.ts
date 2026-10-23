/**
 * The phone's camera and location for the punch (PLAN.md §16.4, §19.18). Punch = office location (when the company
 * checks it) + a selfie stored with the punch (when the company asks for one). There is no face matching.
 */
import { appRequest, isInApp } from '@/lib/native-bridge';

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** A still from the camera as a JPEG data URL, at most 640 px wide (PLAN.md §16.4). */
export function grabPhoto(video: HTMLVideoElement): string {
  const scale = Math.min(1, 640 / (video.videoWidth || 640));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((video.videoWidth || 640) * scale);
  canvas.height = Math.round((video.videoHeight || 480) * scale);
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}

/**
 * The phone's position, or {} when it is denied/unavailable (the server then decides). Inside the Kaampilot phone app
 * the app's GPS is used (a WebView only allows the browser's geolocation on https); with `required`, the app's reason
 * (location blocked, GPS off, no fix in 10 s) is thrown instead of returning {}.
 */
export async function currentPosition(options: { required?: boolean } = {}): Promise<{ latitude?: number; longitude?: number }> {
  if (isInApp()) {
    try {
      const p = await appRequest<{ latitude: number; longitude: number }>('location');
      return { latitude: p.latitude, longitude: p.longitude };
    } catch (e) {
      if (options.required) throw e;
      return {};
    }
  }
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      (e) => {
        // Location is needed (office geofence) and the browser refused: say how to allow it.
        if (options.required && e.code === e.PERMISSION_DENIED) reject(new LocationBlockedError());
        else resolve({});
      },
      { timeout: 8000, enableHighAccuracy: true },
    );
  });
}

/** The browser blocked location for this site while the company checks the office location. */
export class LocationBlockedError extends Error {
  constructor() {
    super('Your browser is blocking location for this site, and your company checks that you are at the office. Tap "Allow location"; if nothing pops up, click the lock icon next to the address → Location → Allow, then try again.');
    this.name = 'LocationBlockedError';
  }
}
