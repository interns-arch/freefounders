/**
 * Renders a form's fields and collects the answers (old FormRenderer.jsx). Used by the in-app fill page (signed in)
 * and the public share-link page (no sign-in): the caller passes the submit function.
 */
import { errorMessage } from '@freefounders/core';
import { type FormAnswers, type FormField, FormSubmitError } from '@freefounders/core/tasks';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/primitives';
import { compressImage } from '@/lib/compress-image';
import { ErrorNote } from '../general/parts';

export function FormRenderer({
  description,
  fields,
  submit,
  pending,
  onDone,
}: {
  description?: string;
  fields: FormField[];
  submit: (answers: FormAnswers) => Promise<unknown>;
  pending: boolean;
  onDone: () => void;
}) {
  const uid = useId();
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topErr, setTopErr] = useState('');

  const setVal = (id: number, v: string) => setValues((p) => ({ ...p, [id]: v }));
  const toggle = (id: number, opt: string) =>
    setValues((p) => {
      const cur = (p[id] as string[] | undefined) ?? [];
      return { ...p, [id]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] };
    });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setTopErr('');
    try {
      await submit({ values, files });
      onDone();
    } catch (err) {
      if (err instanceof FormSubmitError) {
        setErrors(err.fieldErrors);
        setTopErr(err.message);
      } else setTopErr(errorMessage(err));
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {description && <p className="text-sm text-muted-foreground whitespace-pre-line">{description}</p>}
      {fields.map((field) => {
        const fid = `${uid}-f${field.id}`;
        const err = errors[String(field.id)];
        const v = values[field.id];
        const text = typeof v === 'string' ? v : '';
        const picked = Array.isArray(v) ? v : [];
        const common = { id: fid, 'aria-invalid': !!err || undefined, 'aria-describedby': err ? `${fid}-err` : undefined };
        return (
          <div key={field.id} className="grid gap-1.5">
            {field.type === 'radio' || field.type === 'checkbox' ? (
              <fieldset className="grid gap-1.5" aria-describedby={err ? `${fid}-err` : undefined}>
                <legend className="mb-1.5 text-[13px] font-medium">
                  {field.label} {field.required && <span className="text-destructive">*</span>}
                </legend>
                {field.options.map((o) =>
                  field.type === 'radio' ? (
                    <label key={o} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input type="radio" name={fid} className="size-4 accent-primary" checked={text === o} onChange={() => setVal(field.id, o)} />
                      {o}
                    </label>
                  ) : (
                    <label key={o} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox checked={picked.includes(o)} onCheckedChange={() => toggle(field.id, o)} aria-label={o} />
                      {o}
                    </label>
                  ),
                )}
              </fieldset>
            ) : (
              <>
                <Label htmlFor={fid}>
                  {field.label} {field.required && <span className="text-destructive">*</span>}
                </Label>
                {field.type === 'long_text' && <Textarea {...common} rows={4} value={text} onChange={(e) => setVal(field.id, e.target.value)} />}
                {field.type === 'number' && <Input {...common} type="number" inputMode="decimal" value={text} onChange={(e) => setVal(field.id, e.target.value)} />}
                {field.type === 'email' && <Input {...common} type="email" inputMode="email" autoComplete="email" value={text} onChange={(e) => setVal(field.id, e.target.value)} />}
                {field.type === 'phone' && <Input {...common} type="tel" inputMode="tel" autoComplete="tel" placeholder="+91…" value={text} onChange={(e) => setVal(field.id, e.target.value)} />}
                {field.type === 'date' && <Input {...common} type="date" value={text} onChange={(e) => setVal(field.id, e.target.value)} />}
                {field.type === 'dropdown' && (
                  <NativeSelect {...common} value={text} onChange={(e) => setVal(field.id, e.target.value)}>
                    <option value="">Select…</option>
                    {field.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </NativeSelect>
                )}
                {field.type === 'file' && (
                  <Input
                    {...common}
                    type="file"
                    onChange={(e) => {
                      const picked = e.target.files?.[0] ?? null;
                      setFiles((p) => ({ ...p, [field.id]: picked }));
                      // A photo goes up smaller (PLAN.md §19.20); swapped in when ready.
                      if (picked) void compressImage(picked, 'document').then((small) => setFiles((p) => (p[field.id] === picked ? { ...p, [field.id]: small } : p)));
                    }}
                  />
                )}
                {field.type === 'short_text' && <Input {...common} value={text} onChange={(e) => setVal(field.id, e.target.value)} />}
              </>
            )}
            {err && (
              <p id={`${fid}-err`} className="text-xs text-destructive">
                {err}
              </p>
            )}
          </div>
        );
      })}
      <ErrorNote>{topErr}</ErrorNote>
      <Button type="submit" loading={pending} className="w-full sm:w-auto">
        Submit
      </Button>
    </form>
  );
}
