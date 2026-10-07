// Minimal API client: JWT in localStorage, one automatic refresh-and-retry
// on 401, hard logout when the refresh token itself is dead.
// Under FreeFounders single login (platform.js) the token is the Platform's,
// held in memory, and renewing it asks the Platform instead.
import { PLATFORM, platformLogout, platformRefresh, platformToken, withBase } from './platform'

const store = {
  get access() { return PLATFORM ? platformToken() : localStorage.getItem('ct.access') },
  get refresh() { return localStorage.getItem('ct.refresh') },
  set(tokens) {
    if (tokens.access) localStorage.setItem('ct.access', tokens.access)
    if (tokens.refresh) localStorage.setItem('ct.refresh', tokens.refresh)
  },
  clear() { localStorage.removeItem('ct.access'); localStorage.removeItem('ct.refresh') },
}

export const tokens = store

async function rawRequest(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth && store.access) headers.Authorization = `Bearer ${store.access}`
  const res = await fetch(withBase(path), { method, headers, body: body ? JSON.stringify(body) : undefined })
  return res
}

let onUnauthorized = () => {}
export function setUnauthorizedHandler(fn) { onUnauthorized = fn }

/* Renew the session ONCE for everybody. Refresh tokens rotate and the old one
   is blacklisted the moment it is used, so when the 8-hour access token runs
   out and the dashboard fires ten requests at once, ten separate refreshes
   meant nine "token blacklisted" answers -- and a logout nobody asked for.
   Now they all wait on the same refresh. Resolves true when we hold a fresh
   access token, false only when the session is really gone. */
let refreshing = null
function renewSession() {
  if (PLATFORM) {
    if (!refreshing) refreshing = platformRefresh().finally(() => { setTimeout(() => { refreshing = null }, 0) })
    return refreshing
  }
  if (!refreshing) {
    const used = store.refresh
    refreshing = (async () => {
      const rr = await rawRequest('/api/auth/refresh', {
        method: 'POST', body: { refresh: used }, auth: false,
      })
      if (rr.ok) { store.set(await rr.json()); return true }
      // another tab may have rotated it a moment ago: use theirs
      return !!store.refresh && store.refresh !== used
    })().finally(() => { setTimeout(() => { refreshing = null }, 0) })
  }
  return refreshing
}

export async function api(path, opts = {}) {
  let res = await rawRequest(path, opts)
  if (res.status === 401 && (PLATFORM || store.refresh) && opts.auth !== false) {
    if (await renewSession()) {
      res = await rawRequest(path, opts)
    } else {
      store.clear()
      onUnauthorized()
      throw new ApiError(401, { detail: 'Session expired. Please sign in again.' })
    }
  }
  if (res.status === 204) return null
  let data = null
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, data)
  return data
}

export class ApiError extends Error {
  constructor(status, data) {
    super(errorText(data) || `HTTP ${status}`)
    this.status = status
    this.data = data
  }
}

export function errorText(data) {
  if (!data) return ''
  if (typeof data === 'string') return data
  if (data.detail) return data.detail
  // DRF field errors: {field: ["msg"]}
  return Object.entries(data)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : v}`)
    .join(' · ')
}

export async function apiUpload(path, formData) {
  const doSend = () => fetch(withBase(path), {
    method: 'POST',
    headers: store.access ? { Authorization: `Bearer ${store.access}` } : {},
    body: formData,
  })
  let res = await doSend()
  if (res.status === 401 && (PLATFORM || store.refresh) && await renewSession()) res = await doSend()
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data)
  return data
}

export async function login(username, password) {
  const res = await rawRequest('/api/auth/login', {
    method: 'POST', body: { username, password }, auth: false,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data)
  store.set(data)
  return api('/api/auth/me')
}

export async function logout() {
  if (PLATFORM) { await platformLogout(); return }
  try { await api('/api/auth/logout', { method: 'POST', body: { refresh: store.refresh } }) } catch { /* best effort */ }
  store.clear()
}
