import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPunchBody, FACE_CHECK_MESSAGE, fitWithin, jpegDataUrl, punchPlan } from '../src/lib/punch.ts';

test('face check on: the app does not punch and says why', () => {
  const plan = punchPlan({ face_enabled: true, geofence_enabled: true, photo: 'required' });
  assert.equal(plan.blocked, FACE_CHECK_MESSAGE);
  assert.match(FACE_CHECK_MESSAGE, /switch face check off in Attendance/);
});

test('geofence and photo modes', () => {
  assert.deepEqual(punchPlan({ face_enabled: false, geofence_enabled: false, photo: 'off' }), { blocked: null, needsLocation: false, photo: 'off' });
  assert.deepEqual(punchPlan({ face_enabled: false, geofence_enabled: true, photo: 'required' }), { blocked: null, needsLocation: true, photo: 'required' });
  assert.deepEqual(punchPlan({ face_enabled: false, geofence_enabled: false, photo: 'optional' }), { blocked: null, needsLocation: false, photo: 'optional' });
  assert.equal(punchPlan({ face_enabled: false, geofence_enabled: false, photo: undefined }).photo, 'off');
});

test('punch body: position + selfie, never a face descriptor', () => {
  const body = buildPunchBody({ position: { latitude: 12.971598712345, longitude: 77.594566398765 }, photoBase64: '/9j/AAA=' });
  assert.deepEqual(body, { latitude: 12.9715987, longitude: 77.5945664, photo: 'data:image/jpeg;base64,/9j/AAA=' });
  assert.equal('face_descriptor' in body, false);
});

test('punch body: nothing when there is no position or photo', () => {
  assert.deepEqual(buildPunchBody({}), {});
  assert.deepEqual(buildPunchBody({ position: null, photoBase64: null }), {});
  assert.deepEqual(buildPunchBody({ position: { latitude: Number.NaN, longitude: 1 } }), {});
  assert.deepEqual(buildPunchBody({ photoBase64: 'abc' }), { photo: 'data:image/jpeg;base64,abc' });
});

test('data URL: keeps one prefix and drops line breaks', () => {
  assert.equal(jpegDataUrl('data:image/jpeg;base64,AB\nCD'), 'data:image/jpeg;base64,ABCD');
  assert.equal(jpegDataUrl('ABCD'), 'data:image/jpeg;base64,ABCD');
});

test('photo size: longer side at most 720, never enlarged', () => {
  assert.deepEqual(fitWithin(3000, 4000), { width: 540, height: 720 });
  assert.deepEqual(fitWithin(1920, 1080), { width: 720, height: 405 });
  assert.deepEqual(fitWithin(480, 640), { width: 480, height: 640 });
});
