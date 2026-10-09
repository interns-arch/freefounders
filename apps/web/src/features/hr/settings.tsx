/** HR → HR Settings (hr.manage): attendance rules (PLAN.md §16.1/§16.4/§17.2), office locations, face enrolment, leave types. */
import { ApiError, errorMessage } from '@freefounders/core';
import {
  type HrSettingValues,
  useAddLeaveType,
  useAddOffice,
  useDeleteOffice,
  useFaceProfile,
  useHrConfig,
  useHrSettings,
  useLeaveTypes,
  useOfficeLocations,
  useSaveHrSettings,
} from '@freefounders/core/hr';
import { useTeamDirectory } from '@freefounders/core/tasks';
import { CalendarHeart, Camera, LocateFixed, MapPin, ScanFace, Settings2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Checkbox, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Chip, ErrorNote, OkNote, Panel } from '../tasks/general/parts';
import { FaceCapture } from './face-capture';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PHOTO_LABELS: Record<string, string> = { off: 'Off', optional: 'Optional', required: 'Required at every punch' };

export function HrSettingsTab() {
  return (
    <div className="max-w-3xl space-y-4">
      <AttendanceRules />
      <Offices />
      <FaceEnrolment />
      <LeaveTypes />
    </div>
  );
}

type Form = { [K in keyof HrSettingValues]: HrSettingValues[K] | string };

/** Working hours and attendance rules, saved for this company. */
function AttendanceRules() {
  const q = useHrSettings();
  const save = useSaveHrSettings();
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (q.data && !form) setForm(Object.fromEntries(Object.entries(q.data).map(([k, v]) => [k, v.value])) as Form);
  }, [q.data, form]);

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data || !form) return <Skeleton className="h-80" />;
  const s = q.data;
  const fieldErrors = save.error instanceof ApiError ? (save.error.errors ?? {}) : {};
  const fe = (k: string) => fieldErrors[k] && <p className="text-xs text-destructive">{fieldErrors[k]}</p>;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const week = (form.week_offs as number[]) ?? [];
  const toggleDay = (d: number) => setForm({ ...form, week_offs: week.includes(d) ? week.filter((x) => x !== d) : [...week, d] });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    save.mutate(form, {
      onSuccess: (d) => {
        setMsg('Saved');
        setForm(Object.fromEntries(Object.entries(d ?? s).map(([k, v]) => [k, v.value])) as Form);
      },
    });
  };

  const num = (id: string, k: keyof Form, label: string, props: React.ComponentProps<'input'>) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" value={String(form[k] ?? '')} onChange={set(k)} {...props} />
      {fe(k)}
    </div>
  );

  return (
    <form onSubmit={submit} aria-label="Attendance rules">
      <Panel icon={Settings2} title="Attendance rules" description="Working hours, grace time and what a punch needs. Saved for this company.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="hr-start">Work starts</Label>
            <Input id="hr-start" type="time" value={String(form.work_start)} onChange={set('work_start')} />
            {fe('work_start')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="hr-end">Work ends</Label>
            <Input id="hr-end" type="time" value={String(form.work_end)} onChange={set('work_end')} />
            {fe('work_end')}
          </div>
          {num('hr-grace', 'grace_minutes', 'Late after (minutes of grace)', { min: 0, max: 240 })}
          {num('hr-half', 'half_day_hours', 'Half day below (hours)', { min: 0.5, max: 24, step: 0.5 })}
          {num('hr-full', 'full_day_hours', 'Full day (hours)', { min: 1, max: 24, step: 0.5 })}
          <div className="grid gap-1.5">
            <Label htmlFor="hr-photo">Photo at check-in / check-out</Label>
            <NativeSelect id="hr-photo" value={String(form.photo)} onChange={set('photo')}>
              {(s.photo.choices ?? ['off', 'optional', 'required']).map((c) => (
                <option key={c} value={c}>
                  {PHOTO_LABELS[c] ?? c}
                </option>
              ))}
            </NativeSelect>
            {fe('photo')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="hr-approval">Leave and corrections are approved by</Label>
            <NativeSelect id="hr-approval" value={String(form.leave_approval)} onChange={set('leave_approval')}>
              <option value="department">Approvers in the person’s department</option>
              <option value="manager">The person’s manager (reports to) first</option>
            </NativeSelect>
            {fe('leave_approval')}
          </div>
          {num('hr-remind', 'approval_remind_hours', 'Remind approvers after (hours; 0 = never)', { min: 0, max: 720 })}
          {num('hr-keep', 'photo_retention_days', 'Keep photos for (days)', { min: 1, max: 3650 })}
        </div>
        <fieldset className="mt-4">
          <legend className="mb-1.5 text-[13px] font-medium">Weekly off</legend>
          <div role="group" aria-label="Weekly off days" className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d, i) => (
              <label key={d} className={cn('flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-colors hover:bg-accent', week.includes(i) && 'border-primary/40 bg-primary/10 font-semibold text-primary')}>
                <Checkbox checked={week.includes(i)} onCheckedChange={() => toggleDay(i)} aria-label={d} /> {d}
              </label>
            ))}
          </div>
          {fe('week_offs')}
        </fieldset>
        <div className="mt-4 grid gap-2 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox checked={!!form.geofence_enabled} onCheckedChange={(c) => setForm({ ...form, geofence_enabled: c === true })} /> Check location at check-in (needs an office below)
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={!!form.face_enabled} onCheckedChange={(c) => setForm({ ...form, face_enabled: c === true })} /> Face check at check-in and check-out
          </label>
          <label className={cn('flex items-center gap-2', !form.face_enabled && 'opacity-60')}>
            <Checkbox checked={!!form.face_self_enroll} disabled={!form.face_enabled} onCheckedChange={(c) => setForm({ ...form, face_self_enroll: c === true })} /> First face capture becomes the person’s face profile
          </label>
        </div>
        {save.error && !Object.keys(fieldErrors).length && <ErrorNote className="mt-3">{errorMessage(save.error)}</ErrorNote>}
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" loading={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save rules'}
          </Button>
          {msg && (
            <span className="text-sm text-success" role="status">
              {msg}
            </span>
          )}
        </div>
      </Panel>
    </form>
  );
}

function Offices() {
  const q = useOfficeLocations();
  const add = useAddOffice();
  const del = useDeleteOffice();
  const empty = { name: '', latitude: '', longitude: '', radius_m: '200' };
  const [o, setO] = useState(empty);
  const useMyLocation = () =>
    navigator.geolocation?.getCurrentPosition((p) => setO((x) => ({ ...x, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) })));
  const error = add.error ?? del.error;
  return (
    <Panel icon={MapPin} tone="info" title="Office locations (geo-fence)">
      {q.data?.length === 0 && <p className="text-sm text-muted-foreground">No office added. Geo-fencing cannot be enforced until one exists.</p>}
      <ul className="divide-y">
        {q.data?.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2 py-2">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-info/12 text-info">
                <MapPin className="size-4" />
              </span>
              <div>
              <div className="text-sm font-medium">{x.name}</div>
              <div className="text-xs text-muted-foreground">
                {x.latitude}, {x.longitude} · {x.radius_m} m
              </div>
              </div>
            </div>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove office ${x.name}`} onClick={() => del.mutate(x.id)}>
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="of-name">Name</Label>
          <Input id="of-name" value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="of-radius">Radius (m)</Label>
          <Input id="of-radius" type="number" value={o.radius_m} onChange={(e) => setO({ ...o, radius_m: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="of-lat">Latitude</Label>
          <Input id="of-lat" value={o.latitude} onChange={(e) => setO({ ...o, latitude: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="of-lng">Longitude</Label>
          <Input id="of-lng" value={o.longitude} onChange={(e) => setO({ ...o, longitude: e.target.value })} />
        </div>
      </div>
      {error && <ErrorNote className="mt-3">{errorMessage(error)}</ErrorNote>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" onClick={useMyLocation}>
          <LocateFixed /> Use my current location
        </Button>
        <Button
          disabled={!o.name || !o.latitude}
          loading={add.isPending}
          onClick={() =>
            add.mutate(
              { name: o.name, latitude: Number(o.latitude), longitude: Number(o.longitude), radius_m: Number(o.radius_m) },
              { onSuccess: () => setO(empty) },
            )
          }
        >
          Add office
        </Button>
      </div>
    </Panel>
  );
}

function FaceEnrolment() {
  const config = useHrConfig().data;
  const team = useTeamDirectory().data ?? [];
  const face = useFaceProfile();
  const [target, setTarget] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [msg, setMsg] = useState('');
  const name = team.find((t) => String(t.id) === target)?.name || 'Employee';
  const error = face.enrol.error ?? face.remove.error;

  return (
    <Panel icon={ScanFace} tone="warning" title="Face attendance">
      <p className="text-sm text-muted-foreground">
        {config?.face_enabled
          ? 'Face verification is ON — employees must pass a face check to mark attendance.'
          : 'Face verification is currently OFF. Enrol faces here, then turn on “Face check at check-in and check-out” in the attendance rules above.'}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">Only a numeric signature of the face is stored — never a photo. You can remove an employee’s profile at any time.</p>
      {error && <ErrorNote className="mt-3">{errorMessage(error)}</ErrorNote>}
      <OkNote className="mt-3">{msg}</OkNote>
      <div className="mt-3 flex flex-wrap gap-2">
        <NativeSelect aria-label="Employee to enrol" className="w-auto min-w-52" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Choose an employee…</option>
          {team.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
        <Button disabled={!target} onClick={() => setCapturing(true)}>
          <Camera /> Enrol face
        </Button>
        <Button
          variant="outline"
          disabled={!target}
          onClick={() => {
            setMsg('');
            face.remove.mutate(Number(target), {
              onSuccess: () => {
                setMsg(`${name}'s face profile removed.`);
                setTarget('');
              },
            });
          }}
        >
          Remove profile
        </Button>
      </div>
      {capturing && (
        <FaceCapture
          title="Enrol employee face"
          action="Save face"
          hint="Ask the employee to look straight at the camera in good light."
          onClose={() => setCapturing(false)}
          onCapture={(d) => {
            setCapturing(false);
            setMsg('');
            if (d)
              face.enrol.mutate(
                { user: Number(target), descriptor: d },
                {
                  onSuccess: () => {
                    setMsg(`${name} enrolled ✅ — they can now mark attendance with their face.`);
                    setTarget('');
                  },
                },
              );
          }}
        />
      )}
    </Panel>
  );
}

function LeaveTypes() {
  const q = useLeaveTypes();
  const add = useAddLeaveType();
  const empty = { name: '', annual_quota: '12', paid: true, requires_document: false };
  const [t, setT] = useState(empty);
  return (
    <Panel icon={CalendarHeart} tone="success" title="Leave types">
      <ul className="grid gap-2 sm:grid-cols-2">
        {q.data?.map((x) => (
          <li key={x.id} className={cn('flex items-center justify-between gap-2 rounded-xl border bg-muted/30 px-3 py-2', !x.active && 'opacity-70')}>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{x.name}</div>
              <div className="text-xs text-muted-foreground">
                {x.annual_quota}/yr · {x.paid ? 'paid' : 'unpaid'}
                {x.requires_document ? ' · document required' : ''}
              </div>
            </div>
            {!x.active ? <Chip>Inactive</Chip> : <span className="font-mono text-sm font-bold text-primary tabular-nums">{x.annual_quota}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="lt-name">Name</Label>
          <Input id="lt-name" value={t.name} placeholder="e.g. Casual" onChange={(e) => setT({ ...t, name: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lt-quota">Annual quota</Label>
          <Input id="lt-quota" type="number" value={t.annual_quota} onChange={(e) => setT({ ...t, annual_quota: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={t.paid} onCheckedChange={(c) => setT({ ...t, paid: c === true })} /> Paid
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={t.requires_document} onCheckedChange={(c) => setT({ ...t, requires_document: c === true })} /> Document required
        </label>
      </div>
      {add.error && <ErrorNote className="mt-3">{errorMessage(add.error)}</ErrorNote>}
      <Button
        className="mt-3"
        disabled={!t.name.trim()}
        loading={add.isPending}
        onClick={() => add.mutate({ ...t, annual_quota: Number(t.annual_quota) }, { onSuccess: () => setT(empty) })}
      >
        Add leave type
      </Button>
    </Panel>
  );
}
