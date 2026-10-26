/**
 * The open visitor sign-in (PLAN.md §22): /v/<company code>/<token>, reached by scanning the QR at the gate. No sign-in,
 * works in any phone browser. The visitor fills a short form; the guard sees them at once and checks them in. Nothing
 * comes back but a short code to show the guard. The company's people list is never shown: the visitor types a name.
 */
import { ApiError, errorMessage } from '@kaampilot/core';
import { type PublicVisitorInput, usePublicVisitorForm, useSubmitPublicVisitor } from '@kaampilot/core/visitors';
import { type FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { CheckCircle2, ShieldCheck } from '@/components/icons';
import { BrandLockup } from '@/components/brand';
import { Field } from '@/components/common/form';
import { PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/primitives';
import { PhotoField } from './parts';

export function PublicVisitorPage() {
  const { code = '', token = '' } = useParams();
  const form = usePublicVisitorForm(code, token);
  const submit = useSubmitPublicVisitor(code, token);
  const [f, setF] = useState<PublicVisitorInput>({ name: '', mobile: '', company: '', purpose: '', host_name: '', people: 1, vehicle_no: '', photo: null, consent: false, website: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const set = <K extends keyof PublicVisitorInput>(k: K, v: PublicVisitorInput[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const company = form.data?.company || 'Visitor sign-in';

  useEffect(() => {
    document.title = `${company} · Visitor sign-in`;
  }, [company]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (f.name.trim().length < 2) local.name = 'Enter your name.';
    if (f.mobile.replace(/\D/g, '').length < 10) local.mobile = 'Enter your 10-digit mobile number.';
    if (!f.host_name?.trim()) local.host_name = 'Whom have you come to meet?';
    if (form.data?.photo === 'required' && !f.photo) local.photo = 'Take a selfie to continue.';
    if (!f.consent) local.consent = 'Please agree to continue.';
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      const r = await submit.mutateAsync(f);
      setDone(r.code);
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      else setErrors({ form: errorMessage(err) });
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <span className="truncate text-[15px] font-semibold">{company}</span>
        <BrandLockup size={24} />
      </header>
      <main id="content" className="flex flex-1 justify-center px-4 py-6">
        <div className="w-full max-w-md space-y-5">
          {form.isLoading ? (
            <PageLoader />
          ) : form.error ? (
            <div role="alert" className="space-y-2 rounded-xl border bg-card p-6 text-center">
              <ShieldCheck className="mx-auto size-8 text-muted-foreground" aria-hidden />
              <h1 className="text-xl font-bold">This link is not valid</h1>
              <p className="text-sm text-muted-foreground">Please ask the guard at the gate to sign you in.</p>
            </div>
          ) : done ? (
            <div role="status" className="space-y-3 rounded-xl border bg-card p-6 text-center" data-testid="visitor-done">
              <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
              <h1 className="text-xl font-bold">Thank you, {f.name.split(' ')[0]}</h1>
              <p className="text-sm text-muted-foreground">Please show this screen to the guard.</p>
              <p className="font-mono text-4xl font-bold tracking-[0.2em]" data-testid="visitor-code">
                {done}
              </p>
            </div>
          ) : (
            <form onSubmit={send} className="space-y-4 rounded-xl border bg-card p-5" noValidate>
              <div>
                <h1 className="text-xl font-bold">Visitor sign-in</h1>
                <p className="text-sm text-muted-foreground">Fill this in, then show the code to the guard.</p>
              </div>
              <Field label="Your name" required error={errors.name}>
                <Input value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" className="h-11 text-base" name="name" />
              </Field>
              <Field label="Mobile number" required error={errors.mobile}>
                <Input type="tel" inputMode="numeric" value={f.mobile} onChange={(e) => set('mobile', e.target.value)} autoComplete="tel" className="h-11 text-base" name="mobile" />
              </Field>
              <Field label="Company / coming from">
                <Input value={f.company} onChange={(e) => set('company', e.target.value)} autoComplete="organization" className="h-11 text-base" name="company" />
              </Field>
              <Field label="Purpose of visit" error={errors.purpose}>
                <NativeSelect value={f.purpose} onChange={(e) => set('purpose', e.target.value)} className="h-11 text-base" name="purpose">
                  <option value="">Choose…</option>
                  {(form.data?.purposes ?? []).map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Whom have you come to meet?" required error={errors.host_name}>
                <Input value={f.host_name} onChange={(e) => set('host_name', e.target.value)} className="h-11 text-base" name="host_name" placeholder="Name or department" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Number of people" error={errors.people}>
                  <Input type="number" min={1} max={50} value={f.people} onChange={(e) => set('people', Number(e.target.value) || 1)} className="h-11 text-base" />
                </Field>
                <Field label="Vehicle number" error={errors.vehicle_no}>
                  <Input value={f.vehicle_no} onChange={(e) => set('vehicle_no', e.target.value.toUpperCase())} className="h-11 font-mono text-base" placeholder="Optional" />
                </Field>
              </div>
              {form.data?.photo !== 'off' && (
                <Field label="Selfie" required={form.data?.photo === 'required'} error={errors.photo}>
                  <PhotoField label="Selfie" facing="front" value={f.photo ?? null} onChange={(v) => set('photo', v)} required={form.data?.photo === 'required'} testId="public-photo" />
                </Field>
              )}
              {/* Honeypot: hidden from people and screen readers; bots fill it. */}
              <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label>
                  Website
                  <input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set('website', e.target.value)} name="website" />
                </label>
              </div>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <Checkbox checked={f.consent} onCheckedChange={(v) => set('consent', v === true)} aria-label="I agree" className="mt-0.5" />
                <span>{form.data?.consent_text}</span>
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
              <Button type="submit" variant="cta" size="lg" className="w-full" loading={submit.isPending}>
                Send to the guard
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
