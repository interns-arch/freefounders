// The script injected into every page (src/lib/injected.ts), run against a tiny fake page.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { injectedScript } from '../src/lib/injected.ts';

type Listener = (e: Record<string, unknown>) => void;

function fakePage(camera: 'ask' | 'granted' | 'denied' = 'granted') {
  const posted: Array<Record<string, unknown>> = [];
  const docListeners: Record<string, Listener[]> = {};
  const winListeners: Record<string, Listener[]> = {};
  const root = { scrollTop: 0, nodeType: 1, parentElement: null };
  const geolocation = { getCurrentPosition: () => assert.fail('the browser geolocation must not be used') };
  const window: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (m: string) => posted.push(JSON.parse(m)) },
    addEventListener: (t: string, f: Listener) => (winListeners[t] ??= []).push(f),
  };
  const document = {
    scrollingElement: root,
    documentElement: root,
    querySelector: () => null,
    addEventListener: (t: string, f: Listener) => (docListeners[t] ??= []).push(f),
  };
  const ctx = vm.createContext({ window, document, navigator: { geolocation }, JSON, Date });
  vm.runInContext(injectedScript({ platform: 'android', version: '0.1.0', camera }), ctx);
  const fire = (t: string, e: Record<string, unknown>) => (docListeners[t] ?? []).forEach((f) => f(e));
  return { window, posted, fire, geolocation, root };
}

test('the page learns it is inside the app', () => {
  const page = fakePage();
  assert.deepEqual(JSON.parse(JSON.stringify(page.window.FreeFoundersApp)), { platform: 'android', version: '0.1.0', camera: 'granted' });
});

test('pull-to-refresh: reports whether the touched content is at the top, only on change', () => {
  const page = fakePage();
  const list = { scrollTop: 0, nodeType: 1, parentElement: page.root };
  page.fire('touchstart', { target: list });
  page.fire('touchstart', { target: list });
  list.scrollTop = 120;
  page.fire('scroll', { target: list });
  page.fire('touchstart', { target: list });
  assert.deepEqual(page.posted, [
    { type: 'scroll', atTop: true },
    { type: 'scroll', atTop: false },
  ]);
});

test('geolocation is answered by the app', () => {
  const page = fakePage();
  const got: unknown[] = [];
  page.geolocation.getCurrentPosition(
    (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => got.push(p.coords),
    (e: { message: string }) => got.push(e.message),
  );
  const req = page.posted.at(-1)!;
  assert.equal(req.type, 'location');
  assert.match(String(req.id), /^g1-/);
  page.fire('message', { data: JSON.stringify({ id: req.id, ok: true, data: { latitude: 12.97, longitude: 77.59, accuracy: 8 } }) });
  assert.equal((got[0] as { latitude: number }).latitude, 12.97);
  page.geolocation.getCurrentPosition(
    () => assert.fail('should fail'),
    (e: { message: string }) => got.push(e.message),
  );
  const req2 = page.posted.at(-1)!;
  page.fire('message', { data: JSON.stringify({ id: req2.id, ok: false, error: 'Location (GPS) is off' }) });
  assert.equal(got[1], 'Location (GPS) is off');
  // Answers for the web app's own requests (other ids) are left alone.
  page.fire('message', { data: JSON.stringify({ id: 'r1-x', ok: true, data: null }) });
  assert.equal(got.length, 2);
});

test('file picker: asks for the camera first, then opens', () => {
  const page = fakePage('ask');
  let prevented = 0;
  let clicks = 0;
  const input = { tagName: 'INPUT', type: 'file', getAttribute: () => 'image/*', click: () => clicks++ };
  page.fire('click', { target: input, preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
  assert.deepEqual(page.posted.at(-1), { type: 'camera-for-files' });
  (page.window.__ffCameraDecided as (s: string) => void)('granted');
  assert.equal(clicks, 1);
  page.fire('click', { target: input, preventDefault: () => prevented++ });
  assert.equal(prevented, 1, 'once decided, the picker opens directly');
  // A picker for documents only does not need the camera.
  const other = fakePage('ask');
  other.fire('click', { target: { tagName: 'INPUT', type: 'file', getAttribute: () => '.pdf,.xlsx' }, preventDefault: () => assert.fail('not for documents') });
});
