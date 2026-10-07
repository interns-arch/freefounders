/* Public page: get Automation Task on a phone.
   Android -> the APK (a thin shell that opens this same site, so every
   deploy reaches it without downloading the app again).
   iPhone  -> Safari "Add to Home Screen" (Apple does not allow APKs, and an
   App Store app needs a Mac + Apple developer account). */
const APK = '/downloads/automation-task.apk'

function platform() {
  const ua = navigator.userAgent || ''
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  return 'desktop'
}

export default function Install() {
  const os = platform()
  const inApp = /; wv\)/.test(navigator.userAgent)          // already inside the Android app
  const android = (
    <div className={'install-card' + (os === 'android' ? ' first' : '')} key="android">
      <div className="install-os">🤖 Android</div>
      {inApp
        ? <p className="ok-note">You're already using the app. It updates itself — nothing to download.</p>
        : <a className="btn btn-primary install-btn" href={APK} download>Download the app (APK)</a>}
      <ol className="install-steps">
        <li>Tap <strong>Download the app</strong> above.</li>
        <li>Open the downloaded file <code>automation-task.apk</code>.</li>
        <li>If the phone asks, tap <strong>Settings → Allow from this source</strong>, then go back and tap <strong>Install</strong>.</li>
        <li>Open <strong>Automation Task</strong> from your home screen and log in.</li>
      </ol>
      <p className="install-note">Install it <strong>once</strong>. Every update we make shows up in the app by itself — you never download it again.</p>
    </div>
  )
  const ios = (
    <div className={'install-card' + (os === 'ios' ? ' first' : '')} key="ios">
      <div className="install-os"> iPhone / iPad</div>
      <ol className="install-steps">
        <li>Open <strong>this page in Safari</strong> (not Chrome or WhatsApp's browser).</li>
        <li>Tap the <strong>Share</strong> button <span className="share-ico">⬆︎</span> at the bottom of the screen.</li>
        <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
        <li>Open <strong>Automation Task</strong> from your home screen and log in.</li>
      </ol>
      <p className="install-note">It opens full-screen like an app and always shows the latest version — nothing to update.</p>
    </div>
  )
  return (
    <div className="public-wrap">
      <div className="public-card install-wrap">
        <div className="brand">
          <img src="/logo.png" alt="CarTrends"
            style={{ height: 34, width: 'auto', background: '#fff', borderRadius: 7, padding: '3px 6px' }} />
          <div>Automation Task<small>Get the app</small></div>
        </div>
        {os === 'ios' ? [ios, android] : [android, ios]}
        <p className="install-foot"><a href="/login">← Back to login</a></p>
      </div>
    </div>
  )
}
