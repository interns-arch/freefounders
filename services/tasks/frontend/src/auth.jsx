import { createContext, useContext, useEffect, useState } from 'react'
import { api, login as apiLogin, logout as apiLogout, setUnauthorizedHandler, tokens } from './api'
import { PLATFORM } from './platform'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

// A capability belongs to a module the company can switch off (PLAN.md §16.2); then it counts as missing,
// so every screen that checks it hides that part without knowing about modules.
const CAP_MODULE = [['leads.', 'leads'], ['quotations.', 'leads'], ['intake.', 'intake']]
const moduleOfCap = (cap) => CAP_MODULE.find(([prefix]) => cap.startsWith(prefix))?.[1]

/* The company's brand colour (FreeFounders Settings Center) replaces the app's accent colour. */
function applyBrand(brand) {
  const root = document.documentElement.style
  if (brand?.colour) {
    root.setProperty('--accent', brand.colour)
    root.setProperty('--accent-2', brand.colour)
    root.setProperty('--accent-soft', `color-mix(in srgb, ${brand.colour} 12%, white)`)
  } else {
    ['--accent', '--accent-2', '--accent-soft'].forEach((p) => root.removeProperty(p))
  }
  if (brand?.short_name) document.title = `${brand.short_name} · Tasks`
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null))
    // Single login: no token in memory yet on a fresh page; the first call fetches one.
    if (!PLATFORM && !tokens.access) { setReady(true); return }
    api('/api/auth/me')
      .then(setUser)
      .catch(() => {})
      .finally(() => setReady(true))
  }, [])

  useEffect(() => { applyBrand(user?.brand) }, [user?.brand])

  const module = (key) => user?.modules?.[key] !== false
  const value = {
    user,
    ready,
    /** Is this part of the app switched on for the company? (Standalone: always.) */
    module,
    brand: user?.brand || null,
    can: (capability) => !!user?.capabilities?.includes(capability) && module(moduleOfCap(capability)),
    async login(username, password) {
      const me = await apiLogin(username, password)
      setUser(me)
      return me
    },
    async logout() {
      await apiLogout()
      setUser(null)
    },
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
