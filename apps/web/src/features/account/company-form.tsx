/**
 * "Create your company" (PLAN.md §20.5 step 2): name, team size, industry, state (GST), apps. Used by sign-up and by
 * "New company" in the account menu. Then the "Setting up your company…" screen while the server provisions it.
 */
import { type CompanyInput, INDUSTRIES, TEAM_SIZES, type TeamSize } from '@freefounders/core/account';
import { INDIAN_STATES } from '@freefounders/core/billing';
import type { AppKey } from '@freefounders/core';
import { CheckCircle2, ClipboardList, Loader2, Package } from '@/components/icons';
import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label, NativeSelect } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { FormError, TextField } from './parts';

export const EMPTY_COMPANY: CompanyInput = { name: '', teamSize: '1-10', industry: '', state: '', apps: ['tasks', 'assets'] };

const APP_CHOICES: Array<{ app: AppKey; name: string; blurb: string; icon: typeof Package }> = [
  { app: 'tasks', name: 'Attendance + Tasks', blurb: 'Punch in/out with GPS and selfie, leave, payroll, tasks and checklists', icon: ClipboardList },
  { app: 'assets', name: 'Assets', blurb: 'Laptops, phones, vehicles: who has what, joiners and exits', icon: Package },
];

type Errors = Partial<Record<'name' | 'industry' | 'state' | 'apps', string>>;

export function CompanyForm({
  value,
  onChange,
  onSubmit,
  error,
  submitLabel = 'Create company',
  busy,
}: {
  value: CompanyInput;
  onChange: (v: CompanyInput) => void;
  onSubmit: (v: CompanyInput) => void;
  error?: string | null;
  submitLabel?: string;
  busy?: boolean;
}) {
  const [errors, setErrors] = useState<Errors>({});
  const set = <K extends keyof CompanyInput>(k: K, v: CompanyInput[K]) => {
    onChange({ ...value, [k]: v });
    if (errors[k as keyof Errors]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const toggleApp = (app: AppKey, on: boolean) => set('apps', on ? [...new Set([...value.apps, app])] : value.apps.filter((a) => a !== app));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Errors = {
      name: value.name.trim().length < 2 ? 'Enter your company’s name.' : undefined,
      industry: value.industry ? undefined : 'Choose an industry.',
      state: value.state ? undefined : 'Choose the state (needed for GST invoices).',
      apps: value.apps.length ? undefined : 'Choose at least one app.',
    };
    setErrors(next);
    const first = (['name', 'industry', 'state'] as const).find((k) => next[k]);
    if (first) {
      document.getElementById(`company-${first}`)?.focus();
      return;
    }
    if (next.apps) return;
    onSubmit({ ...value, name: value.name.trim() });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <TextField
        id="company-name"
        label="Company name"
        value={value.name}
        onChange={(e) => set('name', e.target.value)}
        autoComplete="organization"
        autoFocus
        error={errors.name}
        maxLength={120}
      />
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-sm font-medium">Team size</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TEAM_SIZES.map((t) => (
            <label
              key={t.value}
              className={cn(
                'flex min-h-11 cursor-pointer items-center justify-center rounded-md border bg-card px-2 text-center text-sm font-medium transition outline-none has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40 hover:border-primary/40',
                value.teamSize === t.value && 'border-primary bg-primary/8 text-primary',
              )}
            >
              <input type="radio" name="team-size" value={t.value} checked={value.teamSize === t.value} onChange={() => set('teamSize', t.value as TeamSize)} className="sr-only" />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="company-industry">Industry</Label>
          <NativeSelect
            id="company-industry"
            className="h-11"
            value={value.industry}
            onChange={(e) => set('industry', e.target.value)}
            aria-invalid={errors.industry ? true : undefined}
            aria-describedby={errors.industry ? 'company-industry-error' : undefined}
          >
            <option value="">Choose…</option>
            {INDUSTRIES.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </NativeSelect>
          {errors.industry && (
            <p id="company-industry-error" role="alert" className="text-[13px] font-medium text-destructive">
              {errors.industry}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="company-state">State</Label>
          <NativeSelect
            id="company-state"
            className="h-11"
            value={value.state}
            onChange={(e) => set('state', e.target.value)}
            aria-invalid={errors.state ? true : undefined}
            aria-describedby={errors.state ? 'company-state-error' : 'company-state-hint'}
          >
            <option value="">Choose…</option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code}>{s.name}</option>
            ))}
          </NativeSelect>
          {errors.state ? (
            <p id="company-state-error" role="alert" className="text-[13px] font-medium text-destructive">
              {errors.state}
            </p>
          ) : (
            <p id="company-state-hint" className="text-xs text-muted-foreground">
              For GST on your invoices.
            </p>
          )}
        </div>
      </div>
      <fieldset aria-describedby={errors.apps ? 'company-apps-error' : undefined}>
        <legend className="mb-1.5 text-sm font-medium">Apps</legend>
        <div className="space-y-2">
          {APP_CHOICES.map((a) => {
            const on = value.apps.includes(a.app);
            return (
              <label key={a.app} className={cn('flex cursor-pointer items-start gap-3 rounded-md border bg-card p-3 transition hover:border-primary/40', on && 'border-primary/50 bg-primary/5')}>
                <Checkbox checked={on} onCheckedChange={(c) => toggleApp(a.app, c === true)} className="mt-0.5" aria-label={a.name} />
                <a.icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{a.name}</span>
                  <span className="block text-[13px] text-muted-foreground">{a.blurb}</span>
                </span>
              </label>
            );
          })}
        </div>
        {errors.apps && (
          <p id="company-apps-error" role="alert" className="mt-1.5 text-[13px] font-medium text-destructive">
            {errors.apps}
          </p>
        )}
      </fieldset>
      <FormError>{error}</FormError>
      <Button type="submit" size="lg" className="h-11 w-full" loading={busy}>
        {submitLabel}
      </Button>
      <p className="text-center text-xs text-muted-foreground">14-day free trial of every app. No card needed.</p>
    </form>
  );
}

/** What is being prepared, for the apps chosen (PLAN.md §19.28: two built-in roles). */
function setupSteps(apps: string[]) {
  return [
    'Creating your company',
    ...(apps.includes('tasks') ? ['Setting up Attendance and Tasks'] : []),
    ...(apps.includes('assets') ? ['Setting up Assets'] : []),
    'Adding the roles Admin and Member',
    ...(apps.includes('tasks') ? ['Preparing shifts, leave types and holidays'] : []),
    'Almost ready',
  ];
}

/** Full screen while the company is being provisioned (often 10–15 seconds; after 20 s a "still working" line). */
export function SetupScreen({ companyName, apps = ['tasks', 'assets'], error, onRetry }: { companyName: string; apps?: string[]; error?: string | null; onRetry?: () => void }) {
  const steps = setupSteps(apps);
  const [i, setI] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (error) return;
    const t = setInterval(() => setI((n) => Math.min(n + 1, steps.length - 1)), 2000);
    const s = setTimeout(() => setSlow(true), 20_000);
    return () => (clearInterval(t), clearTimeout(s));
  }, [error, steps.length]);
  const SETUP_STEPS = steps;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-[420px]" aria-live="polite" aria-busy={!error}>
        <h1 className="text-[24px] font-bold tracking-tight">{error ? 'Something went wrong' : `Setting up ${companyName || 'your company'}…`}</h1>
        {error ? (
          <div className="mt-4 space-y-4">
            <FormError>{error}</FormError>
            {onRetry && (
              <Button size="lg" className="h-11 w-full" onClick={onRetry}>
                Back and try again
              </Button>
            )}
          </div>
        ) : (
          <>
          <ol className="mt-6 space-y-3">
            {SETUP_STEPS.map((s, n) => (
              <li key={s} className={cn('flex items-center gap-3 text-[15px]', n > i && 'text-muted-foreground', n === i && 'font-semibold')}>
                {n < i ? (
                  <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
                ) : n === i ? (
                  <Loader2 className="size-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
                ) : (
                  <span className="size-5 shrink-0 rounded-sm border" aria-hidden />
                )}
                <span>
                  {s}
                  <span className="sr-only">{n < i ? ' (done)' : n === i ? ' (in progress)' : ''}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-muted-foreground">
            {slow ? 'Still working: this can take up to a minute. Please keep this page open.' : 'This takes a few seconds. Please keep this page open.'}
          </p>
          </>
        )}
      </div>
    </div>
  );
}
