/**
 * Settings → Integrations (PLAN.md §19.40), Owner / Admin: the company's WhatsApp, Gmail and AI values. Secrets are
 * write-only: shown masked with Replace / Remove, never sent back in full. Every change is recorded (who, when).
 */
import { errorMessage } from '@kaampilot/core';
import { type IntegrationField, type IntegrationGroup, useIntegrations, useSaveIntegrations } from '@kaampilot/core/admin';
import { useState } from 'react';
import { ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton, Switch } from '@/components/ui/primitives';
import { ErrorNote } from './parts';

export function IntegrationsCard() {
  const q = useIntegrations();
  return (
    <Card role="region" aria-labelledby="integrations">
      <CardHeader className="flex-col gap-1">
        <CardTitle id="integrations" className="text-base">
          Integrations
        </CardTitle>
        <CardDescription>Your own WhatsApp, Gmail and AI keys. Keys are stored encrypted and never shown again in full; each change is recorded.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton className="h-40" /> : q.data.groups.map((g) => <GroupSection key={g.key} group={g} />)}
      </CardContent>
    </Card>
  );
}

function GroupSection({ group }: { group: IntegrationGroup }) {
  return (
    <section aria-labelledby={`int-${group.key}`} className="grid gap-3 rounded-lg border p-4">
      <div>
        <h3 id={`int-${group.key}`} className="text-sm font-bold">
          {group.label}
        </h3>
        <p className="text-xs text-muted-foreground">{group.description}</p>
      </div>
      <div className="grid gap-3">
        {group.fields.map((f) => (
          <FieldRow key={f.key} field={f} />
        ))}
      </div>
    </section>
  );
}

function changedText(f: IntegrationField): string {
  if (!f.changed) return f.source === 'server' ? 'Set on the server' : '';
  const when = new Date(f.changed.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${f.changed.action === 'removed' ? 'Removed' : 'Changed'} by ${f.changed.by}, ${when}`;
}

function FieldRow({ field: f }: { field: IntegrationField }) {
  const save = useSaveIntegrations();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(f.value ?? '');
  const id = `int-${f.key}`;
  const put = (value: string | null, after?: () => void) => save.mutate({ [f.key]: value }, { onSuccess: after });
  const note = changedText(f);

  if (f.kind === 'bool') {
    return (
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={id} className="text-sm">
            {f.label}
          </Label>
          <Switch id={id} checked={f.value === 'true'} disabled={save.isPending} onCheckedChange={(v) => put(v ? 'true' : 'false')} />
        </div>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
      </div>
    );
  }

  if (f.kind === 'secret') {
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={id} className="text-sm">
          {f.label}
        </Label>
        {editing ? (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim())
                put(text.trim(), () => {
                  setEditing(false);
                  setText('');
                });
            }}
          >
            <Input id={id} type="password" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} className="min-w-56 flex-1" placeholder="Paste the new value" />
            <Button type="submit" size="sm" disabled={!text.trim()} loading={save.isPending}>
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(false);
                setText('');
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span id={id} className="min-w-24 font-mono text-sm text-muted-foreground">
              {f.set ? f.masked : 'Not set'}
            </span>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} aria-label={`${f.set ? 'Replace' : 'Add'} ${f.label}`}>
              {f.set ? 'Replace' : 'Add'}
            </Button>
            {f.source === 'company' && (
              <Button size="sm" variant="outline" onClick={() => put(null)} disabled={save.isPending} aria-label={`Remove ${f.label}`}>
                Remove
              </Button>
            )}
          </div>
        )}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
      </div>
    );
  }

  const dirty = text.trim() !== (f.value ?? '');
  return (
    <form
      className="grid gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        put(text.trim() || null);
      }}
    >
      <Label htmlFor={id} className="text-sm">
        {f.label}
      </Label>
      <div className="flex flex-wrap gap-2">
        <Input id={id} value={text} onChange={(e) => setText(e.target.value)} className="min-w-56 flex-1" placeholder={f.source === 'server' ? 'Set on the server' : ''} />
        <Button type="submit" size="sm" variant="outline" disabled={!dirty} loading={save.isPending}>
          Save
        </Button>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
    </form>
  );
}
