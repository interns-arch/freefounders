/**
 * The visitor's own pass (PLAN.md §22.9): /v/<company code>/p/<pass token>, sent by WhatsApp / email. No sign-in, any
 * phone browser. A big QR for the guard to scan coming in and going out; it refreshes so it shows "Inside" / "Left".
 */
import { usePublicPass } from '@kaampilot/core/visitors';
import { useEffect } from 'react';
import { useParams } from 'react-router';
import { CalendarClock, MapPin, ShieldCheck, UserRound } from '@/components/icons';
import { BrandLockup } from '@/components/brand';
import { QRCode } from '@/components/common/codes';
import { PageLoader } from '@/components/common/page';
import { Badge } from '@/components/ui/primitives';
import { STATUS_TONE, clock } from './parts';

const NOTE: Partial<Record<string, string>> = {
  expected: 'Show this QR to the guard at the gate.',
  waiting_host: 'You are at the gate: waiting for your host to let you in.',
  inside: 'You are checked in. Show this QR to the guard when you leave.',
  out: 'You have left. Thank you for visiting.',
  cancelled: 'This visit was cancelled. Please contact the person who invited you.',
  no_show: 'This pass has expired.',
};

export function PublicPassPage() {
  const { code = '', token = '' } = useParams();
  const q = usePublicPass(code, token);
  const p = q.data;
  const company = p?.company || 'Visitor pass';
  const usable = p && ['expected', 'waiting_host', 'inside'].includes(p.status);

  useEffect(() => {
    document.title = `${company} · Visitor pass`;
  }, [company]);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <span className="truncate text-[15px] font-semibold">{company}</span>
        <BrandLockup size={24} />
      </header>
      <main id="content" className="flex flex-1 justify-center px-4 py-6">
        <div className="w-full max-w-sm space-y-4">
          {q.isLoading ? (
            <PageLoader />
          ) : q.error || !p ? (
            <div role="alert" className="space-y-2 rounded-xl border bg-card p-6 text-center">
              <ShieldCheck className="mx-auto size-8 text-muted-foreground" aria-hidden />
              <h1 className="text-xl font-bold">This pass is not valid</h1>
              <p className="text-sm text-muted-foreground">Please ask the guard at the gate, or the person who invited you.</p>
            </div>
          ) : (
            <div className="space-y-4 rounded-xl border bg-card p-5 text-center" data-testid="visitor-pass">
              <div>
                <p className="text-[13px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">{p.kind === 'contractor' ? 'Contractor pass' : 'Visitor pass'}</p>
                <h1 className="mt-1 text-2xl font-bold">{p.name}</h1>
                {p.visitor_company && <p className="text-sm text-muted-foreground">{p.visitor_company}</p>}
              </div>
              <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{p.status_display}</Badge>
              {usable && (
                <div className="mx-auto w-fit rounded-lg bg-white p-3">
                  <QRCode value={p.qr} size={220} />
                </div>
              )}
              <p className="font-mono text-3xl font-bold tracking-wider" data-testid="pass-no">
                {p.pass_no}
              </p>
              <p className="text-sm">{p.kind === 'contractor' ? (usable ? 'Show this QR at the gate each time you come in and go out.' : 'This pass is not valid now.') : (NOTE[p.status] ?? '')}</p>
              {p.kind === 'contractor' && (p.permit_no || p.safety_note) && (
                <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-left text-[13px]">
                  {p.permit_no ? `Work permit ${p.permit_no}. ` : ''}
                  {p.safety_note ? `Safety: ${p.safety_note}` : ''}
                </p>
              )}
              <dl className="space-y-1.5 border-t pt-3 text-left text-sm">
                {p.host && (
                  <div className="flex items-center gap-2">
                    <UserRound className="size-4 text-muted-foreground" aria-hidden />
                    <dt className="sr-only">{p.kind === 'contractor' ? 'Supervisor' : 'To meet'}</dt>
                    <dd>
                      {p.kind === 'contractor' ? 'Supervisor' : 'To meet'} {p.host}
                    </dd>
                  </div>
                )}
                {p.window && (
                  <div className="flex items-center gap-2">
                    <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
                    <dt className="sr-only">When</dt>
                    <dd>{p.window}</dd>
                  </div>
                )}
                {p.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="size-4 text-muted-foreground" aria-hidden />
                    <dt className="sr-only">Gate</dt>
                    <dd>{p.location}</dd>
                  </div>
                )}
                {p.check_in_at && (
                  <p className="text-[13px] text-muted-foreground">
                    In {clock(p.check_in_at)}
                    {p.check_out_at ? ` · out ${clock(p.check_out_at)}` : ''}
                    {p.people > 1 ? ` · ${p.people} people` : ''}
                  </p>
                )}
              </dl>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
