import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Barcode, LocalQrWarning, QRCode, useQrLinks } from '@/components/common/codes';
import { EmptyState, ErrorState, PageHeader, PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import type { AssetListResponse } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Printable QR + barcode labels for one or many assets. */
export default function LabelsPage() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const [size, setSize] = useState<'sm' | 'md'>('md');
  const links = useQrLinks();
  const q = useQuery({
    queryKey: ['assets', 'labels', ids],
    queryFn: () => api.get<AssetListResponse>('/assets', { ids: ids.join(','), pageSize: 200, sort: 'assetTag', dir: 'asc' }),
    enabled: ids.length > 0,
  });

  if (!ids.length) return <EmptyState title="No assets selected" description="Select assets in the list and choose “Print labels”." action={<Button asChild variant="outline"><Link to="/assets">Go to assets</Link></Button>} />;
  if (q.isLoading || !links.ready) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data?.items ?? [];

  return (
    <div className="print-sheet">
      <div className="no-print">
        <Link to="/assets" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Assets
        </Link>
        <PageHeader
          title="Asset labels"
          description={`${items.length} label${items.length === 1 ? '' : 's'} ready to print. Stick them on the assets — scanning opens the asset page.`}
          actions={
            <>
              <NativeSelect className="w-auto" value={size} onChange={(e) => setSize(e.target.value as 'sm' | 'md')}>
                <option value="md">Standard (3 per row)</option>
                <option value="sm">Small (4 per row)</option>
              </NativeSelect>
              <Button onClick={() => window.print()}>
                <Printer /> Print
              </Button>
            </>
          }
        />
        <LocalQrWarning className="mb-4" />
      </div>
      <div className={cn('grid gap-3', size === 'md' ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-3 sm:grid-cols-4')}>
        {items.map((a) => (
          <div key={a.id} className="flex break-inside-avoid items-center gap-3 rounded-lg border border-zinc-300 bg-white p-3 text-black">
            <QRCode value={links.asset(a.qrCode)} size={size === 'md' ? 84 : 64} />
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Company property · {a.typeName}</p>
              <p className="truncate font-mono text-sm font-bold">{a.assetTag}</p>
              <p className="truncate text-[11px] text-zinc-700">{a.name}</p>
              <Barcode value={a.assetTag} height={size === 'md' ? 22 : 16} className="mt-1" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
