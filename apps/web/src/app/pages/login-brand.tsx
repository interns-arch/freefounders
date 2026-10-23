/**
 * The front page's story (PLAN.md §19.35): what Kaampilot is, for whom, and a small live-looking preview of the app,
 * drawn with HTML and theme tokens (no screenshots, no images: it loads with the page). Desktop: the left panel next to
 * the sign-in form. Phones: `BrandHeader` above the form (the form stays above the fold), `BrandFooter` under it.
 * Motion: the preview cards rise in once; `motion-safe` + lite mode (index.css) switch that off.
 */
import { Check, IndianRupee, ListChecks, MapPin, Package, ShieldCheck, Smartphone, Flag, ArrowRight } from '@/components/icons';
import { Link } from 'react-router';
import { BrandLockup } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const BENEFITS = [
  { icon: MapPin, title: 'Selfie + GPS punch', text: 'Only at the office, with a photo' },
  { icon: ListChecks, title: 'Tasks with approvals', text: 'Checklists, reminders, sign-offs' },
  { icon: Package, title: 'Assets, joiners, exits', text: 'Who has which laptop, always' },
  { icon: IndianRupee, title: 'Payroll from attendance', text: 'Payslips without spreadsheets' },
];

const TRUST = [
  { icon: Flag, text: 'Made in India' },
  { icon: ShieldCheck, text: 'Data stays in India' },
  { icon: Smartphone, text: 'Works on low-end Android' },
];

/** Phones and tablets: the lockup and one line, above the form. */
export function BrandHeader() {
  return (
    <header className="mb-5 flex flex-col items-center gap-2 text-center lg:hidden">
      <BrandLockup size={32} domain />
      <p className="text-sm text-muted-foreground">Attendance, tasks, assets and payroll. One app for your whole team.</p>
    </header>
  );
}

function TrustLine({ className }: { className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground', className)}>
      {TRUST.map((t) => (
        <li key={t.text} className="inline-flex items-center gap-1.5">
          <t.icon className="size-3.5 text-primary" />
          {t.text}
        </li>
      ))}
    </ul>
  );
}

function Benefits({ className }: { className?: string }) {
  return (
    <ul className={className}>
      {BENEFITS.map((b) => (
        <li key={b.title} className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
            <b.icon className="size-[18px]" />
          </span>
          <span className="min-w-0 leading-snug">
            <span className="block text-[15px] font-semibold">{b.title}</span>
            <span className="block text-[13px] text-muted-foreground">{b.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Phones and tablets, under the form: what Kaampilot does and the trust line (the desktop panel's content, short). */
export function BrandFooter() {
  return (
    <section aria-label="What Kaampilot does" className="mt-8 space-y-5 border-t pt-6 lg:hidden">
      <Benefits className="grid gap-4 sm:grid-cols-2" />
      <TrustLine className="justify-center" />
    </section>
  );
}

/** Desktop: the left panel. */
export function BrandPanel() {
  return (
    <aside className="hidden min-h-dvh flex-col gap-9 border-r bg-card px-12 py-10 lg:flex xl:px-16" aria-labelledby="brand-title">
      <BrandLockup size={36} domain />
      <div className="max-w-xl space-y-4">
        <p className="inline-flex items-center gap-2 rounded-sm border border-primary/25 bg-accent px-2.5 py-1 font-mono text-[11px] font-semibold tracking-widest text-accent-foreground uppercase">
          For Indian SMEs · 5 to 500 people
        </p>
        <h2 id="brand-title" className="text-[2.6rem] leading-[1.08] font-extrabold tracking-tight text-balance xl:text-[2.9rem]">
          Your team’s <span className="text-primary">kaam</span>, on autopilot.
        </h2>
        <p className="max-w-lg text-[17px] leading-relaxed text-muted-foreground">
          Attendance with selfie and GPS, tasks with approvals, assets and payroll. One app and one login for everyone in your company.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
          <Button variant="cta" size="lg" asChild>
            <Link to="/signup">
              Start free <ArrowRight className="size-4" />
            </Link>
          </Button>
          <span className="text-sm text-muted-foreground">Set up your company in a few minutes.</span>
        </div>
      </div>
      <ProductPreview />
      <Benefits className="grid max-w-xl grid-cols-2 gap-x-6 gap-y-4" />
      <div className="mt-auto max-w-xl border-t pt-5">
        <TrustLine />
      </div>
    </aside>
  );
}

const rise = 'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-both motion-safe:duration-700';

/** A small picture of the app: today's punch card and the task list (decorative; screen readers skip it). */
function ProductPreview() {
  return (
    <div aria-hidden className="relative h-[226px] max-w-xl rounded-xl border bg-secondary/60 select-none">
      {/* Today */}
      <div className={cn('absolute top-5 left-5 w-[250px] rounded-xl border bg-card p-4 shadow-card', rise)}>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10.5px] font-semibold tracking-widest text-muted-foreground uppercase">Today · Thu</span>
          <span className="rounded-sm bg-success/12 px-1.5 py-0.5 text-[11px] font-semibold text-success">On time</span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-[30px] leading-none font-extrabold tracking-tight tabular-nums">09:12</span>
          <span className="text-[13px] font-medium text-muted-foreground">punched in</span>
        </div>
        <div className="mt-3 flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-app-attendance/15 text-[12px] font-bold text-app-attendance">PS</span>
          <span className="min-w-0 leading-tight">
            <span className="block text-[13px] font-semibold">Priya Sharma</span>
            <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
              <MapPin className="size-3" /> Andheri office · 38 m
            </span>
          </span>
        </div>
        <div className="mt-3 grid h-8 place-items-center rounded-md bg-cta text-[13px] font-semibold text-cta-foreground">Punch out</div>
      </div>
      {/* Tasks */}
      <div className={cn('absolute top-[64px] right-5 left-[250px] min-w-[220px] rounded-xl border bg-card p-4 shadow-card-lg motion-safe:delay-150', rise)}>
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[13px] font-bold">My tasks</span>
          <span className="text-[11.5px] text-muted-foreground">3 due today</span>
        </div>
        <ul className="space-y-2 text-[12.5px]">
          <PreviewTask done text="Send GST invoices" />
          <PreviewTask text="Approve Rahul’s leave" tag="Approval" tone="bg-warning/12 text-warning" />
          <PreviewTask text="Laptop handover: Neha" tag="Assets" tone="bg-app-assets/12 text-app-assets" />
        </ul>
      </div>
    </div>
  );
}

function PreviewTask({ text, done = false, tag, tone }: { text: string; done?: boolean; tag?: string; tone?: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={cn('grid size-4 shrink-0 place-items-center rounded-sm border', done ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
        {done && <Check className="size-3" />}
      </span>
      <span className={cn('min-w-0 flex-1 truncate', done && 'text-muted-foreground line-through')}>{text}</span>
      {tag && <span className={cn('shrink-0 rounded-sm px-1.5 py-0.5 text-[10.5px] font-semibold', tone)}>{tag}</span>}
    </li>
  );
}
