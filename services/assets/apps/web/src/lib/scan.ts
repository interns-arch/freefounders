import { api, ApiError } from './api';

export type ScanResult = { kind: 'asset' | 'person'; id: string; label: string; to: string };

/**
 * Resolves anything scanned or typed: an asset QR / tag / serial, or a person's ID-card QR,
 * which holds just their employee ID (e.g. CT000099).
 */
export async function resolveCode(raw: string): Promise<ScanResult> {
  const code = raw.trim();
  const personUrl = /\/id\/[A-Za-z0-9_-]+\/?$/.test(code);
  if (!personUrl) {
    try {
      const a = await api.get<{ id: string; assetTag: string; name: string }>('/assets/lookup', { code });
      return { kind: 'asset', id: a.id, label: `${a.assetTag} · ${a.name}`, to: `/assets/${a.id}` };
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
    }
  }
  try {
    const p = await api.get<{ id: string; fullName: string; employeeCode: string }>('/employees/lookup', { code });
    return { kind: 'person', id: p.id, label: `${p.fullName} (${p.employeeCode})`, to: `/employees/${p.id}` };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) throw new ApiError(404, `Nothing matches "${code}"`);
    throw err;
  }
}
