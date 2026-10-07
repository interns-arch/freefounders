/* FreeFounders single login.

   Built with VITE_PLATFORM_LOGIN=true (and VITE_BASE=/tasks/) the app runs
   under /tasks/ on the shared FreeFounders address: sign-in happens once in
   the portal, and this app uses the Platform's short access token, kept in
   memory only and renewed from the Platform's httpOnly cookie. Built
   without it, nothing here is used and the app signs in on its own as
   before. */

export const PLATFORM = import.meta.env.VITE_PLATFORM_LOGIN === 'true'
export const BASE = import.meta.env.BASE_URL || '/'

/** '/api/x' -> '/tasks/api/x' under the shared address; unchanged otherwise. */
export const withBase = (path) => (path.startsWith('/') ? BASE + path.slice(1) : path)

const PLATFORM_AUTH = '/api/platform/auth'
let access = null

export const platformToken = () => access

async function platformPost(path) {
  return fetch(PLATFORM_AUTH + path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: '{}',
  })
}

/** A fresh access token from the Platform session cookie. False when signed out there. */
export async function platformRefresh() {
  try {
    const res = await platformPost('/refresh')
    if (!res.ok) { access = null; return false }
    access = (await res.json()).accessToken
    return true
  } catch { return false }
}

export async function platformLogout() {
  try { await platformPost('/logout') } catch { /* best effort */ }
  access = null
}

/** Off to the portal's sign-in; it sends the person back here afterwards. */
export function goToPortal() {
  const next = window.location.pathname + window.location.search
  window.location.assign(`/?next=${encodeURIComponent(next)}`)
}

/** Apps this person can open, read from the current token (no extra request). */
export function tokenApps() {
  if (!access) return []
  try {
    const payload = JSON.parse(atob(access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return Object.keys(payload.apps || {})
  } catch { return [] }
}

export const APP_LINKS = [
  { app: 'tasks', name: 'Tasks', href: '/tasks/' },
  { app: 'assets', name: 'Assets', href: '/assets/' },
]
