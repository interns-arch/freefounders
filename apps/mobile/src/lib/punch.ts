/**
 * Punch in / punch out: what the phone must do before it sends the punch, and the body it sends
 * (POST /tasks/api/attendance/check_in|check_out/). Every rule is decided again by the server; this only avoids
 * asking for things the company does not use. Founder (2026-10-12): the app never computes a face descriptor —
 * with face check on it says so and does not send the punch.
 */
export type PhotoMode = 'off' | 'optional' | 'required';
export type Which = 'check_in' | 'check_out';

export interface PunchRules {
  face_enabled: boolean;
  geofence_enabled: boolean;
  photo: PhotoMode | null | undefined;
}

export const FACE_CHECK_MESSAGE =
  'Face check is on for your company; the app punches with a selfie only — ask your admin to switch face check off in Attendance → HR settings.';

export interface PunchPlan {
  /** Why the app cannot punch (shown as-is), or null. */
  blocked: string | null;
  /** Ask for the GPS position first (the company has an office geofence). */
  needsLocation: boolean;
  /** Take a selfie: off, optional (can skip) or required. */
  photo: PhotoMode;
}

export function punchPlan(rules: PunchRules): PunchPlan {
  const photo: PhotoMode = rules.photo === 'optional' || rules.photo === 'required' ? rules.photo : 'off';
  if (rules.face_enabled) return { blocked: FACE_CHECK_MESSAGE, needsLocation: false, photo: 'off' };
  return { blocked: null, needsLocation: !!rules.geofence_enabled, photo };
}

/** A JPEG data URL from the camera's base64 (with or without a data: prefix already). */
export function jpegDataUrl(base64: string): string {
  const raw = base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  return `data:image/jpeg;base64,${raw}`;
}

export interface PunchBody {
  latitude?: number;
  longitude?: number;
  photo?: string;
}

/** The body of the punch: the position when known, the selfie when taken. Nothing else (never a face descriptor). */
export function buildPunchBody(input: { position?: { latitude: number; longitude: number } | null; photoBase64?: string | null }): PunchBody {
  const body: PunchBody = {};
  const p = input.position;
  if (p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
    body.latitude = Math.round(p.latitude * 1e7) / 1e7;
    body.longitude = Math.round(p.longitude * 1e7) / 1e7;
  }
  if (input.photoBase64) body.photo = jpegDataUrl(input.photoBase64);
  return body;
}

/** The size to shrink a photo to so its longer side is at most `max` px (never enlarges). */
export function fitWithin(width: number, height: number, max = 720): { width: number; height: number } {
  const long = Math.max(width, height);
  if (!long || long <= max) return { width, height };
  const k = max / long;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}
