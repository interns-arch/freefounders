import { zodResolver } from '@hookform/resolvers/zod';
import { type ReactNode, useRef } from 'react';
import { type FieldErrors, type FieldValues, type Path, useForm, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import type { ZodType } from 'zod';
import { Label } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * react-hook-form wired to a shared zod schema (the same one the API validates with).
 * The schema may change between renders (e.g. when an asset type's custom fields load).
 */
export function useZodForm<T extends FieldValues = Record<string, any>>(schema: ZodType, defaultValues: Partial<T>) {
  const ref = useRef(schema);
  ref.current = schema;
  const form = useForm<T>({
    // The resolver returns the parsed (clean) values on submit.
    resolver: ((values: any, ctx: any, opts: any) => zodResolver(ref.current as any)(values, ctx, opts)) as any,
    defaultValues: defaultValues as any,
    mode: 'onTouched',
  });
  // Never fail silently: if validation blocks a submit, say what is wrong.
  const f = form as UseFormReturn<T> & { __wrapped?: boolean };
  if (!f.__wrapped) {
    const original = form.handleSubmit;
    form.handleSubmit = ((onValid: any, onInvalid?: any) => original(onValid, onInvalid ?? ((errors: FieldErrors) => showInvalid(errors)))) as typeof original;
    f.__wrapped = true;
  }
  return form;
}

function firstError(errors: any, path: string[] = []): { path: string; message: string } | null {
  for (const [k, v] of Object.entries(errors ?? {})) {
    if (!v || typeof v !== 'object') continue;
    if (typeof (v as any).message === 'string' && (v as any).message) return { path: [...path, k].join('.'), message: (v as any).message };
    const nested = firstError(v, [...path, k]);
    if (nested) return nested;
  }
  return null;
}

function showInvalid(errors: FieldErrors) {
  const e = firstError(errors);
  toast.error(e ? `Please check the form — ${e.message}` : 'Please check the highlighted fields');
}

/** Shows server-side field errors (400 responses) next to the right inputs. Returns true if any were applied. */
export function applyServerErrors<T extends FieldValues>(form: UseFormReturn<T>, err: unknown): boolean {
  if (!(err instanceof ApiError) || !err.errors) return false;
  let applied = false;
  for (const [key, message] of Object.entries(err.errors)) {
    if (key === '_') continue;
    form.setError(key as Path<T>, { type: 'server', message });
    applied = true;
  }
  return applied;
}

export function Field({
  label,
  error,
  hint,
  required,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="text-destructive">*</span>}
        </Label>
      )}
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Reads a nested error message (e.g. "attributes.ram_gb") from react-hook-form state. */
export function errorOf(form: UseFormReturn<any>, name: string): string | undefined {
  const parts = name.split('.');
  let cur: any = form.formState.errors;
  for (const p of parts) {
    cur = cur?.[p];
    if (!cur) break;
  }
  // Server errors are stored with the dotted key as a flat name as well.
  const flat = (form.formState.errors as any)[name];
  return (cur?.message ?? flat?.message) as string | undefined;
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
