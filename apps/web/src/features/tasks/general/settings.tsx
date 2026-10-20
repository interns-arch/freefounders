/**
 * /tasks/settings — Task settings (old pages/Settings.jsx "Automation Settings"): completion evidence, departments
 * (read-only: the Platform owns them now, PLAN.md §17.1), task categories with pending approvals, lead assignment
 * rules (module leads) and the notification rules matrix (PLAN.md §16.5).
 */
import { errorMessage, useAccess } from '@freefounders/core';
import {
  type AssignmentRule,
  type ManagedCategory,
  type PersonOption,
  useAddTaskCategory,
  useAssignmentRules,
  useCategoryAdmin,
  useDecideTaskCategory,
  useNotificationRules,
  useRemoveTaskCategory,
  useSaveAssignmentRule,
  useSetNotificationRule,
  useSetWhatsappHours,
  useSetTaskSetting,
  useTaskDepartments,
  useTaskSettings,
  useTeamPeople,
  useWhatsappHours,
} from '@freefounders/core/tasks';
import { ArrowDown, ArrowUp, ExternalLink, X } from '@/components/icons';
import { useState } from 'react';
import { Link } from 'react-router';
import { useConfirm } from '@/components/common/confirm';
import { PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Checkbox, Skeleton, Switch } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Chip, ErrorNote, Panel } from './parts';

export function TaskSettingsPage() {
  const access = useAccess();
  const can = access.tasks.can;
  const leads = access.tasks.module('leads') && can('leads.rules');
  const [err, setErr] = useState('');
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader className="mb-0" title="Task settings" description="How tasks are completed, categorised and announced." />
      <ErrorNote>{err}</ErrorNote>
      {/* Each section follows its own permission (PLAN.md §19.19). */}
      {can('tasks.settings') && <CompletionEvidence onError={setErr} />}
      {can('settings.manage') && <Departments />}
      {can('tasks.assign') && <Categories onError={setErr} />}
      {can('tasks.settings') && <NotificationRules onError={setErr} />}
      {can('tasks.settings') && <WhatsappHours onError={setErr} />}
      {leads && <AssignmentRules onError={setErr} />}
    </div>
  );
}

function CompletionEvidence({ onError }: { onError: (m: string) => void }) {
  const q = useTaskSettings();
  const set = useSetTaskSetting();
  const cfg = q.data;
  return (
    <Panel title="Task completion evidence" description="Force proof-of-work when someone completes a task — stops the “just keeps ticking it daily” problem.">
      {!cfg ? (
        <Skeleton className="h-10" />
      ) : (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
          <span className="text-muted-foreground">
            ✓ Completion description: <strong className="text-foreground">always required</strong> (company rule, not a switch)
          </span>
          <label className="flex cursor-pointer items-center gap-2">
            <Switch
              checked={cfg.require_completion_attachment}
              disabled={set.isPending}
              onCheckedChange={(on) => {
                onError('');
                set.mutate({ require_completion_attachment: on }, { onError: (e) => onError(errorMessage(e)) });
              }}
            />
            File / photo proof required
          </label>
        </div>
      )}
    </Panel>
  );
}

/** The department list every dropdown reads. Owned by the Platform's People directory now: shown read-only. */
function Departments() {
  const rows = useTaskDepartments().data;
  return (
    <Panel
      title="Departments"
      description="Every department dropdown reads this list. It comes from the company’s People directory, so departments are added, renamed and removed in Settings."
      actions={
        <Button asChild size="sm" variant="outline">
          <Link to="/settings">
            Manage departments in Settings <ExternalLink />
          </Link>
        </Button>
      }
    >
      {!rows ? (
        <Skeleton className="h-10" />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {rows.map((d) => (
            <Chip key={d.code} tone={d.active ? 'neutral' : 'warning'} title={`Code: ${d.code}`}>
              {d.name}
            </Chip>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Categories({ onError }: { onError: (m: string) => void }) {
  const depts = useTaskDepartments().data ?? [];
  const { list, pending } = useCategoryAdmin();
  const add = useAddTaskCategory();
  const remove = useRemoveTaskCategory();
  const decide = useDecideTaskCategory();
  const confirm = useConfirm();
  const [f, setF] = useState({ name: '', department: '' });
  const fail = (e: unknown) => onError(errorMessage(e));

  const doDecide = async (c: ManagedCategory, verdict: 'approve' | 'reject') => {
    onError('');
    let remarks = '';
    if (verdict === 'reject') {
      const r = await confirm({ title: `Why not add "${c.name}"?`, note: { label: 'Reason (optional — the requester sees this)' }, confirmText: 'Reject', destructive: true });
      if (!r.confirmed) return;
      remarks = r.note;
    }
    decide.mutate({ id: c.id, verdict, remarks }, { onError: fail });
  };

  return (
    <Panel
      title="Task categories"
      description="The dropdown employees pick from (managers can also add one while creating a task). Deleting hides a category from the dropdown — existing tasks keep their history; adding the name again brings it back."
    >
      {(pending.data?.length ?? 0) > 0 && (
        <div className="mb-4 rounded-lg border border-warning/35 bg-warning/8 p-3">
          <strong className="text-sm">Requests waiting for you ({pending.data!.length})</strong>
          <Table className="mt-2">
            <THead>
              <TR>
                <TH>Category</TH>
                <TH>Asked by</TH>
                <TH>Department</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {pending.data!.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">{c.name}</TD>
                  <TD>{c.requested_by_name || '—'}</TD>
                  <TD>{c.department_display || 'General'}</TD>
                  <TD>
                    <div className="flex justify-end gap-1.5">
                      <Button size="xs" aria-label={`Approve ${c.name}`} onClick={() => doDecide(c, 'approve')}>
                        Approve
                      </Button>
                      <Button size="xs" variant="outline" aria-label={`Reject ${c.name}`} onClick={() => doDecide(c, 'reject')}>
                        Reject
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onError('');
          add.mutate(f, { onSuccess: () => setF({ name: '', department: '' }), onError: fail });
        }}
      >
        <div className="grid min-w-48 flex-1 gap-1.5">
          <Label htmlFor="cat-name">New category name</Label>
          <Input id="cat-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cat-dept">Department</Label>
          <NativeSelect id="cat-dept" className="w-auto" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>
            <option value="">General (all departments)</option>
            {depts.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" disabled={!f.name.trim()} loading={add.isPending}>
          Add
        </Button>
      </form>
      {!list.data ? (
        <Skeleton className="h-24" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Category</TH>
              <TH>Department</TH>
              <TH>Tasks</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {list.data.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium">{c.name}</TD>
                <TD>{c.department_display || 'General'}</TD>
                <TD>{c.task_count ?? 0}</TD>
                <TD className="text-right">
                  <Button size="xs" variant="outline" aria-label={`Delete ${c.name}`} onClick={() => remove.mutate(c.id, { onError: fail })}>
                    Delete
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}

/** Which kinds of event also go out by email / WhatsApp (PLAN.md §16.5). In-app is always on. */
function NotificationRules({ onError }: { onError: (m: string) => void }) {
  const q = useNotificationRules();
  const set = useSetNotificationRule();
  const busy = set.isPending ? `${set.variables?.key}.${set.variables?.channel}` : '';
  return (
    <section aria-labelledby="notif-rules">
      <Panel title={<span id="notif-rules">Notifications</span>} description="Everyone always sees notifications in the app. Choose which ones are also sent by email or WhatsApp.">
        {q.error && <ErrorNote>{errorMessage(q.error)}</ErrorNote>}
        {!q.data ? (
          <Skeleton className="h-40" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH className="w-20 text-center">Email</TH>
                <TH className="w-20 text-center">WhatsApp</TH>
              </TR>
            </THead>
            <TBody>
              {q.data.map((r) => (
                <TR key={r.key}>
                  <TD>{r.label}</TD>
                  {(['email', 'whatsapp'] as const).map((c) => (
                    <TD key={c} className="text-center">
                      <Checkbox
                        aria-label={`${c === 'email' ? 'Email' : 'WhatsApp'}: ${r.label}`}
                        checked={r[c]}
                        disabled={busy === `${r.key}.${c}`}
                        onCheckedChange={(on) => {
                          onError('');
                          set.mutate({ key: r.key, channel: c, on: on === true }, { onError: (e) => onError(errorMessage(e)) });
                        }}
                      />
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </section>
  );
}

const HOURS = Array.from({ length: 25 }, (_, h) => h);
const hourLabel = (h: number) => (h === 0 ? '12 AM (midnight)' : h === 24 ? '12 AM (end of day)' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`);

/**
 * WhatsApp only inside the company's hours (original app d40034c; default 10 AM – 7 PM). Outside them the in-app note and
 * email still go at once; the WhatsApp waits for the opening, and the repeating overdue reminders are skipped.
 */
function WhatsappHours({ onError }: { onError: (m: string) => void }) {
  const q = useWhatsappHours();
  const save = useSetWhatsappHours();
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);
  const v = draft ?? q.data;
  const changed = !!draft && !!q.data && (draft.start !== q.data.start || draft.end !== q.data.end);
  const bad = !!v && v.start >= v.end;
  return (
    <Panel title="WhatsApp hours" description="WhatsApp messages go out only between these times. Anything outside them is held and sent when they open; in-app and email are never held.">
      {q.error && <ErrorNote>{errorMessage(q.error)}</ErrorNote>}
      {!v ? (
        <Skeleton className="h-10" />
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          {(['start', 'end'] as const).map((k) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`wa-hours-${k}`}>{k === 'start' ? 'From' : 'Until'}</Label>
              <NativeSelect id={`wa-hours-${k}`} className="w-auto min-w-40" value={v[k]} onChange={(e) => setDraft({ ...v, [k]: Number(e.target.value) })}>
                {HOURS.filter((h) => (k === 'start' ? h < 24 : h > 0)).map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ))}
          <Button
            disabled={!changed || bad}
            loading={save.isPending}
            onClick={() => {
              onError('');
              if (v) save.mutate(v, { onSuccess: () => setDraft(null), onError: (e) => onError(errorMessage(e)) });
            }}
          >
            Save hours
          </Button>
          {bad && <span className="text-sm text-destructive">“From” must be before “Until”.</span>}
        </div>
      )}
    </Panel>
  );
}

/** Lead auto-assignment: when a lead arrives without an owner, its department's rule picks one. */
function AssignmentRules({ onError }: { onError: (m: string) => void }) {
  const depts = useTaskDepartments().data ?? [];
  const rules = useAssignmentRules(true);
  const team = useTeamPeople().data ?? [];
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Lead assignment rules</h2>
        <p className="text-[13px] text-muted-foreground">
          When a new lead arrives without an assignee (manual entry, or WhatsApp/Gmail/AI intake), the rule for its department picks the owner.
        </p>
      </div>
      {rules.error && <ErrorNote>{errorMessage(rules.error)}</ErrorNote>}
      {depts.map((d) => (
        <RuleCard key={d.code} dept={d.code} label={d.name} rule={rules.data?.find((r) => r.department === d.code)} team={team} onError={onError} />
      ))}
    </section>
  );
}

function RuleCard({ dept, label, rule, team, onError }: { dept: string; label: string; rule?: AssignmentRule; team: PersonOption[]; onError: (m: string) => void }) {
  const save = useSaveAssignmentRule();
  const members = rule?.members_detail ?? [];
  const memberIds = rule?.member_ids ?? [];
  const available = team.filter((t) => !memberIds.includes(t.id));
  const put = (body: Parameters<typeof save.mutate>[0]['body']) => {
    onError('');
    save.mutate({ rule, department: dept, body }, { onError: (e) => onError(errorMessage(e)) });
  };
  const move = (idx: number, dir: number) => {
    const next = [...memberIds];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    put({ member_ids: next });
  };
  return (
    <Panel
      title={label}
      actions={
        <>
          {rule && (
            <label className="flex items-center gap-2 text-sm">
              <Switch aria-label={`${label} rule active`} checked={rule.active} onCheckedChange={(on) => put({ active: on })} />
              {rule.active ? 'Active' : 'Off'}
            </label>
          )}
          <NativeSelect aria-label={`${label} strategy`} className="h-8 w-auto" value={rule?.strategy ?? 'round_robin'} onChange={(e) => put({ strategy: e.target.value as AssignmentRule['strategy'] })}>
            <option value="round_robin">Round robin</option>
            <option value="fixed">Fixed (first member)</option>
          </NativeSelect>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {members.length === 0 && <span className="text-sm text-muted-foreground">No members — leads stay unassigned.</span>}
        {members.map((m, i) => (
          <span key={m.id} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-1 pl-2 text-sm">
            <em className="text-xs text-muted-foreground not-italic">{i + 1}</em> {m.name}
            <Button size="icon-xs" variant="ghost" aria-label={`Move ${m.name} up`} onClick={() => move(i, -1)}>
              <ArrowUp />
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label={`Move ${m.name} down`} onClick={() => move(i, 1)}>
              <ArrowDown />
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove ${m.name}`} onClick={() => put({ member_ids: memberIds.filter((id) => id !== m.id) })}>
              <X />
            </Button>
          </span>
        ))}
        <NativeSelect
          aria-label={`Add member to ${label}`}
          className="h-8 w-auto"
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) put({ member_ids: [...memberIds, id] });
          }}
        >
          <option value="">+ Add member…</option>
          {available.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {rule?.strategy === 'round_robin' && members.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Next in rotation: <strong>{members[rule.rr_index % members.length]?.name}</strong>
        </p>
      )}
    </Panel>
  );
}
