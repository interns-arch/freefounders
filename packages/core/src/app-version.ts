/** Version comparison for the phone app update prompt (no imports, so plain Node tests can load it). */
/** "1.0.0" < "1.1.0" < "1.10.0"; missing parts count as 0. */
export function isOlderVersion(current: string | null | undefined, minimum: string | null | undefined): boolean {
  // no version (a browser), no minimum (prompt off), or not a plain version (a test or development build): never asks
  if (!current || !minimum || !/^\d+(\.\d+)*$/.test(current.trim())) return false;
  const parts = (v: string) => v.trim().split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(current);
  const b = parts(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
