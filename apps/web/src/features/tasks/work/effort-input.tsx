import { useId } from 'react';
import { Input, Label, NativeSelect } from '@/components/ui/input';

export type EffortUnit = 'minutes' | 'hours';

/** A number typed in minutes or hours (the unit is a small dropdown beside it). */
export function EffortInput({
  label,
  hint,
  value,
  onChange,
  unit,
  onUnit,
  required,
  disabled,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  unit: EffortUnit;
  onUnit: (u: EffortUnit) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          step={unit === 'hours' ? 'any' : '1'}
          min={unit === 'hours' ? '0.1' : '1'}
          placeholder={placeholder ?? (unit === 'hours' ? 'e.g. 1.5' : 'e.g. 45')}
          className="flex-1"
        />
        <NativeSelect aria-label={`${label} unit`} value={unit} onChange={(e) => onUnit(e.target.value as EffortUnit)} disabled={disabled} className="w-24">
          <option value="minutes">min</option>
          <option value="hours">hours</option>
        </NativeSelect>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
