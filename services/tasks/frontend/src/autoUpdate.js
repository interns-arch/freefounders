/* Reload onto a new deploy by itself.

   Every build writes its id into the code (__BUILD_ID__) and into
   /version.json. We look at /version.json when the app comes back to the
   screen and every 2 minutes; if it names a different build, a newer
   version is live and we reload -- straight away if the app is in the
   background or was just reopened, otherwise as soon as nobody is typing,
   so a half-filled form is never thrown away.

   Works the same with or without the service worker (HTTPS): page loads
   are network-first there and every asset name is unique per build, so a
   reload always lands on the newest version. */
const EVERY_MS = 2 * 60 * 1000

export function busy() {
  const el = document.activeElement
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return true
  return !!document.querySelector('.modal')          // a form or confirmation is open
}

import { withBase } from './platform'

async function latestBuild() {
  try {
    const res = await fetch(withBase(`/version.json?t=${Date.now()}`), { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()).build || null
  } catch { return null }                             // offline: try again later
}

export function startAutoUpdate() {
  if (typeof __BUILD_ID__ === 'undefined' || !import.meta.env.PROD) return
  let pending = null

  const reload = (build) => {
    // never loop: reload once per new build, even if a cache serves old code
    const key = 'autoUpdate.reloadedFor'
    try { if (sessionStorage.getItem(key) === build) return; sessionStorage.setItem(key, build) } catch { /* private mode */ }
    window.location.reload()
  }

  const check = async (justOpened = false) => {
    const build = pending || await latestBuild()
    if (!build || build === __BUILD_ID__) return
    pending = build
    if (document.hidden || justOpened || !busy()) reload(build)
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(true) })
  window.addEventListener('focus', () => check(true))
  setInterval(() => check(false), EVERY_MS)
  // the moment someone stops typing, a waiting update goes in
  document.addEventListener('focusout', () => { if (pending) setTimeout(() => check(false), 1500) })
  check(true)
}
