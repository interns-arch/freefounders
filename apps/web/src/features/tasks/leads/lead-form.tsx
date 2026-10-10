/** Add / edit lead dialog body (old LeadModal, now also used to change a lead's details). */
import { errorMessage, useAccess } from '@freefounders/core';
import {
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  type Lead,
  type LeadInput,
  type LeadPriority,
  type LeadSource,
  useCreateLead,
  useTaskDepartments,
  useTeamPeople,
  useUpdateLead,
} from '@freefounders/core/tasks';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/overlays';
import { ErrorNote } from '../general/parts';
import { toLocalInput } from '../shared/format';

export function LeadForm({ initial, onClose, onSaved }: { initial: Lead | null; onClose: () => void; onSaved?: (lead: Lead) => void }) {
  const access = useAccess();
  const me = access.tasks.me;
  const canAssign = access.tasks.can('leads.assign');
  const departments = (useTaskDepartments().data ?? []).filter((d) => d.active || d.code === initial?.department);
  const people = useTeamPeople().data ?? [];
  const create = useCreateLead();
  const update = useUpdateLead();
  const busy = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  // Execs land in their own department; management picks Sales by default (same rule as the old form).
  const defaultDept = me?.department === 'management' ? 'sales' : (me?.department ?? '');
  const [f, setF] = useState(() => ({
    customer_name: initial?.customer_name ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    company: initial?.company ?? '',
    requirement: initial?.requirement ?? '',
    source: (initial?.source ?? 'manual') as LeadSource,
    department: initial?.department ?? defaultDept,
    priority: (initial?.priority ?? 'normal') as LeadPriority,
    assigned_to: initial?.assigned_to ? String(initial.assigned_to) : '',
    follow_up_at: toLocalInput(initial?.follow_up_at),
    estimated_value: initial?.estimated_value ? String(Number(initial.estimated_value)) : '',
  }));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: LeadInput = {
      customer_name: f.customer_name.trim(),
      phone: f.phone.trim(),
      email: f.email.trim(),
      company: f.company.trim(),
      requirement: f.requirement.trim(),
      source: f.source,
      department: f.department,
      priority: f.priority,
      assigned_to: f.assigned_to ? Number(f.assigned_to) : null,
      follow_up_at: f.follow_up_at ? new Date(f.follow_up_at).toISOString() : null,
      estimated_value: f.estimated_value === '' ? null : f.estimated_value,
    };
    if (initial) {
      // Only people who may assign send the assignee; others keep it as it is.
      const { assigned_to, ...rest } = body;
      update.mutate(
        { id: initial.id, ...rest, ...(canAssign ? { assigned_to } : {}) },
        {
          onSuccess: (lead) => {
            toast.success('Lead updated');
            onSaved?.(lead);
            onClose();
          },
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: (lead) => {
          toast.success(`Lead "${lead.customer_name}" created`);
          onSaved?.(lead);
          onClose();
        },
      });
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{initial ? 'Edit lead' : 'Add lead'}</DialogTitle>
        <DialogDescription>Only the name is required; add the rest as you learn it.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="lead-name">Customer name *</Label>
          <Input id="lead-name" value={f.customer_name} onChange={set('customer_name')} autoFocus required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lead-phone">Phone</Label>
          <Input id="lead-phone" type="tel" value={f.phone} onChange={set('phone')} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lead-email">Email</Label>
          <Input id="lead-email" type="email" value={f.email} onChange={set('email')} />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="lead-company">Company</Label>
          <Input id="lead-company" value={f.company} onChange={set('company')} />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="lead-req">Requirement</Label>
          <Input id="lead-req" value={f.requirement} onChange={set('requirement')} placeholder="e.g. Brake pads + oil filter for Tata 407" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lead-source">Source</Label>
          <NativeSelect id="lead-source" value={f.source} onChange={set('source')}>
            {LEAD_SOURCES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lead-dept">Department</Label>
          <NativeSelect id="lead-dept" value={f.department} onChange={set('department')}>
            {!departments.some((d) => d.code === f.department) && <option value={f.department}>{f.department ? initial?.department_display || f.department : 'Pick…'}</option>}
            {departments.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lead-prio">Priority</Label>
          <NativeSelect id="lead-prio" value={f.priority} onChange={set('priority')}>
            {LEAD_PRIORITIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        {canAssign && (
          <div className="grid gap-1.5">
            <Label htmlFor="lead-assignee">Assign to</Label>
            <NativeSelect id="lead-assignee" value={f.assigned_to} onChange={set('assigned_to')}>
              <option value="">Unassigned</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="lead-value">Estimated value (₹)</Label>
          <Input id="lead-value" type="number" min={0} step="0.01" inputMode="decimal" value={f.estimated_value} onChange={set('estimated_value')} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lead-follow">Follow-up</Label>
          <Input id="lead-follow" type="datetime-local" value={f.follow_up_at} onChange={set('follow_up_at')} />
        </div>
      </div>
      {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!f.customer_name.trim()} loading={busy}>
          {initial ? 'Save changes' : 'Create lead'}
        </Button>
      </DialogFooter>
    </form>
  );
}
