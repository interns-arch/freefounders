/** /tasks/forms/:formId — the builder: status and share link, details & integrations, the fields. */
import { errorMessage, useAccess } from '@freefounders/core';
import {
  FORM_FIELD_TYPES,
  FORM_FIELD_TYPES_WITH_OPTIONS,
  FORM_LEAD_ATTRS,
  type FormField,
  type FormFieldType,
  type WebForm,
  type WebFormPatch,
  publicFormUrl,
  useAddFormField,
  useFormAction,
  usePatchForm,
  usePatchFormField,
  useRemoveFormField,
  useReorderFormFields,
  useTaskDepartments,
  useWebForm,
} from '@freefounders/core/tasks';
import { ArrowDown, ArrowUp, Copy, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useConfirm } from '@/components/common/confirm';
import { ErrorState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { Checkbox, Skeleton, Switch } from '@/components/ui/primitives';
import { Chip, ErrorNote, OkNote, Panel } from '../general/parts';
import { FORM_STATUS_TONE } from './page';

export function FormBuilderPage() {
  const { formId } = useParams();
  const id = Number(formId);
  const q = useWebForm(Number.isFinite(id) ? id : null);
  const companyId = useAccess().claims?.cid;
  const action = useFormAction();
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const note = (e: unknown) => {
    setOk('');
    setErr(errorMessage(e));
  };
  const run = (a: 'publish' | 'close' | 'reopen') =>
    action.mutate(
      { id, action: a },
      {
        onSuccess: () => {
          setErr('');
          setOk(a === 'close' ? 'The form is closed: the link no longer accepts submissions.' : 'The form is live: anyone with the link can submit.');
        },
        onError: note,
      },
    );

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64" />;
  const form = q.data;
  const shareUrl = publicFormUrl(window.location.origin, form.public_token, companyId);

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        className="mb-0"
        title={form.name}
        breadcrumb={[
          { label: 'Forms', to: '/tasks/forms' },
          { label: 'My forms', to: '/tasks/forms?view=manage' },
        ]}
        actions={
          <>
            <Chip tone={FORM_STATUS_TONE[form.status] ?? 'neutral'}>{form.status_display}</Chip>
            {form.status !== 'published' && (
              <Button size="sm" loading={action.isPending} onClick={() => run(form.status === 'closed' ? 'reopen' : 'publish')}>
                {form.status === 'closed' ? 'Reopen' : 'Publish'}
              </Button>
            )}
            {form.status === 'published' && (
              <Button size="sm" variant="outline" loading={action.isPending} onClick={() => run('close')}>
                Disable
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link to={`/tasks/forms/${form.id}/submissions`}>Submissions ({form.submission_count})</Link>
            </Button>
          </>
        }
      />
      <ErrorNote>{err}</ErrorNote>
      <OkNote>{ok}</OkNote>
      {form.status === 'published' && <ShareLink url={shareUrl} />}
      <Details form={form} onError={note} />
      <Fields form={form} onError={note} />
    </div>
  );
}

function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Panel title="Share link" description="Anyone with this link can submit — no sign-in needed.">
      <div className="flex flex-wrap gap-2">
        <Input aria-label="Share link" readOnly value={url} className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button type="button" variant="outline" onClick={copy}>
          <Copy /> {copied ? 'Copied!' : 'Copy'}
        </Button>
        <Button asChild variant="outline">
          <a href={url} target="_blank" rel="noreferrer">
            Open
          </a>
        </Button>
      </div>
    </Panel>
  );
}

/** Name, description and the lead / task integrations. Text is saved when you leave the field. */
function Details({ form, onError }: { form: WebForm; onError: (e: unknown) => void }) {
  const depts = useTaskDepartments().data ?? [];
  const patch = usePatchForm();
  const [name, setName] = useState(form.name);
  const [description, setDescription] = useState(form.description);
  const [taskTitle, setTaskTitle] = useState(form.task_title);
  useEffect(() => {
    setName(form.name);
    setDescription(form.description);
    setTaskTitle(form.task_title);
  }, [form.name, form.description, form.task_title]);
  const save = (body: WebFormPatch) => patch.mutate({ id: form.id, ...body }, { onError });

  return (
    <Panel title="Details & integrations">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="fb-name">Name</Label>
          <Input id="fb-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== form.name && save({ name: name.trim() })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="fb-desc">Description</Label>
          <Textarea id="fb-desc" rows={2} className="min-h-9" value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => description !== form.description && save({ description })} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={form.create_lead} onCheckedChange={(v) => save({ create_lead: v })} aria-label="Create a lead on submission" />
          Create a lead on submission (auto-assigned)
        </label>
        {form.create_lead && (
          <div className="grid gap-1.5">
            <Label htmlFor="fb-dept">Lead department</Label>
            <NativeSelect id="fb-dept" value={form.lead_department} onChange={(e) => save({ lead_department: e.target.value })}>
              {!depts.some((d) => d.code === form.lead_department) && <option value={form.lead_department}>{form.lead_department || 'Pick…'}</option>}
              {depts.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={form.create_task} onCheckedChange={(v) => save({ create_task: v })} aria-label="Create a follow-up task on submission" />
          Create a follow-up task on submission
        </label>
        {form.create_task && (
          <div className="grid gap-1.5">
            <Label htmlFor="fb-task">Task title</Label>
            <Input id="fb-task" value={taskTitle} placeholder={`Follow up: ${form.name}`} onChange={(e) => setTaskTitle(e.target.value)} onBlur={() => taskTitle !== form.task_title && save({ task_title: taskTitle })} />
          </div>
        )}
      </div>
      {form.create_lead && <p className="mt-3 text-xs text-muted-foreground">Map fields to lead attributes below ("Maps to") so submissions fill the lead's name, phone, requirement…</p>}
      {patch.isPending && <p className="mt-2 text-xs text-muted-foreground">Saving…</p>}
    </Panel>
  );
}

const typeLabel = (t: FormFieldType) => FORM_FIELD_TYPES.find(([v]) => v === t)?.[1] ?? t;
const leadLabel = (a: string) => FORM_LEAD_ATTRS.find(([v]) => v === a)?.[1] ?? a;

function Fields({ form, onError }: { form: WebForm; onError: (e: unknown) => void }) {
  const add = useAddFormField();
  const patchField = usePatchFormField();
  const removeField = useRemoveFormField();
  const reorder = useReorderFormFields();
  const confirm = useConfirm();
  const [f, setF] = useState({ label: '', type: 'short_text' as FormFieldType, required: false, options: '', lead_attr: '' });
  const needsOptions = FORM_FIELD_TYPES_WITH_OPTIONS.includes(f.type);
  const busy = add.isPending || patchField.isPending || removeField.isPending || reorder.isPending;

  const addField = (e: React.FormEvent) => {
    e.preventDefault();
    add.mutate(
      {
        formId: form.id,
        label: f.label.trim(),
        type: f.type,
        required: f.required,
        lead_attr: f.lead_attr,
        options: needsOptions
          ? f.options
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      },
      { onSuccess: () => setF({ label: '', type: 'short_text', required: false, options: '', lead_attr: '' }), onError },
    );
  };
  const move = (idx: number, dir: -1 | 1) => {
    const ids = form.fields.map((x) => x.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    reorder.mutate({ formId: form.id, order: ids }, { onError });
  };
  const remove = async (field: FormField) => {
    const r = await confirm({ title: `Remove the field "${field.label}"?`, description: 'Earlier submissions keep their answers; new ones will not ask it.', confirmText: 'Remove', destructive: true });
    if (r.confirmed) removeField.mutate(field.id, { onError });
  };

  return (
    <Panel title={`Fields (${form.fields.length})`}>
      {form.fields.length === 0 && <p className="mb-3 text-sm text-muted-foreground">No fields yet — add the first one below. Publishing needs at least one field.</p>}
      <ul className="space-y-2" aria-label="Fields">
        {form.fields.map((field, idx) => (
          <li key={field.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <strong>{field.label}</strong>
                <Chip>{typeLabel(field.type)}</Chip>
                {field.required && <Chip tone="warning">required</Chip>}
                {field.lead_attr && <Chip tone="primary">→ {leadLabel(field.lead_attr)}</Chip>}
              </div>
              {field.options.length > 0 && <div className="text-xs text-muted-foreground">{field.options.join(' · ')}</div>}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <NativeSelect aria-label={`${field.label} maps to lead attribute`} className="h-7 w-auto text-xs" value={field.lead_attr} onChange={(e) => patchField.mutate({ id: field.id, lead_attr: e.target.value }, { onError })}>
                {FORM_LEAD_ATTRS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {v ? `→ ${l}` : 'Maps to…'}
                  </option>
                ))}
              </NativeSelect>
              <Button size="xs" variant="outline" disabled={busy} aria-label={`${field.required ? 'Make optional' : 'Require'}: ${field.label}`} onClick={() => patchField.mutate({ id: field.id, required: !field.required }, { onError })}>
                {field.required ? 'Optional' : 'Require'}
              </Button>
              <Button size="icon-xs" variant="ghost" disabled={busy || idx === 0} aria-label={`Move up: ${field.label}`} onClick={() => move(idx, -1)}>
                <ArrowUp />
              </Button>
              <Button size="icon-xs" variant="ghost" disabled={busy || idx === form.fields.length - 1} aria-label={`Move down: ${field.label}`} onClick={() => move(idx, 1)}>
                <ArrowDown />
              </Button>
              <Button size="icon-xs" variant="ghost" disabled={busy} aria-label={`Remove: ${field.label}`} onClick={() => remove(field)}>
                <X />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={addField} className="mt-4 grid gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="ff-label">Field label *</Label>
          <Input id="ff-label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ff-type">Type</Label>
          <NativeSelect id="ff-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as FormFieldType })}>
            {FORM_FIELD_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        {needsOptions && (
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="ff-options">Options (comma-separated) *</Label>
            <Input id="ff-options" value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} placeholder="Option A, Option B, Option C" />
          </div>
        )}
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <Checkbox checked={f.required} onCheckedChange={(v) => setF({ ...f, required: v === true })} aria-label="Required" />
          Required
        </label>
        <div className="grid gap-1.5">
          <Label htmlFor="ff-lead">Maps to (lead)</Label>
          <NativeSelect id="ff-lead" value={f.lead_attr} onChange={(e) => setF({ ...f, lead_attr: e.target.value })}>
            {FORM_LEAD_ATTRS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={!f.label.trim() || (needsOptions && !f.options.trim())} loading={add.isPending}>
            <Plus /> Add field
          </Button>
        </div>
      </form>
    </Panel>
  );
}
