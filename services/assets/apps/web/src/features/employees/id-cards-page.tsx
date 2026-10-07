import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { LocalQrWarning, QRCode, useQrLinks } from '@/components/common/codes';
import { EmptyState, ErrorState, PageHeader, PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { EmployeeDetail } from '@/lib/types';

/** Printable ID cards: one QR per person. Scanning a card opens that person and their assets. */
export default function IdCardsPage() {
  const [params] = useSearchParams();
  const links = useQrLinks();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean).slice(0, 200);
  const q = useQuery({
    queryKey: ['id-cards', ids],
    queryFn: () => Promise.all(ids.map((id) => api.get<EmployeeDetail>(`/employees/${id}`))),
    enabled: ids.length > 0,
  });

  if (!ids.length)
    return (
      <EmptyState
        title="No people selected"
        description="Select people in the employee list and choose “Print ID cards”."
        action={
          <Button asChild variant="outline">
            <Link to="/employees">Go to employees</Link>
          </Button>
        }
      />
    );
  if (q.isLoading || !links.ready) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const people = q.data ?? [];

  return (
    <div className="print-sheet">
      <div className="no-print">
        <Link to="/employees" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Employees
        </Link>
        <PageHeader
          title="ID cards"
          description={`${people.length} card${people.length === 1 ? '' : 's'}. Scanning a card shows everything assigned to that person.`}
          actions={
            <Button onClick={() => window.print()}>
              <Printer /> Print
            </Button>
          }
        />
        <LocalQrWarning className="mb-4" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-4">
        {people.map((p) => (
          <div key={p.id} className="flex break-inside-avoid flex-col items-center rounded-xl border border-zinc-300 bg-white px-3 pt-3 pb-4 text-center text-black">
            <p className="w-full truncate text-[9px] font-semibold tracking-wider text-zinc-500 uppercase">{p.companyName ?? 'Employee ID'}</p>
            <QRCode value={links.person(p.employeeCode)} size={112} className="my-2" />
            <p className="w-full truncate text-sm leading-tight font-bold">{p.fullName}</p>
            <p className="font-mono text-xs font-semibold">{p.employeeCode}</p>
            <p className="mt-0.5 w-full truncate text-[11px] text-zinc-600">{[p.designation, p.departmentName].filter(Boolean).join(' · ')}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
