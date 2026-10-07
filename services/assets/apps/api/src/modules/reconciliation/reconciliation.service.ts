import { Injectable } from '@nestjs/common';
import { desc, eq, ilike, inArray, ne } from 'drizzle-orm';
import {
  assetCreateSchema,
  type DumpRow,
  employeeCodeKey,
  extractIdentifiers,
  normalizeIccid,
  normalizePhone,
  normalizeText,
  RECON_COLUMNS,
  RECON_SOURCE_LABELS,
  type ReconSource,
  type ReconStatus,
  type ReconUploadInput,
} from '@eam/shared';
import { type Actor, assertCan, can } from '../../common/actor';
import { badRequest, notFound } from '../../common/http';
import { DbService } from '../../db/db.service';
import { assets, assetTypes, departments, employees, reconciliationRuns, vendors } from '../../db/schema';
import { NotificationsService } from '../../core/notifications.service';
import { AssetsService } from '../assets/assets.service';

export interface ReconIssue {
  field: string;
  label: string;
  dump: string | null;
  system: string | null;
  /** error: the two sides disagree; warning: worth a look (e.g. a name spelled differently). */
  level: 'error' | 'warning';
}

export interface ReconItem {
  status: ReconStatus;
  key: string;
  title: string;
  subtitle: string | null;
  entity: { kind: 'ASSET' | 'EMPLOYEE'; id: string; label: string } | null;
  issues: ReconIssue[];
  /** Airtel rows with no SIM record: what is needed to add it (and whom to assign it to). */
  addSim?: { connectionNumber: string; simNumber: string | null; plan: string | null; circle: string | null; billableId: string | null; employeeId: string | null; employeeName: string | null };
}

const PERMISSION: Record<ReconSource, 'asset:assign' | 'employee:manage'> = { AIRTEL: 'asset:assign', SALARYBOX: 'employee:manage' };
const same = (a: string | null | undefined, b: string | null | undefined) => normalizeText(a) === normalizeText(b);
const stripCode = (holder: string | null) => (holder ?? '').replace(/\s*\([^)]*\)\s*$/, '');

type AssetRow = {
  id: string;
  assetTag: string;
  name: string;
  status: string;
  serialNumber: string | null;
  holderType: string | null;
  holderId: string | null;
  holderName: string | null;
  attributes: Record<string, unknown>;
  typeCode: string;
};

function summarise(items: ReconItem[]) {
  const summary: Record<string, number> = { MATCHED: 0, MISMATCH: 0, MISSING_IN_SYSTEM: 0, MISSING_IN_DUMP: 0, INVALID: 0, warnings: 0 };
  for (const i of items) {
    summary[i.status]++;
    if (i.status === 'MATCHED' && i.issues.length) summary.warnings++;
  }
  return summary;
}

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly dbs: DbService,
    private readonly notifications: NotificationsService,
    private readonly assets: AssetsService,
  ) {}

  private visibleSources(actor: Actor) {
    return (Object.keys(PERMISSION) as ReconSource[]).filter((s) => can(actor, PERMISSION[s]));
  }

  async list(actor: Actor) {
    const sources = this.visibleSources(actor);
    if (!sources.length) return [];
    return this.dbs.db
      .select({
        id: reconciliationRuns.id,
        source: reconciliationRuns.source,
        fileName: reconciliationRuns.fileName,
        rowCount: reconciliationRuns.rowCount,
        summary: reconciliationRuns.summary,
        createdByName: reconciliationRuns.createdByName,
        createdAt: reconciliationRuns.createdAt,
      })
      .from(reconciliationRuns)
      .where(inArray(reconciliationRuns.source, sources))
      .orderBy(desc(reconciliationRuns.createdAt))
      .limit(100);
  }

  async get(actor: Actor, id: string) {
    const [run] = await this.dbs.db.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, id));
    if (!run || !this.visibleSources(actor).includes(run.source)) throw notFound('Reconciliation');
    return run;
  }

  async run(actor: Actor, input: ReconUploadInput) {
    assertCan(actor, PERMISSION[input.source]);
    // Keep only the known columns, whatever the client sent.
    const keys = RECON_COLUMNS[input.source].map((c) => c.key);
    const rows: DumpRow[] = input.rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));
    const assetRows = await this.loadAssets();
    const items = input.source === 'AIRTEL' ? this.airtel(rows, assetRows, await this.loadEmployees()) : this.salaryBox(rows, assetRows, await this.loadEmployees());

    const summary = summarise(items);
    const [run] = await this.dbs.db
      .insert(reconciliationRuns)
      .values({ source: input.source, fileName: input.fileName, rowCount: rows.length, repairedRows: input.repairedRows, summary, items, createdBy: actor.userId, createdByName: actor.name })
      .returning({ id: reconciliationRuns.id });

    const attention = summary.MISMATCH + summary.MISSING_IN_SYSTEM + summary.MISSING_IN_DUMP + summary.INVALID;
    await this.notifications.notifyPermission(PERMISSION[input.source], {
      type: 'RECONCILIATION',
      title: `${RECON_SOURCE_LABELS[input.source]} check: ${attention ? `${attention} need attention` : 'all matched'}`,
      body: `${summary.MATCHED} matched · ${summary.MISMATCH} mismatched · ${summary.MISSING_IN_SYSTEM} not in system · ${summary.MISSING_IN_DUMP} not in the file (${input.fileName})`,
      link: `/reconciliation/${run.id}`,
    });
    return { id: run.id, summary };
  }

  /** Adds the chosen Airtel connections to the SIM register, assigned to the person they were matched to. */
  async addSims(actor: Actor, runId: string, keys: string[]) {
    assertCan(actor, 'asset:create');
    assertCan(actor, 'asset:assign');
    const run = await this.get(actor, runId);
    if (run.source !== 'AIRTEL') throw badRequest('Only Airtel checks can add SIMs');
    const db = this.dbs.db;
    const [type] = await db.select({ id: assetTypes.id }).from(assetTypes).where(eq(assetTypes.code, 'SIM'));
    if (!type) throw badRequest('Add a SIM Card asset type (code SIM) to the catalog first');
    const [airtel] = await db.select({ id: vendors.id }).from(vendors).where(ilike(vendors.name, 'airtel%')).limit(1);

    const wanted = new Set(keys);
    const items = run.items as ReconItem[];
    const results: { key: string; ok: boolean; error?: string }[] = [];
    for (const item of items) {
      if (!wanted.has(item.key) || !item.addSim) continue;
      const a = item.addSim;
      try {
        const input = assetCreateSchema.parse({
          assetTypeId: type.id,
          name: 'Airtel Corporate SIM',
          status: 'AVAILABLE',
          serialNumber: a.simNumber,
          ownership: 'SUBSCRIPTION',
          vendorId: airtel?.id ?? null,
          attributes: { connection_number: a.connectionNumber, sim_number: a.simNumber, plan: a.plan, circle: a.circle, billable_account: a.billableId, carrier: 'Airtel' },
          assignTo: a.employeeId ? { holderType: 'EMPLOYEE', holderId: a.employeeId } : null,
        });
        const asset = await this.assets.create(actor, input);
        item.status = 'MATCHED';
        item.entity = { kind: 'ASSET', id: asset.id, label: `${asset.assetTag} · ${asset.holderName ?? 'Not assigned'}` };
        item.issues = item.issues.filter((i) => i.field !== 'sim');
        item.subtitle = `Added to the SIM register by ${actor.name}${a.employeeName ? ` and assigned to ${a.employeeName}` : ''}`;
        delete item.addSim;
        results.push({ key: item.key, ok: true });
      } catch (err) {
        const res = (err as { getResponse?: () => unknown }).getResponse?.();
        const message = typeof res === 'object' && res && 'message' in res ? String((res as { message: unknown }).message) : (err as Error).message;
        results.push({ key: item.key, ok: false, error: message });
      }
    }
    const summary = summarise(items);
    await db.update(reconciliationRuns).set({ items, summary }).where(eq(reconciliationRuns.id, runId));
    return { results, added: results.filter((r) => r.ok).length, summary };
  }

  private async loadAssets(): Promise<AssetRow[]> {
    return this.dbs.db
      .select({
        id: assets.id,
        assetTag: assets.assetTag,
        name: assets.name,
        status: assets.status,
        serialNumber: assets.serialNumber,
        holderType: assets.holderType,
        holderId: assets.holderId,
        holderName: assets.holderName,
        attributes: assets.attributes,
        typeCode: assetTypes.code,
      })
      .from(assets)
      .innerJoin(assetTypes, eq(assetTypes.id, assets.assetTypeId))
      .where(ne(assets.status, 'DISPOSED'));
  }

  private loadEmployees() {
    return this.dbs.db
      .select({
        id: employees.id,
        code: employees.employeeCode,
        fullName: employees.fullName,
        email: employees.email,
        personalEmail: employees.personalEmail,
        phone: employees.phone,
        personalPhone: employees.personalPhone,
        designation: employees.designation,
        status: employees.status,
        departmentName: departments.name,
      })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId));
  }

  // ─── Airtel: one row per connection, matched to SIM assets ───────────────
  private airtel(rows: DumpRow[], allAssets: AssetRow[], people: Awaited<ReturnType<ReconciliationService['loadEmployees']>>): ReconItem[] {
    const sims = allAssets.filter((a) => a.typeCode === 'SIM');
    const attr = (a: AssetRow, k: string) => (a.attributes[k] === undefined || a.attributes[k] === null ? null : String(a.attributes[k]));
    const byConn = new Map<string, AssetRow>();
    const byIccid = new Map<string, AssetRow>();
    for (const s of sims) {
      const c = normalizePhone(attr(s, 'connection_number'));
      if (c) byConn.set(c, s);
      const i = normalizeIccid(attr(s, 'sim_number') ?? s.serialNumber);
      if (i) byIccid.set(i, s);
    }
    const byEmail = new Map<string, (typeof people)[number]>();
    for (const p of people) for (const e of [p.email, p.personalEmail]) if (e) byEmail.set(e.toLowerCase(), p);
    // A number recorded on a person (official first, then personal) tells us whose connection it is.
    const byPhone = new Map<string, { person: (typeof people)[number]; official: boolean }>();
    for (const p of people.filter((x) => x.status !== 'EXITED')) {
      const personal = normalizePhone(p.personalPhone);
      if (personal && !byPhone.has(personal)) byPhone.set(personal, { person: p, official: false });
    }
    for (const p of people.filter((x) => x.status !== 'EXITED')) {
      const official = normalizePhone(p.phone);
      if (official) byPhone.set(official, { person: p, official: true });
    }

    const items: ReconItem[] = [];
    const seen = new Set<string>();
    const matched = new Set<string>();
    for (const row of rows) {
      const conn = normalizePhone(row.connectionNumber);
      const subtitle = [row.plan, row.name].filter(Boolean).join(' · ') || null;
      if (!conn) {
        items.push({ status: 'INVALID', key: row.connectionNumber ?? '—', title: row.connectionNumber ?? 'No connection number', subtitle, entity: null, issues: [{ field: 'connectionNumber', label: 'Connection Number', dump: row.connectionNumber, system: null, level: 'error' }] });
        continue;
      }
      if (seen.has(conn)) {
        items.push({ status: 'INVALID', key: conn, title: conn, subtitle: 'Listed more than once in the file', entity: null, issues: [] });
        continue;
      }
      seen.add(conn);
      const iccid = normalizeIccid(row.simNumber);
      const asset = byConn.get(conn) ?? (iccid ? byIccid.get(iccid) : undefined);
      if (!asset) {
        const owner = byPhone.get(conn);
        const person = owner?.person ?? (row.email ? byEmail.get(row.email.toLowerCase()) : undefined);
        const addSim = { connectionNumber: conn, simNumber: row.simNumber, plan: row.plan, circle: row.circle, billableId: row.billableId, employeeId: person?.id ?? null, employeeName: person?.fullName ?? null };
        if (person) {
          const issues: ReconIssue[] = [
            { field: 'sim', label: 'No SIM record yet', dump: conn, system: owner ? `${owner.official ? 'Official' : 'Personal'} phone of ${person.fullName}` : `Airtel email matches ${person.fullName}`, level: 'warning' },
          ];
          if (row.name && !same(row.name, person.fullName)) issues.push({ field: 'holder', label: 'Name on Airtel', dump: row.name, system: person.fullName, level: 'warning' });
          items.push({ status: 'MATCHED', key: conn, title: conn, subtitle, entity: { kind: 'EMPLOYEE', id: person.id, label: `${person.fullName} (${person.code})` }, issues, addSim });
        } else {
          items.push({ status: 'MISSING_IN_SYSTEM', key: conn, title: conn, subtitle: `Not in the SIM register${subtitle ? ` · ${subtitle}` : ''}`, entity: null, issues: [], addSim });
        }
        continue;
      }
      matched.add(asset.id);
      const issues: ReconIssue[] = [];
      const compare = (field: string, label: string, dump: string | null, system: string | null, equal: (a: string, b: string) => boolean = (a, b) => same(a, b)) => {
        if (!dump) return;
        if (!system) issues.push({ field, label, dump, system: null, level: 'warning' });
        else if (!equal(dump, system)) issues.push({ field, label, dump, system, level: 'error' });
      };
      compare('connectionNumber', 'Connection Number', row.connectionNumber, attr(asset, 'connection_number'), (a, b) => normalizePhone(a) === normalizePhone(b));
      compare('simNumber', 'SIM Number', row.simNumber, attr(asset, 'sim_number') ?? asset.serialNumber, (a, b) => normalizeIccid(a) === normalizeIccid(b));
      compare('plan', 'Plan', row.plan, attr(asset, 'plan'));
      compare('circle', 'Circle', row.circle, attr(asset, 'circle'));
      compare('billableId', 'Billable Account', row.billableId, attr(asset, 'billable_account'));

      const active = !row.status || /^active$/i.test(row.status);
      if (!active && asset.status === 'ASSIGNED') issues.push({ field: 'status', label: 'Status', dump: row.status, system: `Assigned to ${asset.holderName}`, level: 'error' });
      if (active && ['LOST', 'RETIRED'].includes(asset.status)) issues.push({ field: 'status', label: 'Status', dump: 'Active (still billed)', system: asset.status === 'LOST' ? 'Lost' : 'Retired', level: 'error' });

      const user = row.email ? byEmail.get(row.email.toLowerCase()) : undefined;
      if (user && !(asset.holderType === 'EMPLOYEE' && asset.holderId === user.id)) {
        issues.push({ field: 'holder', label: 'User', dump: `${user.fullName} (${row.email})`, system: asset.holderName ?? 'Not assigned', level: 'error' });
      } else if (!user && row.name && !normalizeText(stripCode(asset.holderName)).includes(normalizeText(row.name))) {
        issues.push({ field: 'holder', label: 'Registered name', dump: row.name, system: asset.holderName ?? 'Not assigned', level: 'warning' });
      }
      items.push({
        status: issues.some((i) => i.level === 'error') ? 'MISMATCH' : 'MATCHED',
        key: conn,
        title: conn,
        subtitle,
        entity: { kind: 'ASSET', id: asset.id, label: `${asset.assetTag} · ${asset.holderName ?? 'Not assigned'}` },
        issues,
      });
    }
    for (const s of sims) {
      const carrier = attr(s, 'carrier');
      if (matched.has(s.id) || ['LOST', 'RETIRED'].includes(s.status) || (carrier && !/airtel/i.test(carrier))) continue;
      items.push({
        status: 'MISSING_IN_DUMP',
        key: attr(s, 'connection_number') ?? s.assetTag,
        title: attr(s, 'connection_number') ?? s.assetTag,
        subtitle: 'In our SIM register but not in the Airtel file',
        entity: { kind: 'ASSET', id: s.id, label: `${s.assetTag} · ${s.holderName ?? 'Not assigned'}` },
        issues: [],
      });
    }
    return items;
  }

  // ─── Salary Box: one row per employee, matched to people and what they hold ─
  private salaryBox(rows: DumpRow[], allAssets: AssetRow[], people: Awaited<ReturnType<ReconciliationService['loadEmployees']>>): ReconItem[] {
    type Person = (typeof people)[number];
    const byCode = new Map<string, Person>();
    const byPhone = new Map<string, Person>();
    const byEmail = new Map<string, Person>();
    const byName = new Map<string, Person[]>();
    for (const p of people) {
      const k = employeeCodeKey(p.code);
      if (k) byCode.set(k, p);
      for (const ph of [p.phone, p.personalPhone]) {
        const n = normalizePhone(ph);
        if (n) byPhone.set(n, p);
      }
      for (const e of [p.email, p.personalEmail]) if (e) byEmail.set(e.toLowerCase(), p);
      const nm = normalizeText(p.fullName);
      byName.set(nm, [...(byName.get(nm) ?? []), p]);
    }

    // Identifier → asset, for what people wrote against their laptop / SIM / charger.
    const index = new Map<string, AssetRow>();
    const put = (k: string | null, a: AssetRow) => k && !index.has(k) && index.set(k, a);
    for (const a of allAssets) {
      const at = (k: string) => (a.attributes[k] ? String(a.attributes[k]).toUpperCase() : null);
      put(at('device_id'), a);
      put(at('device_name'), a);
      put(a.serialNumber ? a.serialNumber.toUpperCase() : null, a);
      if (a.typeCode === 'SIM') {
        put(normalizeIccid(at('sim_number') ?? a.serialNumber), a);
        put(normalizePhone(at('connection_number')), a);
      }
    }
    const heldBy = (id: string) => allAssets.filter((a) => a.holderType === 'EMPLOYEE' && a.holderId === id && ['LAP', 'SIM'].includes(a.typeCode));

    const codeCount = new Map<string, string[]>();
    for (const r of rows) {
      const k = employeeCodeKey(r.employeeCode);
      if (k) codeCount.set(k, [...(codeCount.get(k) ?? []), r.name ?? '?']);
    }

    const items: ReconItem[] = [];
    const matched = new Set<string>();
    for (const row of rows) {
      const codeKey = employeeCodeKey(row.employeeCode);
      const phone = normalizePhone(row.phone);
      const names = byName.get(normalizeText(row.name)) ?? [];
      const person =
        (codeKey ? byCode.get(codeKey) : undefined) ??
        (phone ? byPhone.get(phone) : undefined) ??
        [row.officialEmail, row.personalEmail].map((e) => (e ? byEmail.get(e.toLowerCase()) : undefined)).find(Boolean) ??
        (names.length === 1 ? names[0] : undefined);
      const title = row.name ?? row.employeeCode ?? 'Unnamed row';
      const subtitle = [row.employeeCode, row.designation, row.branch].filter(Boolean).join(' · ') || null;
      const issues: ReconIssue[] = [];
      const dupes = codeKey ? (codeCount.get(codeKey) ?? []) : [];
      if (dupes.length > 1) issues.push({ field: 'employeeCode', label: 'Employee ID used twice in Salary Box', dump: `${row.employeeCode}: ${dupes.join(', ')}`, system: null, level: 'error' });

      if (!person) {
        items.push({ status: 'MISSING_IN_SYSTEM', key: row.employeeCode ?? row.salaryBoxId ?? title, title, subtitle: `Not in employees${subtitle ? ` · ${subtitle}` : ''}`, entity: null, issues });
        continue;
      }
      matched.add(person.id);

      if (row.employeeCode && employeeCodeKey(row.employeeCode) !== employeeCodeKey(person.code)) issues.push({ field: 'employeeCode', label: 'Employee ID', dump: row.employeeCode, system: person.code, level: 'error' });
      else if (row.employeeCode && row.employeeCode.trim().toUpperCase() !== person.code.toUpperCase()) issues.push({ field: 'employeeCode', label: 'Employee ID written differently', dump: row.employeeCode, system: person.code, level: 'warning' });
      else if (!row.employeeCode) issues.push({ field: 'employeeCode', label: 'Employee ID missing in Salary Box', dump: null, system: person.code, level: 'warning' });

      if (row.name && !same(row.name, person.fullName)) issues.push({ field: 'name', label: 'Name', dump: row.name, system: person.fullName, level: 'warning' });
      if (phone && ![person.phone, person.personalPhone].some((p) => normalizePhone(p) === phone)) {
        issues.push({ field: 'phone', label: 'Phone', dump: row.phone, system: [person.personalPhone, person.phone].filter(Boolean).join(' / ') || null, level: person.phone || person.personalPhone ? 'error' : 'warning' });
      }
      const email = (field: string, label: string, dump: string | null, system: string | null) => {
        if (!dump || same(dump, system)) return;
        issues.push({ field, label, dump, system, level: system ? 'error' : 'warning' });
      };
      email('officialEmail', 'Official email', row.officialEmail, person.email);
      email('personalEmail', 'Personal email', row.personalEmail, person.personalEmail);
      if (row.department && !row.department.split(',').some((d) => same(d, person.departmentName))) {
        issues.push({ field: 'department', label: 'Department', dump: row.department, system: person.departmentName, level: person.departmentName ? 'error' : 'warning' });
      }
      if (row.designation && !same(row.designation, person.designation)) issues.push({ field: 'designation', label: 'Designation', dump: row.designation, system: person.designation, level: 'warning' });
      if (person.status === 'EXITED') issues.push({ field: 'status', label: 'Status', dump: 'On Salary Box', system: 'Exited', level: 'error' });

      // What Salary Box says they hold vs what the register says.
      const ids = extractIdentifiers([row.laptop, row.simDetails, row.charger, row.other].filter(Boolean).join(' '));
      const confirmed = new Set<string>();
      const check = (value: string, kind: string, strong: boolean) => {
        const a = index.get(value);
        if (!a) {
          if (strong) issues.push({ field: 'asset', label: `${kind} not in system`, dump: value, system: null, level: 'error' });
          return;
        }
        if (a.holderType === 'EMPLOYEE' && a.holderId === person.id) confirmed.add(a.id);
        else issues.push({ field: 'asset', label: `${kind} held by someone else`, dump: `${value} (${a.assetTag})`, system: a.holderName ? `With ${a.holderName}` : `Not assigned (${a.status.toLowerCase().replace(/_/g, ' ')})`, level: 'error' });
      };
      ids.guids.forEach((v) => check(v, 'Laptop device ID', true));
      ids.deviceNames.forEach((v) => check(v, 'Laptop device name', true));
      ids.iccids.forEach((v) => check(v, 'SIM number', true));
      const ownOfficial = normalizePhone(person.phone);
      ids.phones
        .filter((p) => p !== phone)
        .forEach((v) => {
          if (v === ownOfficial && !index.has(v)) issues.push({ field: 'asset', label: 'SIM not in register (their official phone)', dump: v, system: null, level: 'warning' });
          else check(v, 'SIM connection', true);
        });
      ids.serials.forEach((v) => check(v, 'Serial number', false));
      for (const a of heldBy(person.id)) {
        if (!confirmed.has(a.id)) issues.push({ field: 'asset', label: 'Not listed in Salary Box', dump: null, system: `${a.assetTag} · ${a.name}`, level: 'warning' });
      }

      items.push({
        status: issues.some((i) => i.level === 'error') ? 'MISMATCH' : 'MATCHED',
        key: person.code,
        title,
        subtitle,
        entity: { kind: 'EMPLOYEE', id: person.id, label: `${person.fullName} (${person.code})` },
        issues,
      });
    }
    for (const p of people) {
      if (matched.has(p.id) || p.status === 'EXITED' || p.status === 'JOINING') continue;
      items.push({ status: 'MISSING_IN_DUMP', key: p.code, title: p.fullName, subtitle: `${p.code} · in our employees but not in Salary Box`, entity: { kind: 'EMPLOYEE', id: p.id, label: `${p.fullName} (${p.code})` }, issues: [] });
    }
    return items;
  }
}
