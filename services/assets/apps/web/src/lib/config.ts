import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './api';

export interface AppConfig {
  /** Address printed into QR codes (this PC's Wi-Fi address in dev, PUBLIC_URL in production). */
  publicUrl: string | null;
  /** The main company, shown on the login screen and sidebar. */
  companyName: string | null;
  /** FreeFounders Settings Center: the company's short name, colour and logo (null when standalone). */
  brand?: { shortName: string | null; colour: string | null; logoUrl: string | null } | null;
  /** Which switchable modules are on (null before sign-in in multi-company mode). */
  modules?: Record<string, boolean> | null;
}

/** On unless the company switched it off (PLAN.md §16.2). */
export function useModules() {
  const q = useAppConfig();
  return (key: string) => q.data?.modules?.[key] !== false;
}

/** The company's brand colour replaces the primary colour (light and dark). */
export function useBrandColour() {
  const colour = useAppConfig().data?.brand?.colour ?? null;
  useEffect(() => {
    const root = document.documentElement.style;
    if (colour) {
      root.setProperty('--primary', colour);
      root.setProperty('--ring', colour);
    } else {
      root.removeProperty('--primary');
      root.removeProperty('--ring');
    }
  }, [colour]);
}

export function useAppConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api.get<AppConfig>('/config'), staleTime: 5 * 60_000, placeholderData: undefined });
}

/** Tidy display name: "CARTREND AUTOPARTS PVT LTD" → "Cartrend Autoparts". */
export function shortCompanyName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.replace(/\b(pvt\.?|private|ltd\.?|limited|llp|inc\.?)\b/gi, '').replace(/\s+/g, ' ').trim();
  return trimmed.replace(/\w\S*/g, (w) => (w.length > 3 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w));
}

export function useCompanyName() {
  const q = useAppConfig();
  const full = q.data?.companyName ?? null;
  const brand = q.data?.brand ?? null;
  const short = brand?.shortName || shortCompanyName(full);
  useEffect(() => {
    document.title = short ? `${short} · ${brand ? 'Assets' : 'Asset Portal'}` : 'Asset Portal';
  }, [short, brand]);
  return { full, short, brand };
}
