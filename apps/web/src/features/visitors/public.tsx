/**
 * The open visitor sign-in (PLAN.md §22, V4 §22.11): /v/<company code>/<token>, reached by scanning the check-in QR.
 * No sign-in, works in any phone browser. The visitor fills a short form, gets a 4-digit check-in code to show the
 * guard, and the page follows the visit live: approved → "You are checked in" and, once the host answers, where to
 * wait (big, on top). The phone keeps a device secret so the check-out QR works on this phone only.
 * V4.1: "Whom are you meeting?" is a company choice (not shown at all when off), a dropdown of the company's people
 * (name — department only, type to filter) and optional ("Not sure") unless the company made it required.
 */
import { ApiError, errorMessage } from '@kaampilot/core';
import { type DeviceState, type PublicVisitorForm, type PublicVisitorInput, useDeviceState, usePublicHosts, usePublicVisitorForm, useSubmitPublicVisitor } from '@kaampilot/core/visitors';
import { type FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Check, CheckCircle2, ChevronsUpDown, Clock, HelpCircle, LogOut, MapPin, ShieldCheck, UserPlus, UserRound } from '@/components/icons';
import { Field } from '@/components/common/form';
import { PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { Checkbox } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { PeopleCount, PhotoField } from './parts';
import { BigCode, PublicCard, PublicShell, forgetDevice, readDevice, saveDevice, until, usePublicBrand } from './public-parts';

/** Whom to meet as chosen: a person from the list, "Not sure", or nothing yet. */
type Choice = { id: number; name: string; department: string } | 'not_sure' | null;

/** Visit states the phone keeps following (a reload of this page goes straight back to them). */
const FOLLOWING: DeviceState['state'][] = ['pending', 'waiting_host', 'inside', 'leaving', 'held'];

const EMPTY: PublicVisitorInput = { name: '', mobile: '', company: '', purpose: '', host_name: '', host: null, people: 1, vehicle_no: '', photo: null, consent: false, website: '' };

export function PublicVisitorPage() {
  const { code = '', token = '' } = useParams();
  const form = usePublicVisitorForm(code, token);
  const submit = useSubmitPublicVisitor(code, token);
  const [f, setF] = useState<PublicVisitorInput>(EMPTY);
  const [choice, setChoice] = useState<Choice>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ code: string; expires_at: string | null } | null>(null);
  const [device, setDevice] = useState<string | null>(() => readDevice(code));
  const set = <K extends keyof PublicVisitorInput>(k: K, v: PublicVisitorInput[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const d = form.data;
  const company = d?.company || 'Visitor sign-in';
  usePublicBrand(d?.colour);
  // The phone follows its own visit (approved, where to wait), also after a reload of this page.
  const state = useDeviceState(code, device, !!done || (!!device && !!d));

  useEffect(() => {
    document.title = `${company} · Visitor check-in`;
  }, [company]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (f.name.trim().length < 2) local.name = 'Enter your name.';
    if (f.mobile.replace(/\D/g, '').length < 10) local.mobile = 'Enter your 10-digit mobile number.';
    if (d?.host_required && !f.host && !f.host_name?.trim()) local.host_name = 'Whom have you come to meet?';
    if (d?.photo === 'required' && !f.photo) local.photo = 'Take a selfie to continue.';
    if (!f.consent) local.consent = 'Please agree to continue.';
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      const r = await submit.mutateAsync(d?.host_list === 'none' ? { ...f, host: null, host_name: '' } : f);
      saveDevice(code, r.device);
      setDevice(r.device);
      setDone({ code: r.code, expires_at: r.expires_at });
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      else setErrors({ form: errorMessage(err) });
    }
  };

  // The same QR page, a fresh form: the guard (or someone in the group) signs in the next visitor on this phone.
  const another = () => {
    forgetDevice(code);
    setDevice(null);
    setDone(null);
    setF(EMPTY);
    setChoice(null);
    setErrors({});
    window.scrollTo({ top: 0 });
  };

  if (form.isLoading || (!done && device && d && state.isLoading)) return <PageLoader />;
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

  // A cached answer from before "Check in another visitor" is not this phone's visit any more.
  const s = device ? state.data : undefined;
  if (done || (s && FOLLOWING.includes(s.state))) {
    return <VisitStatus d={d} company={company} s={s} first={(done ? f.name : s?.first_name || '').split(' ')[0]} done={done} onAnother={another} />;
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
        {d.host_list !== 'none' && (
          <WhomToMeet
            code={code}
            token={token}
            mode={d.host_list}
            required={d.host_required}
            typed={f.host_name ?? ''}
            choice={choice}
            error={errors.host_name || errors.host}
            onType={(v) => setF((cur) => ({ ...cur, host_name: v, host: null }))}
            onChoose={(c) => {
              setChoice(c);
              setF((cur) => ({ ...cur, host: c && c !== 'not_sure' ? c.id : null, host_name: c && c !== 'not_sure' ? c.name : '' }));
            }}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Number of visitors" error={errors.people}>
            <PeopleCount value={f.people ?? 1} onChange={(n) => set('people', n)} className="h-12" />
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

/** After the form (or a reload): the code, then "You are checked in" with where to wait on top, updated live. */
function VisitStatus({
  d,
  company,
  s,
  first,
  done,
  onAnother,
}: {
  d: PublicVisitorForm;
  company: string;
  s: DeviceState | undefined;
  first: string;
  done: { code: string; expires_at: string | null } | null;
  onAnother: () => void;
}) {
  const inside = !!s && ['inside', 'leaving', 'held'].includes(s.state);
  const shell = (title: string, subtitle: string | undefined, body: React.ReactNode) => (
    <PublicShell company={company} logoUrl={d.logo_url} kicker="Visitor check-in" title={title} subtitle={subtitle}>
      {body}
      <div className="mt-4 space-y-1.5 text-center">
        <Button type="button" variant="outline" size="lg" className="h-12 w-full text-base" onClick={onAnother} data-testid="visitor-another">
          <UserPlus aria-hidden /> Check in another visitor
        </Button>
        <p className="text-[13px] text-muted-foreground">For the guard, or to sign in someone with you. This phone then stops following this visit.</p>
      </div>
    </PublicShell>
  );
  if (inside) {
    return shell(
      `You are checked in${first ? `, ${first}` : ''}`,
      'Welcome! Please follow the guard’s directions.',
      <div className="space-y-4">
        {s.where ? (
          <PublicCard className="space-y-2 border-2 border-primary text-center" role="status" aria-live="assertive" data-testid="visitor-where">
            <MapPin className="mx-auto size-10 text-primary" aria-hidden />
            <p className="text-2xl font-bold text-primary">{s.where}</p>
            <p className="text-[13px] text-muted-foreground">Your host told the guard.</p>
          </PublicCard>
        ) : null}
        <PublicCard className="space-y-3 text-center" role="status" aria-live="polite" data-testid="visitor-checked-in">
          <CheckCircle2 className="mx-auto size-14 text-success" aria-hidden />
          {!s.where && (
            <p className="text-[15px] text-muted-foreground">
              {d.host_list !== 'none' ? 'If you named whom you are meeting, they have been told you are here. This page shows where to wait as soon as they answer.' : 'The guard will tell you where to wait.'}
            </p>
          )}
          {s.state === 'leaving' && <p className="text-[15px] font-semibold">Please wait — the guard will let you out.</p>}
          <p className="flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
            <LogOut className="size-4" aria-hidden /> When you leave, scan the check-out QR at the gate with this phone.
          </p>
        </PublicCard>
      </div>,
    );
  }
  if (s?.state === 'expired' || s?.state === 'closed') {
    return shell(
      `Thank you${first ? `, ${first}` : ''}`,
      undefined,
      <PublicCard className="space-y-2 text-center" role="status">
        <ShieldCheck className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <p className="text-[15px]">{s.state === 'expired' ? 'Your code has expired.' : 'The guard could not check you in.'} Please speak to the guard.</p>
      </PublicCard>,
    );
  }
  if (s?.state === 'waiting_host') {
    return shell(
      `Thank you${first ? `, ${first}` : ''}`,
      undefined,
      <PublicCard className="space-y-2 text-center" role="status" aria-live="polite" data-testid="visitor-waiting-host">
        <Clock className="mx-auto size-12 text-primary" aria-hidden />
        <p className="text-lg font-semibold">The guard has your details. Waiting for your host to confirm.</p>
        <p className="text-[13px] text-muted-foreground">Keep this page open: it changes by itself.</p>
      </PublicCard>,
    );
  }
  const code = s?.code || done?.code || '';
  const expires = s?.expires_at || done?.expires_at;
  return shell(
    `Thank you${first ? `, ${first}` : ''}`,
    'One last step at the gate.',
    <PublicCard className="space-y-5" role="status" data-testid="visitor-done">
      <BigCode code={code} label="Your check-in code" testId="visitor-code" />
      <p className="text-center text-[17px] font-semibold">Show this code to the guard</p>
      <ul className="space-y-2 text-[15px]">
        <li className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden /> The guard checks your details and lets you in.
        </li>
        {d.host_list !== 'none' && (
          <li className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden /> This page then shows where to wait.
          </li>
        )}
        {expires && (
          <li className="flex items-start gap-2 text-muted-foreground">
            <Clock className="mt-0.5 size-5 shrink-0" aria-hidden /> The code works until {until(expires)}.
          </li>
        )}
      </ul>
    </PublicCard>,
  );
}

/** Whom to meet (V4.1): a dropdown of the company's people (name — department, type to filter), a department list, or
 * a typed name. Optional ("Not sure") unless the company requires it. */
function WhomToMeet({
  code,
  token,
  mode,
  required,
  typed,
  choice,
  error,
  onType,
  onChoose,
}: {
  code: string;
  token: string;
  mode: Exclude<PublicVisitorForm['host_list'], 'none'>;
  required: boolean;
  typed: string;
  choice: Choice;
  error?: string;
  onType: (v: string) => void;
  onChoose: (c: Choice) => void;
}) {
  const [open, setOpen] = useState(false);
  const hosts = usePublicHosts(code, token, mode);
  const results = hosts.data?.results ?? [];
  const label = 'Whom are you meeting?';
  const hint = required ? undefined : 'Optional';

  if (mode === 'departments') {
    return (
      <Field label={label} required={required} hint={hint} error={error}>
        <NativeSelect value={typed} onChange={(e) => onType(e.target.value)} className="h-12 text-base" name="host_department">
          <option value="">{required ? 'Choose a department…' : 'Not sure'}</option>
          {results.map((r) => (
            <option key={r.department}>{r.department}</option>
          ))}
        </NativeSelect>
      </Field>
    );
  }
  if (mode === 'off') {
    return (
      <Field label={label} required={required} hint={hint} error={error}>
        <Input value={typed} onChange={(e) => onType(e.target.value)} className="h-12 text-base" name="host_name" placeholder={required ? 'Name or department' : 'Name or department (optional)'} />
      </Field>
    );
  }
  const people = results.filter((r): r is { id: number; name: string; department: string } => r.id != null);
  const picked = choice && choice !== 'not_sure' ? choice : null;
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor="whom-to-meet">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id="whom-to-meet"
            type="button"
            name="host"
            aria-invalid={!!error || undefined}
            aria-haspopup="listbox"
            data-testid="whom-to-meet"
            className="flex h-12 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-base shadow-xs outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 aria-invalid:border-destructive"
          >
            {picked ? <UserRound className="size-5 shrink-0 text-primary" aria-hidden /> : choice === 'not_sure' ? <HelpCircle className="size-5 shrink-0 text-muted-foreground" aria-hidden /> : null}
            <span className={cn('min-w-0 flex-1 truncate', !choice && 'text-muted-foreground')}>
              {picked ? (
                <>
                  <span className="font-medium">{picked.name}</span>
                  {picked.department && <span className="text-muted-foreground"> — {picked.department}</span>}
                </>
              ) : choice === 'not_sure' ? (
                'Not sure'
              ) : (
                'Choose a person…'
              )}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0">
          <Command>
            <CommandInput placeholder="Type to filter names" className="text-base" />
            <CommandList aria-label="People">
              <CommandEmpty>{hosts.isLoading ? 'Loading…' : 'Nobody with this name. Choose “Not sure”, the guard will help.'}</CommandEmpty>
              {!required && (
                <CommandGroup>
                  <CommandItem
                    forceMount
                    value="__not_sure__"
                    onSelect={() => {
                      onChoose('not_sure');
                      setOpen(false);
                    }}
                  >
                    <HelpCircle className="text-muted-foreground" aria-hidden />
                    <span className="flex-1">Not sure</span>
                    {choice === 'not_sure' && <Check className="size-4 text-primary" aria-hidden />}
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandGroup>
                {people.map((r) => (
                  <CommandItem
                    key={r.id}
                    value={`${r.name} ${r.department} ${r.id}`}
                    onSelect={() => {
                      onChoose({ id: r.id, name: r.name, department: r.department });
                      setOpen(false);
                    }}
                    className="min-h-11"
                  >
                    <UserRound className="text-primary" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {r.name}
                      {r.department && <span className="text-muted-foreground"> — {r.department}</span>}
                    </span>
                    {picked?.id === r.id && <Check className="size-4 text-primary" aria-hidden />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Field>
  );
}
