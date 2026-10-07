import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './api';

export interface AppConfig {
  /** Address printed into QR codes (this PC's Wi-Fi address in dev, PUBLIC_URL in production). */
  publicUrl: string | null;
  /** The main company, shown on the login screen and sidebar. */
  companyName: string | null;
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
  const short = shortCompanyName(full);
  useEffect(() => {
    document.title = short ? `${short} · Asset Portal` : 'Asset Portal';
  }, [short]);
  return { full, short };
}
