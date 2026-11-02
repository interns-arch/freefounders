/**
 * Visitors → Settings → API access (PLAN.md §22.12): keys for the read-only Vehicle API. Owner / Admin only (the server
 * checks; `can.api_keys` only decides whether this card shows). The full key is shown once, when it is made.
 */
import { errorMessage } from '@kaampilot/core';
import { type VehicleApiKey, useCreateVehicleApiKey, useRevokeVehicleApiKey, useVehicleApiKeys } from '@kaampilot/core/visitors';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Copy, ExternalLink, KeyRound, Trash2 } from '@/components/icons';
import { useConfirm } from '@/components/common/confirm';
import { Field } from '@/components/common/form';
import { ErrorState, PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { clock } from './parts';

const GUIDE = '/docs/vehicle-api.txt';
const STATE: Record<VehicleApiKey['state'], { label: string; tone: 'green' | 'red' | 'neutral' }> = {
  active: { label: 'Active', tone: 'green' },
  expired: { label: 'Expired', tone: 'neutral' },
  revoked: { label: 'Revoked', tone: 'red' },
};

const copy = (text: string, done: string) =>
  void navigator.clipboard?.writeText(text).then(
    () => toast.success(done),
    () => toast.error('Copy it from the text on the screen'),
  );

const curlExample = (key: string) => `curl -H "Authorization: Bearer ${key}" "${window.location.origin}/tasks/api/visitors/v1/vehicles/?page_size=50"`;

export function ApiAccessCard() {
  const keys = useVehicleApiKeys();
  const create = useCreateVehicleApiKey();
  const revoke = useRevokeVehicleApiKey();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [expires, setExpires] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [made, setMade] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await create.mutateAsync({ name, expires_at: expires || null });
      setMade(res.key);
      setName('');
      setExpires('');
      setErrors({});
    } catch (err) {
      setErrors((err as { errors?: Record<string, string> }).errors ?? {});
      toast.error(errorMessage(err));
    }
  };
  const drop = async (k: VehicleApiKey) => {
    const r = await confirm({
      title: `Revoke the key for ${k.name}?`,
      description: 'Anything using this key stops working at once. This cannot be undone; you can make a new key.',
      confirmText: 'Revoke key',
      destructive: true,
    });
    if (!r.confirmed) return;
    try {
      await revoke.mutateAsync(k.id);
      toast.success('Key revoked');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Card data-testid="api-access">
      <CardHeader>
        <CardTitle>API access</CardTitle>
        <CardDescription>
          Give another system, or a senior manager’s IT person, read-only access to the vehicle register: every vehicle in and out, drivers’ numbers and photos included. A key cannot change anything. Treat it like a password.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => copy(curlExample(made ?? 'YOUR_API_KEY'), 'Curl example copied')}>
            <Copy /> Copy curl example
          </Button>
          <Button variant="outline" asChild>
            <a href={GUIDE} target="_blank" rel="noreferrer">
              <ExternalLink /> API guide
            </a>
          </Button>
        </div>

        {made && (
          <div className="space-y-2 rounded-md border border-warning p-3" role="alert" data-testid="api-key-once">
            <p className="font-medium text-warning">Copy this key now. It is shown only this once and cannot be seen again.</p>
            <p className="font-mono text-[13px] break-all" data-testid="api-key-value">
              {made}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => copy(made, 'Key copied')}>
                <Copy /> Copy key
              </Button>
              <Button variant="ghost" onClick={() => setMade(null)}>
                I have saved it
              </Button>
            </div>
          </div>
        )}

        <form onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-start">
          <Field label="Who is this key for?" error={errors.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Senior manager" />
          </Field>
          <Field label="Stops working after" hint="Optional" error={errors.expires_at}>
            <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
          <Button type="submit" variant="outline" loading={create.isPending} className="sm:mt-6">
            <KeyRound /> Make a key
          </Button>
        </form>

        {keys.error ? (
          <ErrorState error={keys.error} onRetry={() => void keys.refetch()} />
        ) : !keys.data ? (
          <PageLoader />
        ) : keys.data.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No keys yet.</p>
        ) : (
          <ul className="divide-y">
            {keys.data.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-2" data-testid="api-key-row">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {k.name} <Badge tone={STATE[k.state].tone}>{STATE[k.state].label}</Badge>
                  </span>
                  <span className="block font-mono text-[13px] break-all">{k.hint}</span>
                  <span className="block text-[13px] text-muted-foreground">
                    Made {clock(k.created_at)}
                    {k.created_by ? ` by ${k.created_by}` : ''} · Last used {k.last_used_at ? clock(k.last_used_at) : 'never'}
                    {k.expires_at ? ` · Stops ${clock(k.expires_at)}` : ''}
                    {k.revoked_at ? ` · Revoked ${clock(k.revoked_at)}${k.revoked_by ? ` by ${k.revoked_by}` : ''}` : ''}
                  </span>
                </span>
                {k.state === 'active' && (
                  <Button size="sm" variant="ghost" onClick={() => void drop(k)} aria-label={`Revoke the key for ${k.name}`}>
                    <Trash2 /> Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
