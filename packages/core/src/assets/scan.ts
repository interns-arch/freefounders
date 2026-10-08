import { ApiError, assetsApi } from '../http';

export type ScanResult = { kind: 'asset' | 'person'; id: string; label: string; to: string };

/**
 * Resolves anything scanned or typed: an asset QR / tag / serial, or a person's ID-card QR,
 * which holds just their employee ID (e.g. CT000099). `to` is the web app path (/assets/…).
 */
export async function resolveCode(raw: string): Promise<ScanResult> {
  const code = raw.trim();
  const personUrl = /\/id\/[A-Za-z0-9_-]+\/?$/.test(code);
  if (!personUrl) {
    try {
      const a = await assetsApi.get<{ id: string; assetTag: string; name: string }>('/assets/lookup', { code });
      return { kind: 'asset', id: a.id, label: `${a.assetTag} · ${a.name}`, to: `/assets/assets/${a.id}` };
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
    }
  }
  try {
    const p = await assetsApi.get<{ id: string; fullName: string; employeeCode: string }>('/employees/lookup', { code });
    return { kind: 'person', id: p.id, label: `${p.fullName} (${p.employeeCode})`, to: `/assets/employees/${p.id}` };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) throw new ApiError(404, `Nothing matches "${code}"`);
    throw err;
  }
}
