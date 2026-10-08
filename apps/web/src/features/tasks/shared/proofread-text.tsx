import { useProofread } from '@freefounders/core/tasks';
import { SpellCheck } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/input';

/**
 * A prose field (label + text box) with a "Check spelling" button and Undo. Used wherever someone writes a sentence:
 * task descriptions, completion remarks, review reasons…
 */
export function ProofreadText({
  label,
  value,
  onChange,
  rows = 3,
  required = false,
  placeholder = '',
  disabled = false,
  autoFocus = false,
  hint,
  id,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  hint?: string;
  id?: string;
}) {
  const auto = useId();
  const fieldId = id ?? auto;
  const proof = useProofread();
  const [before, setBefore] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const check = () => {
    const original = value;
    if (!original.trim()) return;
    setMsg('');
    setBefore(null);
    proof.mutate(original, {
      onSuccess: (r) => {
        if (r.changed) {
          onChange(r.text);
          setBefore(original);
          setMsg('Spelling and grammar fixed.');
        } else {
          setMsg(r.provider === 'rules' ? 'Spell check is unavailable right now — right-click a red word instead.' : 'Looks good, nothing to fix.');
        }
      },
      onError: () => setMsg('Could not check right now — right-click a red word instead.'),
    });
  };

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={fieldId}>
          {label}
          {required && <span className="text-destructive">*</span>}
        </Label>
        <Button type="button" variant="ghost" size="xs" onClick={check} loading={proof.isPending} disabled={disabled || !value.trim()} aria-label={`Check spelling: ${label}`} title="Check spelling">
          {!proof.isPending && <SpellCheck />}
          <span className="hidden sm:inline">Check spelling</span>
        </Button>
      </div>
      <Textarea
        id={fieldId}
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        spellCheck
        onChange={(e) => {
          onChange(e.target.value);
          setMsg('');
          setBefore(null);
        }}
      />
      {(msg || hint) && (
        <p className="text-xs text-muted-foreground">
          {msg || hint}
          {before !== null && (
            <button
              type="button"
              className="ml-2 cursor-pointer text-primary hover:underline"
              onClick={() => {
                onChange(before);
                setBefore(null);
                setMsg('');
              }}
            >
              Undo
            </button>
          )}
        </p>
      )}
    </div>
  );
}
