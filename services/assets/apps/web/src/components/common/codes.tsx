import JsBarcode from 'jsbarcode';
import QRCodeLib from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { useAppConfig } from '@/lib/config';
import { cn } from '@/lib/utils';

/**
 * QR codes are links, so any scanner (a phone's own camera included) opens the right page.
 * A person's QR is built only from their employee ID: <base>/id/CT000099.
 * The base is the server's public/LAN address, because a phone can't open "localhost".
 */
export function useQrLinks() {
  const q = useAppConfig();
  const base = q.data?.publicUrl || window.location.origin;
  const host = new URL(base).hostname;
  return {
    ready: !q.isLoading,
    base,
    /** True when phones won't be able to open these links. */
    localOnly: host === 'localhost' || host === '127.0.0.1' || host === '[::1]',
    person: (employeeCode: string) => `${base}/id/${encodeURIComponent(employeeCode)}`,
    asset: (qrCode: string) => `${base}/scan/${qrCode}`,
  };
}

export function LocalQrWarning({ className }: { className?: string }) {
  const links = useQrLinks();
  if (!links.ready || !links.localOnly) return null;
  return (
    <p className={cn('rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200', className)}>
      These QR codes point to <span className="font-mono">{links.base}</span>, which a phone can’t open. Start the app with <span className="font-mono">npm run dev</span> (it
      uses this PC’s Wi-Fi address) or set <span className="font-mono">PUBLIC_URL</span> to the server’s address, then print again.
    </p>
  );
}


export function QRCode({ value, size = 128, className }: { value: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCodeLib.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: 'M' })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return src ? (
    <img src={src} width={size} height={size} alt="QR code" className={cn('rounded bg-white', className)} />
  ) : (
    <div style={{ width: size, height: size }} className={cn('animate-pulse rounded bg-muted', className)} />
  );
}

export function Barcode({ value, height = 36, className }: { value: string; height?: number; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, { format: 'CODE128', height, displayValue: false, margin: 0, width: 1.4, background: 'transparent' });
    } catch {
      /* invalid value: leave empty */
    }
  }, [value, height]);
  return <svg ref={ref} className={cn('max-w-full', className)} />;
}
