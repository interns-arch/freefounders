/**
 * The open visitor sign-in (PLAN.md §22, V4 §22.11): /v/<company code>/<token>, reached by scanning the check-in QR.
 * No sign-in, works in any phone browser. The visitor fills a short form (whom to meet: names + departments only),
 * gets a 4-digit check-in code to show the guard, and the page follows the visit: approved → "You are checked in" and,
 * once the host answers, where to wait. The phone keeps a device secret so the check-out QR works on this phone only.
 */
import { ApiError, errorMessage } from '@kaampilot/core';
import { type PublicHostOption, type PublicVisitorInput, useDeviceState, usePublicHosts, usePublicVisitorForm, useSubmitPublicVisitor } from '@kaampilot/core/visitors';
import { type FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { CheckCircle2, Clock, MapPin, ShieldCheck, UserRound, X } from '@/components/icons';
import { Field } from '@/components/common/form';
import { PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/primitives';
import { PhotoField } from './parts';
import { BigCode, PublicCard, PublicShell, readDevice, saveDevice, until, usePublicBrand } from './public-parts';

type Picked = { id?: number; name?: string; department: string } | null;

export function PublicVisitorPage() {
  const { code = '', token = '' } = useParams();
  const form = usePublicVisitorForm(code, token);
  const submit = useSubmitPublicVisitor(code, token);
  const [f, setF] = useState<PublicVisitorInput>({ name: '', mobile: '', company: '', purpose: '', host_name: '', host: null, people: 1, vehicle_no: '', photo: null, consent: false, website: '' });
  const [picked, setPicked] = useState<Picked>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ code: string; expires_at: string | null } | null>(null);
  const [device, setDevice] = useState<string | null>(() => readDevice(code));
  const set = <K extends keyof PublicVisitorInput>(k: K, v: PublicVisitorInput[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const d = form.data;
  const company = d?.company || 'Visitor sign-in';
  usePublicBrand(d?.colour);
  // After the form: the phone follows its own visit (approved, where to wait).
  const state = useDeviceState(code, device, !!done);

  useEffect(() => {
    document.title = `${company} · Visitor check-in`;
  }, [company]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (f.name.trim().length < 2) local.name = 'Enter your name.';
    if (f.mobile.replace(/\D/g, '').length < 10) local.mobile = 'Enter your 10-digit mobile number.';
    if (!f.host && !f.host_name?.trim()) local.host_name = 'Whom have you come to meet?';
    if (d?.photo === 'required' && !f.photo) local.photo = 'Take a selfie to continue.';
    if (!f.consent) local.consent = 'Please agree to continue.';
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      const r = await submit.mutateAsync(f);
      saveDevice(code, r.device);
      setDevice(r.device);
      setDone({ code: r.code, expires_at: r.expires_at });
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      else setErrors({ form: errorMessage(err) });
    }
  };

  if (form.isLoading) return <PageLoader />;
  if (form.error || !d) {
    return (
      <PublicShell company="" kicker="Visitor check-in" title="This link is not valid">
        <PublicCard role="alert" className="space-y-2 text-center">
          <ShieldCheck className="mx-auto size-10 text-muted-foreground" aria-hidden />
          <p className="text-[15px]">Please ask the guard at the gate to sign you in.</p>
        </PublicCard>
      </PublicShell>
    );
  }

  if (done) {
    const s = state.data;
    const first = f.name.split(' ')[0];
    const inside = s && ['inside', 'leaving', 'held'].includes(s.state);
    return (
      <PublicShell
        company={company}
        logoUrl={d.logo_url}
        kicker="Visitor check-in"
        title={inside ? `You are checked in, ${first}` : `Thank you, ${first}`}
        subtitle={inside ? 'Welcome! Please follow the guard’s directions.' : 'One last step at the gate.'}
      >
        {inside ? (
          <PublicCard className="space-y-4 text-center" role="status" data-testid="visitor-checked-in">
            <CheckCircle2 className="mx-auto size-14 text-success" aria-hidden />
            {s.where ? (
              <p className="flex items-center justify-center gap-2 rounded-md bg-primary/10 px-3 py-3 text-lg font-semibold text-primary" data-testid="visitor-where">
                <MapPin className="size-5 shrink-0" aria-hidden /> {s.where}
              </p>
            ) : (
              <p className="text-[15px] text-muted-foreground">Your host has been told you are here. The guard will tell you where to wait.</p>
            )}
            <p className="text-[13px] text-muted-foreground">When you leave, scan the check-out QR at the gate with this phone.</p>
          </PublicCard>
        ) : s?.state === 'expired' || s?.state === 'closed' ? (
          <PublicCard className="space-y-2 text-center" role="status">
            <ShieldCheck className="mx-auto size-10 text-muted-foreground" aria-hidden />
            <p className="text-[15px]">{s.state === 'expired' ? 'Your code has expired.' : 'The guard could not check you in.'} Please speak to the guard.</p>
          </PublicCard>
        ) : (
          <PublicCard className="space-y-5" role="status" data-testid="visitor-done">
            <BigCode code={s?.code || done.code} label="Your check-in code" testId="visitor-code" />
            <p className="text-center text-[17px] font-semibold">Show this code to the guard</p>
            <ul className="space-y-2 text-[15px]">
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden /> The guard checks your details and lets you in.
              </li>
              <li className="flex items-start gap-2">
                <UserRound className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden /> Your host is told you are here.
              </li>
              {(s?.expires_at || done.expires_at) && (
                <li className="flex items-start gap-2 text-muted-foreground">
                  <Clock className="mt-0.5 size-5 shrink-0" aria-hidden /> The code works until {until(s?.expires_at || done.expires_at)}.
                </li>
              )}
            </ul>
          </PublicCard>
        )}
      </PublicShell>
    );
  }

  return (
    <PublicShell company={company} logoUrl={d.logo_url} kicker="Visitor check-in" title="Welcome!" subtitle="Check in in under a minute, then show your code to the guard.">
      <form onSubmit={send} className="space-y-4 rounded-xl border bg-card p-5 shadow-sm" noValidate>
        <Field label="Your name" required error={errors.name}>
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" className="h-12 text-base" name="name" />
        </Field>
        <Field label="Mobile number" required error={errors.mobile}>
          <Input type="tel" inputMode="numeric" value={f.mobile} onChange={(e) => set('mobile', e.target.value)} autoComplete="tel" className="h-12 text-base" name="mobile" />
        </Field>
        <Field label="Company / coming from">
          <Input value={f.company} onChange={(e) => set('company', e.target.value)} autoComplete="organization" className="h-12 text-base" name="company" />
        </Field>
        <Field label="Purpose of visit" error={errors.purpose}>
          <NativeSelect value={f.purpose} onChange={(e) => set('purpose', e.target.value)} className="h-12 text-base" name="purpose">
            <option value="">Choose…</option>
            {d.purposes.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </NativeSelect>
        </Field>
        <WhomToMeet
          code={code}
          token={token}
          mode={d.host_list}
          typed={f.host_name ?? ''}
          picked={picked}
          error={errors.host_name || errors.host}
          onType={(v) => setF((cur) => ({ ...cur, host_name: v, host: null }))}
          onPick={(p) => {
            setPicked(p);
            setF((cur) => ({ ...cur, host: p?.id ?? null, host_name: p ? (p.name ?? p.department) : '' }));
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Number of people" error={errors.people}>
            <Input type="number" inputMode="numeric" min={1} max={50} value={f.people} onChange={(e) => set('people', Number(e.target.value) || 1)} className="h-12 text-base" />
          </Field>
          <Field label="Vehicle number" error={errors.vehicle_no}>
            <Input value={f.vehicle_no} onChange={(e) => set('vehicle_no', e.target.value.toUpperCase())} className="h-12 font-mono text-base" placeholder="Optional" />
          </Field>
        </div>
        {d.photo !== 'off' && (
          <Field label="Selfie" required={d.photo === 'required'} error={errors.photo}>
            <PhotoField label="Selfie" facing="front" value={f.photo ?? null} onChange={(v) => set('photo', v)} required={d.photo === 'required'} testId="public-photo" />
          </Field>
        )}
        {/* Honeypot: hidden from people and screen readers; bots fill it. */}
        <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set('website', e.target.value)} name="website" />
          </label>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-md bg-muted/60 p-3 text-sm">
          <Checkbox checked={f.consent} onCheckedChange={(v) => set('consent', v === true)} aria-label="I agree" className="mt-0.5" />
          <span>{d.consent_text}</span>
        </label>
        {errors.consent && (
          <p role="alert" className="text-[13px] font-medium text-destructive">
            {errors.consent}
          </p>
        )}
        {errors.form && (
          <p role="alert" className="text-[13px] font-medium text-destructive">
            {errors.form}
          </p>
        )}
        <Button type="submit" variant="cta" size="lg" className="h-13 w-full text-base" loading={submit.isPending}>
          Get my check-in code
        </Button>
      </form>
    </PublicShell>
  );
}

/** Whom to meet: search the company's people (name + department only), pick a department, or type a name. */
function WhomToMeet({
  code,
  token,
  mode,
  typed,
  picked,
  error,
  onType,
  onPick,
}: {
  code: string;
  token: string;
  mode: 'people' | 'departments' | 'off';
  typed: string;
  picked: Picked;
  error?: string;
  onType: (v: string) => void;
  onPick: (p: Picked) => void;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const hosts = usePublicHosts(code, token, debounced, mode);
  const results: PublicHostOption[] = hosts.data?.results ?? [];

  if (mode === 'departments') {
    return (
      <Field label="Whom have you come to meet?" required error={error}>
        <NativeSelect value={typed} onChange={(e) => onPick(e.target.value ? { department: e.target.value } : null)} className="h-12 text-base" name="host_department">
          <option value="">Choose a department…</option>
          {results.map((r) => (
            <option key={r.department}>{r.department}</option>
          ))}
        </NativeSelect>
      </Field>
    );
  }
  if (mode === 'off') {
    return (
      <Field label="Whom have you come to meet?" required error={error}>
        <Input value={typed} onChange={(e) => onType(e.target.value)} className="h-12 text-base" name="host_name" placeholder="Name or department" />
      </Field>
    );
  }
  if (picked) {
    return (
      <Field label="Whom have you come to meet?" required error={error}>
        <div className="flex items-center gap-3 rounded-md border-2 border-primary bg-primary/10 p-3" data-testid="host-picked">
          <UserRound className="size-6 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{picked.name ?? picked.department}</p>
            {picked.name && picked.department && <p className="text-[13px] text-muted-foreground">{picked.department}</p>}
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Change whom to meet" onClick={() => onPick(null)}>
            <X />
          </Button>
        </div>
      </Field>
    );
  }
  return (
    <Field label="Whom have you come to meet?" required error={error} hint="Type 2 letters of their name, or a department">
      <div className="space-y-2">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            onType(e.target.value);
          }}
          className="h-12 text-base"
          name="host_name"
          autoComplete="off"
          placeholder="Search name"
          aria-controls="host-results"
        />
        {results.length > 0 && q.trim().length >= 2 && (
          <ul id="host-results" className="divide-y overflow-hidden rounded-md border" aria-label="People">
            {results.map((r) =>
              r.id ? (
                <li key={r.id}>
                  <button type="button" className="flex min-h-12 w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted" onClick={() => onPick({ id: r.id, name: r.name, department: r.department })}>
                    <UserRound className="size-5 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.name}</span>
                      {r.department && <span className="block text-[13px] text-muted-foreground">{r.department}</span>}
                    </span>
                  </button>
                </li>
              ) : null,
            )}
          </ul>
        )}
      </div>
    </Field>
  );
}
