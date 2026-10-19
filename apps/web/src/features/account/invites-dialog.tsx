/**
 * People & access → "Invite link" (PLAN.md §20.5 step 4, §21.1): a link with the role(s) and apps chosen, an expiry and
 * an optional use limit; copy it or share it on WhatsApp; the company's open links, each can be switched off.
 */
import { errorMessage, type AppKey } from '@freefounders/core';
import { inviteRoleName, type Invite, useCreateInvite, useInvites, useRevokeInvite } from '@freefounders/core/account';
import { APP_NAMES, MEMBER_ROLE, usePlatformApps, useRoles } from '@freefounders/core/admin';
import { Copy, Link2, MessageCircle, Trash2 } from '@/components/icons';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Checkbox } from '@/components/ui/primitives';
import { formatDate } from '@/lib/utils';

const absolute = (url: string) => {
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
};
const linkOf = (i: { url?: string; token?: string }) => (i.url ? absolute(i.url) : i.token ? absolute(`/join/${i.token}`) : '');
const appName = (a: AppKey) => (a === 'tasks' ? 'Attendance + Tasks' : APP_NAMES[a] ?? a);

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Link copied');
  } catch {
    toast.error('Couldn’t copy: select the link and copy it.');
  }
}

export function InvitesDialog({ open, onClose, companyName }: { open: boolean; onClose: () => void; companyName?: string }) {
  const roles = useRoles();
  const apps = usePlatformApps();
  const invites = useInvites(open);
  const create = useCreateInvite();
  const revoke = useRevokeInvite();
  const confirm = useConfirm();
  // null = not chosen yet: Member (PLAN.md §19.28); Admin and any other role can be ticked instead or as well.
  const [picked, setRoleIds] = useState<string[] | null>(null);
  const [chosenApps, setChosenApps] = useState<AppKey[] | null>(null);
  const [days, setDays] = useState('7');
  const [maxUses, setMaxUses] = useState('');
  const [made, setMade] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usable = (roles.data ?? []).filter((r) => !r.archived);
  const memberId = usable.find((r) => r.code === MEMBER_ROLE)?.id;
  const roleIds = picked ?? (memberId ? [memberId] : []);
  const appList = (apps.data ?? []).map((a) => a.app);
  const selectedApps = chosenApps ?? appList;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!roleIds.length) return setError('Choose at least one role.');
    if (maxUses && !(Number(maxUses) >= 1)) return setError('Max uses must be 1 or more, or blank for no limit.');
    setError(null);
    create.mutate(
      { roleIds, apps: selectedApps, expiresInDays: Number(days), maxUses: maxUses ? Number(maxUses) : null },
      { onSuccess: (r) => setMade(linkOf(r)), onError: (err) => setError(errorMessage(err)) },
    );
  };

  const switchOff = async (i: Invite) => {
    const ok = await confirm({ title: 'Switch off this link?', description: 'Nobody can join with it any more. People who already joined stay.', confirmText: 'Switch off', destructive: true });
    if (ok.confirmed) revoke.mutate(i.id, { onError: (err) => toast.error(errorMessage(err)) });
  };

  const live = (invites.data ?? []).filter((i) => (i.status ?? 'active') === 'active' && i.active !== false && !i.revoked && !i.revokedAt);
  const share = made ? `https://wa.me/?text=${encodeURIComponent(`Join ${companyName ?? 'us'} on FreeFounders: ${made}`)}` : '';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && (setMade(null), onClose())}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription>Anyone with the link joins {companyName ?? 'the company'} with the role you choose. They sign up with their mobile or email.</DialogDescription>
        </DialogHeader>

        {made ? (
          <div className="space-y-3">
            <Label htmlFor="invite-url">Invite link</Label>
            <div className="flex gap-2">
              <Input id="invite-url" readOnly value={made} className="font-mono text-[13px]" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" onClick={() => void copy(made)} aria-label="Copy link">
                <Copy />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <a href={share} target="_blank" rel="noreferrer">
                  <MessageCircle /> Share on WhatsApp
                </a>
              </Button>
              <Button variant="ghost" onClick={() => setMade(null)}>
                Make another link
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Role</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {usable.map((r) => (
                  <label key={r.id} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:border-primary/40">
                    <Checkbox checked={roleIds.includes(r.id)} onCheckedChange={(c) => setRoleIds(c === true ? [...roleIds, r.id] : roleIds.filter((y) => y !== r.id))} aria-label={r.name} />
                    <span className="truncate">{r.name}</span>
                  </label>
                ))}
                {roles.isLoading && <p className="text-sm text-muted-foreground">Loading roles…</p>}
              </div>
            </fieldset>
            {appList.length > 1 && (
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Apps</legend>
                <div className="flex flex-wrap gap-3">
                  {appList.map((a) => (
                    <label key={a} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedApps.includes(a)}
                        onCheckedChange={(c) => setChosenApps(c === true ? [...new Set([...selectedApps, a])] : selectedApps.filter((x) => x !== a))}
                        aria-label={appName(a)}
                      />
                      {appName(a)}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="invite-days">Link works for</Label>
                <NativeSelect id="invite-days" value={days} onChange={(e) => setDays(e.target.value)}>
                  <option value="1">1 day</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-max">Max people (optional)</Label>
                <Input id="invite-max" type="number" min={1} inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="No limit" />
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" loading={create.isPending} className="w-full">
              <Link2 /> Create invite link
            </Button>
          </form>
        )}

        <section aria-labelledby="open-links" className="mt-2 border-t pt-3">
          <h3 id="open-links" className="mb-2 text-sm font-semibold">
            Open links
          </h3>
          {invites.isError ? (
            <p className="text-sm text-muted-foreground">{errorMessage(invites.error)}</p>
          ) : live.length === 0 ? (
            <p className="text-sm text-muted-foreground">{invites.isLoading ? 'Loading…' : 'No open links.'}</p>
          ) : (
            <ul className="divide-y">
              {live.map((i) => (
                <li key={i.id} className="flex items-center gap-2 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{(i.roles ?? []).map(inviteRoleName).join(', ') || 'Invite'}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {i.apps.map(appName).join(' · ')}
                      {i.expiresAt && ` · until ${formatDate(i.expiresAt)}`}
                      {i.maxUses != null && ` · ${i.uses ?? 0}/${i.maxUses} used`}
                    </p>
                  </div>
                  {linkOf(i) && (
                    <Button variant="ghost" size="icon-sm" onClick={() => void copy(linkOf(i))} aria-label="Copy link">
                      <Copy />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon-sm" onClick={() => void switchOff(i)} aria-label="Switch off link">
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
