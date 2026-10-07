import { type Attributes, formatAttributeValue } from '@eam/shared';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/primitives';
import type { FieldDefinition } from '@/lib/types';
import { cn, formatDate } from '@/lib/utils';
import { errorOf, Field } from './form';

/** Renders any asset type's custom fields from its definitions — no hard-coded forms. */
export function DynamicFields({ fields, form, prefix = 'attributes' }: { fields: FieldDefinition[]; form: UseFormReturn<any>; prefix?: string }) {
  if (!fields.length) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => (
        <DynamicField key={f.key} field={f} form={form} name={prefix ? `${prefix}.${f.key}` : f.key} />
      ))}
    </div>
  );
}

function DynamicField({ field, form, name }: { field: FieldDefinition; form: UseFormReturn<any>; name: string }) {
  const error = errorOf(form, name);
  const common = { id: name, 'aria-invalid': !!error || undefined, placeholder: field.placeholder ?? undefined };
  const wide = field.type === 'textarea' || field.type === 'multiselect';
  const hint = field.helpText ?? (field.isUnique ? 'Must be unique' : undefined);

  let control: React.ReactNode;
  switch (field.type) {
    case 'textarea':
      control = <Textarea rows={3} {...common} {...form.register(name)} />;
      break;
    case 'boolean':
      control = (
        <Controller
          control={form.control}
          name={name}
          render={({ field: f }) => (
            <label className="flex h-9 cursor-pointer items-center gap-2.5 text-sm">
              <Switch checked={f.value === true || f.value === 'true'} onCheckedChange={(v) => f.onChange(v)} id={name} />
              <span className="text-muted-foreground">{f.value === true || f.value === 'true' ? 'Yes' : 'No'}</span>
            </label>
          )}
        />
      );
      break;
    case 'select':
      control = (
        <NativeSelect {...common} {...form.register(name)}>
          <option value="">{field.required ? 'Select…' : '—'}</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </NativeSelect>
      );
      break;
    case 'multiselect':
      control = (
        <Controller
          control={form.control}
          name={name}
          render={({ field: f }) => {
            const selected: string[] = Array.isArray(f.value) ? f.value : f.value ? [f.value] : [];
            return (
              <div className="flex flex-wrap gap-1.5">
                {(field.options ?? []).map((o) => {
                  const on = selected.includes(o);
                  return (
                    <button
                      type="button"
                      key={o}
                      onClick={() => f.onChange(on ? selected.filter((x) => x !== o) : [...selected, o])}
                      className={cn(
                        'cursor-pointer rounded-md border px-2.5 py-1 text-xs font-medium transition',
                        on ? 'border-primary bg-primary/10 text-primary' : 'bg-card text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {o}
                    </button>
                  );
                })}
              </div>
            );
          }}
        />
      );
      break;
    case 'date':
      control = <Input type="date" {...common} {...form.register(name)} />;
      break;
    case 'number':
    case 'currency':
      control = (
        <Input
          type="number"
          step="any"
          inputMode="decimal"
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          {...common}
          {...form.register(name)}
        />
      );
      break;
    case 'email':
      control = <Input type="email" {...common} {...form.register(name)} />;
      break;
    case 'phone':
      control = <Input type="tel" {...common} {...form.register(name)} />;
      break;
    case 'url':
      control = <Input type="url" {...common} {...form.register(name)} />;
      break;
    default:
      control = <Input {...common} {...form.register(name)} />;
  }

  return (
    <Field label={field.label} required={field.required} error={error} hint={hint} htmlFor={name} className={cn(wide && 'sm:col-span-2')}>
      {control}
    </Field>
  );
}

/** Values of custom fields for detail pages. */
export function AttributeList({ fields, attributes, emptyText = 'No specifications recorded.' }: { fields: FieldDefinition[]; attributes: Attributes; emptyText?: string }) {
  if (!fields.length) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2">
      {fields.map((f) => {
        const v = attributes[f.key];
        const text = f.type === 'date' && typeof v === 'string' ? formatDate(v) : formatAttributeValue(f, v);
        return (
          <div key={f.key} className={cn('min-w-0', f.type === 'textarea' && 'sm:col-span-2')}>
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className={cn('mt-0.5 break-words text-sm', text === '—' && 'text-muted-foreground')}>
              {f.type === 'url' && typeof v === 'string' ? (
                <a href={v} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                  {v}
                </a>
              ) : (
                text
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Turns stored attributes into form values (numbers/booleans kept, missing keys blank). */
export function attributesToForm(fields: FieldDefinition[], attributes: Attributes = {}) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = attributes[f.key];
    if (f.type === 'boolean') out[f.key] = v === true;
    else if (f.type === 'multiselect') out[f.key] = Array.isArray(v) ? v : [];
    else out[f.key] = v === undefined || v === null ? '' : v;
  }
  return out;
}
