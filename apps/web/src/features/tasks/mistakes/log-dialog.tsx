/** "Log a mistake": for yourself, or for someone else (mistakes.log). mistakes.settings can add a category on the spot. */
import { errorMessage, useAccess } from '@freefounders/core';
import { MISTAKE_SEVERITIES, type Mistake, type MistakeSeverity, useAddMistakeCategory, useLogMistake, useMistakeCategories, useSops, useTaskAssignees } from '@freefounders/core/tasks';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { ProofreadText } from '../shared/proofread-text';
import { ErrorNote } from '../general/parts';

export function LogMistakeDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (m: Mistake) => void }) {
  const access = useAccess();
  const me = access.tasks.me;
  const canLogOthers = access.tasks.can('mistakes.log');
  const canAddCategory = access.tasks.can('mistakes.settings');
  const team = useTaskAssignees().data ?? [];
  const cats = useMistakeCategories();
  const sops = useSops().data ?? [];
  const log = useLogMistake();
  const addCat = useAddMistakeCategory();
  const [f, setF] = useState({ employee: String(me?.id ?? ''), category: '', severity: 'medium' as MistakeSeverity, description: '', impact: '', financial_loss: '', sop_name: '' });
  const [newCat, setNewCat] = useState<string | null>(null);
  const [catErr, setCatErr] = useState('');
  // Me first, then the team (the picker may not list the signed-in person).
  const people = me && !team.some((p) => p.id === me.id) ? [{ id: me.id, name: `${me.first_name} ${me.last_name}`.trim() || me.username }, ...team] : team;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    log.mutate(
      {
        employee: Number(f.employee),
        category: f.category,
        severity: f.severity,
        description: f.description.trim(),
        impact: f.impact.trim(),
        financial_loss: f.financial_loss ? Number(f.financial_loss) : null,
        sop_name: f.sop_name.trim(),
      },
      { onSuccess: onSaved },
    );
  };
  const saveCategory = () => {
    const name = (newCat ?? '').trim();
    if (!name) return;
    setCatErr('');
    addCat.mutate(name, {
      onSuccess: (c) => {
        setNewCat(null);
        setF((p) => ({ ...p, category: c.name }));
      },
      onError: (e) => setCatErr(errorMessage(e)),
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Log a mistake</DialogTitle>
        <DialogDescription>Recording is the first step of fixing — this is about the process as much as the person.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="lm-emp">Employee *</Label>
          {canLogOthers ? (
            <NativeSelect id="lm-emp" value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <Input id="lm-emp" value={me?.first_name || me?.username || ''} disabled />
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lm-cat">Category *</Label>
          {newCat === null ? (
            <div className="flex gap-1.5">
              <NativeSelect id="lm-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                <option value="">— pick —</option>
                {(cats.data ?? []).map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              {canAddCategory && (
                <Button type="button" variant="outline" size="icon" aria-label="Add a category" title="Add a category" onClick={() => setNewCat('')}>
                  <Plus />
                </Button>
              )}
            </div>
          ) : (
            <div className="flex gap-1.5">
              <Input id="lm-cat" aria-label="New category name" placeholder="New category name" value={newCat} autoFocus onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), saveCategory())} />
              <Button type="button" size="sm" loading={addCat.isPending} disabled={!newCat.trim()} onClick={saveCategory}>
                Add
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setNewCat(null)}>
                Cancel
              </Button>
            </div>
          )}
          {catErr && <p className="text-xs text-destructive">{catErr}</p>}
          {cats.data?.length === 0 && newCat === null && <p className="text-xs text-muted-foreground">{canAddCategory ? 'No categories yet — add the first one.' : 'No categories yet. Ask an admin to add them.'}</p>}
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="lm-sev">Severity *</Label>
          <NativeSelect id="lm-sev" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as MistakeSeverity })}>
            {MISTAKE_SEVERITIES.map(([v, l, hint]) => (
              <option key={v} value={v}>
                {l} — {hint}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="sm:col-span-2">
          <ProofreadText id="lm-desc" label="What happened?" required rows={3} value={f.description} onChange={(v) => setF({ ...f, description: v })} placeholder="e.g. Wrong Hyundai part ordered for customer XYZ" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lm-impact">Impact</Label>
          <Input id="lm-impact" value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value })} placeholder="time loss / delay / customer anger…" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lm-loss">Financial loss (₹)</Label>
          <Input id="lm-loss" type="number" min={0} step="0.01" value={f.financial_loss} onChange={(e) => setF({ ...f, financial_loss: e.target.value })} placeholder="optional" />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="lm-sop">Related SOP (if known)</Label>
          <Input id="lm-sop" list="lm-sop-list" value={f.sop_name} onChange={(e) => setF({ ...f, sop_name: e.target.value })} placeholder="optional" />
          <datalist id="lm-sop-list">
            {sops.map((s) => (
              <option key={s.id} value={s.title} />
            ))}
          </datalist>
        </div>
      </div>
      {log.error && <ErrorNote>{errorMessage(log.error)}</ErrorNote>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={log.isPending} disabled={!f.category || !f.description.trim() || !f.employee}>
          Log mistake
        </Button>
      </DialogFooter>
    </form>
  );
}
