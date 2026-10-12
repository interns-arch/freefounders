/**
 * The script the shell puts into every page before it loads (react-native-webview `injectedJavaScriptBeforeContentLoaded`).
 * It tells the web app it runs inside the FreeFounders app (`window.FreeFoundersApp`, read by
 * apps/web/src/lib/native-bridge.ts) and fills three gaps of Android's WebView:
 *   1. pull-to-refresh: reports whether the touched content is scrolled to the top (the shell only refreshes then);
 *   2. `navigator.geolocation.getCurrentPosition` answered by the app's GPS (a WebView refuses it on plain http);
 *   3. file pickers: the "Camera" choice needs the camera permission first, so the first pick asks for it, then opens.
 * Plain ES5 on purpose: it runs before the web app's own code.
 */
export type CameraState = 'ask' | 'granted' | 'denied';

export interface AppInfo {
  platform: 'android' | 'ios';
  version: string;
  camera: CameraState;
}

export function injectedScript(info: AppInfo): string {
  return `(function () {
  if (window.FreeFoundersApp) return;
  var info = ${JSON.stringify(info)};
  window.FreeFoundersApp = info;
  function post(m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} }

  function atTop(el) {
    if (document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]')) return false;
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) { if (n.scrollTop > 0) return false; }
    var root = document.scrollingElement || document.documentElement;
    return !root || root.scrollTop <= 0;
  }
  var lastTop = null;
  function report(v) { if (v !== lastTop) { lastTop = v; post({ type: 'scroll', atTop: v }); } }
  document.addEventListener('touchstart', function (e) { report(atTop(e.target)); }, { capture: true, passive: true });
  document.addEventListener('scroll', function (e) {
    var t = e.target && e.target.nodeType === 1 ? e.target : document.scrollingElement || document.documentElement;
    if (t && t.scrollTop > 0) report(false);
  }, { capture: true, passive: true });

  var waiting = {};
  var seq = 0;
  function onReply(e) {
    var d;
    try { d = JSON.parse(e.data); } catch (x) { return; }
    if (!d || typeof d.id !== 'string' || !waiting[d.id]) return;
    var cb = waiting[d.id];
    delete waiting[d.id];
    cb(d);
  }
  document.addEventListener('message', onReply);
  window.addEventListener('message', onReply);
  if (navigator.geolocation) {
    var getPos = function (ok, fail) {
      var id = 'g' + (++seq) + '-' + Date.now().toString(36);
      waiting[id] = function (d) {
        if (d.ok && d.data) {
          ok({ coords: { latitude: d.data.latitude, longitude: d.data.longitude, accuracy: d.data.accuracy || 0, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
        } else if (fail) {
          fail({ code: 2, message: d.error || 'Location unavailable', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
        }
      };
      post({ id: id, type: 'location' });
    };
    try { Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { value: getPos, configurable: true }); }
    catch (e) { try { navigator.geolocation.getCurrentPosition = getPos; } catch (x) {} }
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'INPUT' || t.type !== 'file' || info.camera !== 'ask') return;
    var accept = (t.getAttribute('accept') || '').toLowerCase();
    if (accept && accept.indexOf('image') < 0) return;
    e.preventDefault();
    info.camera = 'asking';
    window.__ffFileInput = t;
    post({ type: 'camera-for-files' });
  }, true);
  window.__ffCameraDecided = function (state) {
    info.camera = state;
    var t = window.__ffFileInput;
    window.__ffFileInput = null;
    if (t) { try { t.click(); } catch (e) {} }
  };
})();
true;`;
}
