import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle } from '@/components/icons';
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode, useEffect, useId, useRef } from 'react';
import { type FieldErrors, type FieldValues, type Path, useForm, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import type { ZodType } from 'zod';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { ApiError } from '@kaampilot/core';
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

/** Every field error as a flat list ("attributes.ram_gb" → its message), for the summary at the top of a form. */
export type ErrorMap = FieldErrors | Record<string, string | undefined>;

export function listErrors(errors: ErrorMap | undefined, path: string[] = []): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  for (const [k, v] of Object.entries(errors ?? {})) {
    const here = [...path, k];
    if (typeof v === 'string') {
      if (v) out.push({ path: here.join('.'), message: v });
      continue;
    }
    if (!v || typeof v !== 'object') continue;
    if (typeof (v as any).message === 'string' && (v as any).message) out.push({ path: here.join('.'), message: (v as any).message });
    else if (!('ref' in (v as any))) out.push(...listErrors(v as FieldErrors, here));
  }
  return out;
}

/** Finds the field for an error path: by id, then by name (react-hook-form registers inputs by name). */
function focusField(path: string) {
  const el =
    document.getElementById(path) ??
    document.querySelector<HTMLElement>(`[name="${CSS.escape(path)}"]`) ??
    document.getElementById(`${path}-field`);
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  el.focus();
}

/**
 * "Please fix these" box at the top of a form: lists every error with a link that jumps to the field. Announced
 * (role=alert) and focused the moment errors appear, so keyboard and screen-reader users land on it first.
 */
export function FormErrorSummary({ errors, labels = {}, className }: { errors: ErrorMap | undefined; labels?: Record<string, string>; className?: string }) {
  const items = listErrors(errors);
  const ref = useRef<HTMLDivElement>(null);
  const count = items.length;
  useEffect(() => {
    if (count > 0) ref.current?.focus({ preventScroll: false });
  }, [count]);
  if (!count) return null;
  return (
    <div ref={ref} role="alert" tabIndex={-1} className={cn('rounded-lg border border-destructive/40 bg-destructive/8 px-4 py-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-destructive/30', className)}>
      <p className="flex items-center gap-2 font-semibold text-destructive">
        <AlertCircle className="size-4 shrink-0" aria-hidden />
        {count === 1 ? 'Please fix this before saving' : `Please fix these ${count} things before saving`}
      </p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-6">
        {items.map((e) => (
          <li key={e.path}>
            <a
              href={`#${e.path}`}
              className="text-foreground underline decoration-destructive/50 underline-offset-2 hover:text-destructive"
              onClick={(ev) => {
                ev.preventDefault();
                focusField(e.path);
              }}
            >
              {labels[e.path] ? `${labels[e.path]}: ` : ''}
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
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

const FIELD_CONTROLS: unknown[] = [Input, Textarea, NativeSelect, 'input', 'select', 'textarea'];

/**
 * Label + control + error/hint. When the child is a plain control (Input, Textarea, NativeSelect or the native tags)
 * it is wired up for assistive tech automatically: id from `htmlFor`, aria-invalid, aria-required and
 * aria-describedby pointing at the error or hint text. The error line is announced (role=alert).
 */
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
  const auto = useId();
  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : null;
  const control = isValidElement(only) && FIELD_CONTROLS.includes(only.type) ? (only as ReactElement<Record<string, unknown>>) : null;
  // A plain control always gets an id, so the label is clickable and announced even when the caller gave none.
  const id = (control?.props.id as string | undefined) ?? htmlFor ?? (control ? `f-${auto.replace(/[^a-zA-Z0-9_-]/g, '')}` : undefined);
  const errorId = id && error ? `${id}-error` : undefined;
  const hintId = id && hint && !error ? `${id}-hint` : undefined;
  const body = control
    ? cloneElement(control, {
        id,
        'aria-invalid': error ? true : (control.props['aria-invalid'] as boolean | undefined),
        'aria-required': required || (control.props.required as boolean | undefined) || undefined,
        'aria-describedby': [control.props['aria-describedby'] as string | undefined, errorId ?? hintId].filter(Boolean).join(' ') || undefined,
      })
    : children;
  return (
    <div className={cn('grid gap-1.5', className)}>
      {label && (
        <Label htmlFor={id}>
          {label}
          {required && <span className="text-destructive">*</span>}
        </Label>
      )}
      {body}
      {error ? (
        <p id={errorId} role="alert" className="text-[13px] font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
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
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold">{title}</h3>
          {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        </div>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>
      {children}
    </section>
  );
}
