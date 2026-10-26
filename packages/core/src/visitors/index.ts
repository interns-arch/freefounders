// @freefounders/core/visitors: the gate register (PLAN.md §22): visitors, vehicles, the open QR sign-in, guard activity;
// V2 (§22.9): pre-invites with a pass link, the visitor's own pass page, deliveries, the watchlist.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExportTarget } from '../export';
import { type DrfPage, tasksApi } from '../http';

export type VisitStatus = 'expected' | 'waiting' | 'waiting_host' | 'inside' | 'out' | 'denied' | 'rejected' | 'cancelled' | 'no_show';
export type PhotoRule = 'off' | 'optional' | 'required';

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  expected: 'Expected',
  waiting: 'Waiting at the gate',
  waiting_host: 'Waiting for the host',
  inside: 'Inside',
  out: 'Checked out',
  denied: 'Denied by the host',
  rejected: 'Turned away',
  cancelled: 'Invite cancelled',
  no_show: 'Did not come',
};

export interface PersonBrief {
  id: number;
  name: string;
  department: string;
}
export interface Place {
  id: number;
  name: string;
}

export interface VisitorConfig {
  can: { gate: boolean; invite: boolean; view_all: boolean; settings: boolean };
  purposes: string[];
  host_approval: boolean;
  photo_visitor: PhotoRule;
  photo_vehicle: boolean;
  id_proof: PhotoRule;
  id_types: string[];
  overstay_hours: number;
  locations: Place[];
  vehicle_types: Array<{ value: string; label: string }>;
  send_pass: boolean;
  watch_action: WatchAction;
  badge_format: BadgeFormat;
}

/** A watchlist match at the gate: "stop" refuses check-in (an admin may override), "warn" asks the guard. */
export type WatchAction = 'stop' | 'warn';
/** The printed visitor badge: an A6 card on any printer, or a 62 mm label printer. */
export type BadgeFormat = 'card' | 'label';

export interface Visit {
  id: number;
  visitor: number;
  name: string;
  mobile: string;
  company: string;
  host: PersonBrief | null;
  host_label: string;
  location: Place | null;
  purpose: string;
  people: number;
  status: VisitStatus;
  status_display: string;
  source: 'gate' | 'open_link' | 'invite';
  pass_no: string;
  pass_token: string;
  short_code: string;
  has_photo: boolean;
  id_type: string;
  id_last4: string;
  vehicle_no: string;
  vehicle: number | null;
  items: string;
  notes: string;
  created_at: string;
  check_in_at: string | null;
  check_in_by: string;
  check_out_at: string | null;
  check_out_by: string;
  minutes_inside: number | null;
  overstay: boolean;
  host_decision_at: string | null;
  returning: boolean;
  // V2
  email: string;
  expected_at: string | null;
  expected_until: string | null;
  /** "Tue 28 Oct, 10:00–12:00" (invites). */
  window: string;
  invited_by: string;
  group: string;
  /** Set when the visitor matched the watchlist (the gate shows it). */
  watch_note: string;
  pass_sent_at: string | null;
  pass_channels: Array<{ channel: 'whatsapp' | 'email'; status: string; detail?: string }>;
  /** "/v/<company code>/p/<token>": the visitor's own pass page (put the site's origin in front). */
  pass_path: string;
}

export interface VehicleEntry {
  id: number;
  number: string;
  type: string;
  type_display: string;
  driver_name: string;
  driver_mobile: string;
  purpose: string;
  company: string;
  items: string;
  parking_slot: string;
  notes: string;
  location: Place | null;
  has_photo_in: boolean;
  has_photo_out: boolean;
  in_at: string;
  in_by: string;
  out_at: string | null;
  out_by: string;
  inside: boolean;
  minutes_inside: number;
  visits: Array<{ id: number; name: string }>;
}

export interface GateLogRow {
  id: number;
  at: string;
  actor: PersonBrief | null;
  action: string;
  action_display: string;
  summary: string;
  changes: Record<string, [unknown, unknown]>;
  visit: number | null;
  vehicle: number | null;
  delivery: number | null;
}

export interface VisitorSettings {
  purposes: string[];
  host_approval: boolean;
  photo_visitor: PhotoRule;
  photo_vehicle: boolean;
  public_photo: PhotoRule;
  id_proof: PhotoRule;
  overstay_hours: number;
  retention_days: number;
  open_link: boolean;
  consent_text: string;
  send_pass: boolean;
  watch_action: WatchAction;
  badge_format: BadgeFormat;
  delivery_reminder_hours: number;
}

export interface VisitorLink {
  /** "/v/<company code>/<token>": the address on the printed QR (put the site's origin in front). */
  path: string;
  enabled: boolean;
  rotated_at: string | null;
  company: string;
  logo_url: string | null;
  can_change: boolean;
}

export interface ReturningVisitor {
  found: boolean;
  id?: number;
  name?: string;
  company?: string;
  visits?: number;
  has_photo?: boolean;
  id_type?: string;
  id_last4?: string;
  last_purpose?: string;
  last_host?: PersonBrief | null;
  last_host_label?: string;
  last_visit_at?: string;
  /** On the watchlist: why, and whether the gate must stop them. */
  watch?: { reason: string; stop: boolean } | null;
}

export interface InsideNow {
  visitors: Visit[];
  vehicles: VehicleEntry[];
  employees: Array<{ id: number; name: string; department: string; check_in: string }>;
}

export type VisitScope = 'today' | 'inside' | 'waiting' | 'expected' | 'mine' | 'upcoming' | '';
export interface VisitFilters {
  scope?: VisitScope;
  status?: string;
  q?: string;
  date_from?: string;
  date_to?: string;
  host?: number | '';
  purpose?: string;
  company?: string;
  location?: number | '';
}
export interface VehicleFilters {
  scope?: 'inside' | 'today' | '';
  q?: string;
  date_from?: string;
  date_to?: string;
}
export interface ActivityFilters {
  actor?: number | '';
  /** One visit's history (the register's detail). */
  visit?: number;
  action?: string;
  date_from?: string;
  date_to?: string;
}

const KEY = ['visitors'] as const;
const clean = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null)) as Record<string, string | number>;

/** GET /visitors/config/ */
export function useVisitorConfig(enabled = true) {
  return useQuery({ queryKey: [...KEY, 'config'], queryFn: () => tasksApi.get<VisitorConfig>('/visitors/config/'), staleTime: 60_000, enabled });
}

/** Visits the person may see; `live` refreshes every few seconds (the gate sees QR sign-ins arrive). */
export function useVisits(filters: VisitFilters, opts: { page?: number; pageSize?: number; live?: boolean } = {}) {
  const query = { ...clean(filters), page: opts.page ?? 1, page_size: opts.pageSize ?? 50 };
  return useQuery({
    queryKey: [...KEY, 'visits', query],
    queryFn: () => tasksApi.get<DrfPage<Visit>>('/visitors/visits/', query),
    placeholderData: keepPreviousData,
    refetchInterval: opts.live ? 8_000 : false,
  });
}

export function useVisit(id: number | null | undefined, live = false) {
  return useQuery({
    queryKey: [...KEY, 'visit', id],
    queryFn: () => tasksApi.get<Visit>(`/visitors/visits/${id}/`),
    enabled: id != null,
    refetchInterval: live ? 5_000 : false,
  });
}

function useVisitorsMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['badges'] });
    },
  });
}

export interface CheckInInput {
  mobile: string;
  name: string;
  company?: string;
  purpose?: string;
  host?: number | null;
  host_label?: string;
  people?: number;
  location?: number | null;
  photo?: string | null;
  reuse_photo?: boolean;
  id_type?: string;
  id_last4?: string;
  vehicle_no?: string;
  items?: string;
  notes?: string;
  /** The guard (or an admin) confirmed a watchlist warning. */
  watch_ok?: boolean;
}

/** POST /visitors/visits/ — the guard checks a walk-in visitor in. */
export const useCheckInVisitor = () => useVisitorsMutation((body: CheckInInput) => tasksApi.post<Visit>('/visitors/visits/', body));
/** POST /visitors/visits/:id/accept/ — a QR sign-in waiting at the gate is checked in. */
export const useAcceptVisit = () => useVisitorsMutation(({ id, ...body }: Partial<CheckInInput> & { id: number }) => tasksApi.post<Visit>(`/visitors/visits/${id}/accept/`, body));
export const useRejectVisit = () => useVisitorsMutation(({ id, reason }: { id: number; reason?: string }) => tasksApi.post<Visit>(`/visitors/visits/${id}/reject/`, { reason }));
export const useCheckOutVisit = () => useVisitorsMutation((id: number) => tasksApi.post<Visit>(`/visitors/visits/${id}/checkout/`));
/** Scan the pass QR (or type the pass number): that visitor is checked out. */
export const useCheckOutPass = () => useVisitorsMutation((code: string) => tasksApi.post<Visit>('/visitors/visits/checkout_pass/', { code }));
/** The host's answer when the company asks hosts first. */
export const useDecideVisit = () => useVisitorsMutation(({ id, decision }: { id: number; decision: 'allow' | 'deny' }) => tasksApi.post<Visit>(`/visitors/visits/${id}/decide/`, { decision }));
export const useEditVisit = () => useVisitorsMutation(({ id, ...body }: Partial<CheckInInput> & { id: number }) => tasksApi.patch<Visit>(`/visitors/visits/${id}/`, body));
/** The gate scans a pass QR (or types a pass number / code): which visit it is. */
export const useFindPass = () => useMutation({ mutationFn: (code: string) => tasksApi.get<Visit>('/visitors/visits/find/', { code }) });

// ─── pre-invites (V2) ─────────────────────────────────────────────────────────

export interface InviteVisitorRow {
  name: string;
  mobile?: string;
  email?: string;
  company?: string;
}
export interface InviteInput {
  visitors: InviteVisitorRow[];
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, optional (no time = the whole day). */
  time_from?: string;
  time_to?: string;
  purpose?: string;
  /** Someone else (gate / admin only); default: me. */
  host?: number | null;
  location?: number | null;
  people?: number;
  notes?: string;
  /** Send the pass by WhatsApp / email (default true). */
  send?: boolean;
}
/** POST /visitors/invites/ — one visitor or a group; each gets a pass. */
export const useInviteVisitors = () => useVisitorsMutation((body: InviteInput) => tasksApi.post<Visit[]>('/visitors/invites/', body));
export const useCancelInvite = () => useVisitorsMutation((id: number) => tasksApi.post<Visit>(`/visitors/visits/${id}/cancel/`));
/** Send (again) the pass link by WhatsApp / email. */
export const useSendPass = () => useVisitorsMutation((id: number) => tasksApi.post<Visit>(`/visitors/visits/${id}/send_pass/`));

// ─── deliveries (V2) ──────────────────────────────────────────────────────────

export type DeliveryStatus = 'at_gate' | 'collected' | 'returned';
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = { at_gate: 'Waiting at the gate', collected: 'Collected', returned: 'Returned' };
export interface Delivery {
  id: number;
  courier: string;
  tracking_no: string;
  recipient: PersonBrief | null;
  recipient_label: string;
  parcels: number;
  description: string;
  has_photo: boolean;
  location: Place | null;
  status: DeliveryStatus;
  status_display: string;
  received_at: string;
  received_by: string;
  collected_by_name: string;
  closed_at: string | null;
  closed_by: string;
  notes: string;
  reminded: boolean;
}
export interface DeliveryFilters {
  scope?: 'at_gate' | 'mine' | 'today' | '';
  status?: string;
  q?: string;
  date_from?: string;
  date_to?: string;
}
export interface DeliveryInput {
  courier?: string;
  tracking_no?: string;
  recipient?: number | null;
  recipient_label?: string;
  parcels?: number;
  description?: string;
  location?: number | null;
  photo?: string | null;
  notes?: string;
}
export function useDeliveries(filters: DeliveryFilters, opts: { page?: number; pageSize?: number; live?: boolean; enabled?: boolean } = {}) {
  const query = { ...clean(filters), page: opts.page ?? 1, page_size: opts.pageSize ?? 50 };
  return useQuery({
    queryKey: [...KEY, 'deliveries', query],
    queryFn: () => tasksApi.get<DrfPage<Delivery>>('/visitors/deliveries/', query),
    placeholderData: keepPreviousData,
    refetchInterval: opts.live ? 15_000 : false,
    enabled: opts.enabled ?? true,
  });
}
export const useReceiveDelivery = () => useVisitorsMutation((body: DeliveryInput) => tasksApi.post<Delivery>('/visitors/deliveries/', body));
/** Handed over (to the person, or someone collecting for them). */
export const useCollectDelivery = () =>
  useVisitorsMutation(({ id, ...body }: { id: number; collected_by_name?: string; notes?: string }) => tasksApi.post<Delivery>(`/visitors/deliveries/${id}/collect/`, body));
export const useReturnDelivery = () =>
  useVisitorsMutation(({ id, ...body }: { id: number; notes?: string }) => tasksApi.post<Delivery>(`/visitors/deliveries/${id}/return/`, body));
export function useDeliveryPhoto(id: number | null | undefined) {
  return useQuery({ queryKey: [...KEY, 'photo', 'delivery', id], queryFn: () => tasksApi.blob(`/visitors/deliveries/${id}/photo/`), enabled: id != null, staleTime: 10 * 60_000, retry: false });
}

// ─── watchlist (V2) ───────────────────────────────────────────────────────────

export interface WatchEntry {
  id: number;
  mobile: string;
  name: string;
  reason: string;
  active: boolean;
  added_by: string;
  added_at: string;
  removed_by: string;
  removed_at: string | null;
}
export function useWatchlist(all = false, enabled = true) {
  return useQuery({ queryKey: [...KEY, 'watchlist', all], queryFn: () => tasksApi.get<WatchEntry[]>('/visitors/watchlist/', all ? { all: 1 } : {}), enabled });
}
export const useAddWatch = () => useVisitorsMutation((body: { mobile?: string; name?: string; reason: string }) => tasksApi.post<WatchEntry>('/visitors/watchlist/', body));
export const useRemoveWatch = () => useVisitorsMutation((id: number) => tasksApi.del<WatchEntry>(`/visitors/watchlist/${id}/`));

export function useVehicles(filters: VehicleFilters, opts: { page?: number; pageSize?: number; live?: boolean } = {}) {
  const query = { ...clean(filters), page: opts.page ?? 1, page_size: opts.pageSize ?? 50 };
  return useQuery({
    queryKey: [...KEY, 'vehicles', query],
    queryFn: () => tasksApi.get<DrfPage<VehicleEntry>>('/visitors/vehicles/', query),
    placeholderData: keepPreviousData,
    refetchInterval: opts.live ? 15_000 : false,
  });
}

export interface VehicleInInput {
  number: string;
  type: string;
  driver_name?: string;
  driver_mobile?: string;
  purpose?: string;
  company?: string;
  items?: string;
  parking_slot?: string;
  notes?: string;
  location?: number | null;
  visit?: number | null;
  photo?: string | null;
}
export const useVehicleIn = () => useVisitorsMutation((body: VehicleInInput) => tasksApi.post<VehicleEntry>('/visitors/vehicles/', body));
export const useVehicleOut = () =>
  useVisitorsMutation(({ id, ...body }: { id: number; photo?: string | null; notes?: string }) => tasksApi.post<VehicleEntry>(`/visitors/vehicles/${id}/checkout/`, body));

export function useGateActivity(filters: ActivityFilters, page = 1, enabled = true) {
  const query = { ...clean(filters), page, page_size: 50 };
  return useQuery({
    queryKey: [...KEY, 'activity', query],
    queryFn: () => tasksApi.get<DrfPage<GateLogRow>>('/visitors/activity/', query),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useGuards(enabled = true) {
  return useQuery({ queryKey: [...KEY, 'guards'], queryFn: () => tasksApi.get<PersonBrief[]>('/visitors/guards/'), enabled, staleTime: 60_000 });
}

export function useInsideNow() {
  return useQuery({ queryKey: [...KEY, 'inside'], queryFn: () => tasksApi.get<InsideNow>('/visitors/inside/'), refetchInterval: 30_000 });
}

/** People a visitor can meet (the gate's search). */
export function useHostSearch(q: string) {
  return useQuery({
    queryKey: [...KEY, 'hosts', q],
    queryFn: () => tasksApi.get<PersonBrief[]>('/visitors/hosts/', { q }),
    enabled: q.trim().length >= 1,
    staleTime: 60_000,
  });
}

/** A returning visitor by mobile (10 digits typed). */
export function useVisitorLookup(mobile: string) {
  const digits = mobile.replace(/\D/g, '');
  return useQuery({
    queryKey: [...KEY, 'lookup', digits],
    queryFn: () => tasksApi.get<ReturningVisitor>('/visitors/lookup/', { mobile: digits }),
    enabled: digits.length >= 10,
    staleTime: 30_000,
  });
}

/** Photos are private: loaded with the sign-in token, never a public URL. */
export function useVisitPhoto(id: number | null | undefined) {
  return useQuery({ queryKey: [...KEY, 'photo', 'visit', id], queryFn: () => tasksApi.blob(`/visitors/visits/${id}/photo/`), enabled: id != null, staleTime: 10 * 60_000, retry: false });
}
export function useVisitorPhoto(visitorId: number | null | undefined) {
  return useQuery({ queryKey: [...KEY, 'photo', 'person', visitorId], queryFn: () => tasksApi.blob(`/visitors/people/${visitorId}/photo/`), enabled: visitorId != null, staleTime: 10 * 60_000, retry: false });
}
export function useVehiclePhoto(id: number | null | undefined, which: 'in' | 'out') {
  return useQuery({ queryKey: [...KEY, 'photo', 'vehicle', id, which], queryFn: () => tasksApi.blob(`/visitors/vehicles/${id}/photo/${which}/`), enabled: id != null, staleTime: 10 * 60_000, retry: false });
}

export function useVisitorSettings() {
  return useQuery({ queryKey: [...KEY, 'settings'], queryFn: () => tasksApi.get<VisitorSettings>('/visitors/settings/') });
}
export const useSaveVisitorSettings = () => useVisitorsMutation((body: Partial<VisitorSettings>) => tasksApi.put<VisitorSettings>('/visitors/settings/', body));

export function useVisitorLink(enabled = true) {
  return useQuery({ queryKey: [...KEY, 'link'], queryFn: () => tasksApi.get<VisitorLink>('/visitors/link/'), enabled });
}
/** "Make a new QR" (the old one stops working) or switch the open sign-in on / off. */
export const useChangeVisitorLink = () => useVisitorsMutation((body: { regenerate?: boolean; enabled?: boolean }) => tasksApi.post<VisitorLink>('/visitors/link/', body));

// ─── the open QR sign-in (no sign-in needed) ──────────────────────────────────

export interface PublicVisitorForm {
  company: string;
  logo_url: string | null;
  purposes: string[];
  photo: PhotoRule;
  consent_text: string;
}
export interface PublicVisitorInput {
  name: string;
  mobile: string;
  company?: string;
  purpose?: string;
  host_name?: string;
  people?: number;
  vehicle_no?: string;
  photo?: string | null;
  consent: boolean;
  /** Honeypot: never shown, always empty for people. */
  website?: string;
}

export function usePublicVisitorForm(code: string, token: string) {
  return useQuery({
    queryKey: ['public-visitor', code, token],
    queryFn: () => tasksApi.get<PublicVisitorForm>(`/visitors/public/${encodeURIComponent(code)}/${encodeURIComponent(token)}/`),
    retry: false,
    staleTime: Infinity,
  });
}
export function useSubmitPublicVisitor(code: string, token: string) {
  return useMutation({
    mutationFn: (body: PublicVisitorInput) => tasksApi.post<{ code: string }>(`/visitors/public/${encodeURIComponent(code)}/${encodeURIComponent(token)}/`, body),
  });
}

// ─── the visitor's own pass page (no sign-in, V2) ─────────────────────────────

export interface PublicPass {
  company: string;
  logo_url: string | null;
  name: string;
  visitor_company: string;
  pass_no: string;
  /** The QR content: "KPV:<token>". */
  qr: string;
  status: VisitStatus;
  status_display: string;
  host: string;
  purpose: string;
  people: number;
  location: string;
  window: string;
  check_in_at: string | null;
  check_out_at: string | null;
}
/** /v/<code>/p/<token>: refreshes so the page shows "Inside" once the gate checks them in. */
export function usePublicPass(code: string, token: string) {
  return useQuery({
    queryKey: ['public-pass', code, token],
    queryFn: () => tasksApi.get<PublicPass>(`/visitors/pass/${encodeURIComponent(code)}/${encodeURIComponent(token)}/`),
    retry: false,
    refetchInterval: (q) => (q.state.data && ['expected', 'waiting_host', 'inside'].includes(q.state.data.status) ? 30_000 : false),
  });
}

// ─── downloads (PLAN.md §19.31) ───────────────────────────────────────────────

export const visitorExports = {
  visits: (f: VisitFilters): ExportTarget => ({ api: 'tasks', path: '/visitors/visits/', query: clean(f) }),
  vehicles: (f: VehicleFilters): ExportTarget => ({ api: 'tasks', path: '/visitors/vehicles/', query: clean(f) }),
  activity: (f: ActivityFilters): ExportTarget => ({ api: 'tasks', path: '/visitors/activity/', query: clean(f) }),
  inside: (): ExportTarget => ({ api: 'tasks', path: '/visitors/inside/' }),
  deliveries: (f: DeliveryFilters): ExportTarget => ({ api: 'tasks', path: '/visitors/deliveries/', query: clean(f) }),
};

/** "1 h 25 min", "40 min". */
export function formatMinutes(m: number | null | undefined): string {
  if (m == null) return '—';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h} h ${r} min` : `${r} min`;
}
