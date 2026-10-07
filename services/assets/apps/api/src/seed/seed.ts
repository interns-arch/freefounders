import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { eq, sql } from 'drizzle-orm';
import { type Attributes, type HolderType, type Permission, SYSTEM_ROLES } from '@eam/shared';
import { AppModule } from '../app.module';
import type { Actor } from '../common/actor';
import { DbService } from '../db/db.service';
import { roles, users } from '../db/schema';
import { AllocationService } from '../modules/assets/allocation.service';
import { AssetsService } from '../modules/assets/assets.service';
import { LifecycleService } from '../modules/assets/lifecycle.service';
import { hashPassword } from '../modules/auth/auth.service';
import { CatalogService } from '../modules/catalog/catalog.service';
import { EmployeesService } from '../modules/employees/employees.service';
import { ExitService } from '../modules/exit/exit.service';
import { OrgService } from '../modules/org/org.service';
import { MaintenanceService } from '../modules/service/maintenance.service';
import { RequestsService } from '../modules/service/requests.service';
import { TicketsService } from '../modules/service/tickets.service';
import { CATALOG } from './catalog';

export const DEMO_PASSWORD = 'Demo@1234';

// Deterministic pseudo-random numbers so every fresh install looks the same.
let state = 20260923;
const rand = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pad = (n: number, w: number) => String(n).padStart(w, '0');
const daysFromNow = (d: number) => {
  const t = new Date(Date.now() + d * 86_400_000);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1, 2)}-${pad(t.getDate(), 2)}`;
};
const serial = (prefix: string) => `${prefix}${Array.from({ length: 8 }, () => pick('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'.split(''))).join('')}`;

const hex = (n: number) => Array.from({ length: n }, () => '0123456789ABCDEF'[Math.floor(rand() * 16)]).join('');
const deviceId = () => `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Ananya', 'Diya', 'Ishaan', 'Kavya', 'Rohan', 'Sneha', 'Arjun', 'Meera', 'Nikhil', 'Pooja', 'Siddharth', 'Tanvi', 'Varun', 'Riya', 'Harsh', 'Divya', 'Kunal', 'Aisha', 'Manish', 'Shreya', 'Yash', 'Nisha', 'Gaurav', 'Priya', 'Amit', 'Swati', 'Rajesh'];
const LAST = ['Patel', 'Iyer', 'Gupta', 'Reddy', 'Nair', 'Joshi', 'Kulkarni', 'Desai', 'Menon', 'Chopra', 'Bose', 'Pillai', 'Verma', 'Shetty', 'Bhat', 'Agarwal', 'Mishra', 'Khanna'];

/** The starter asset catalog (categories, types, custom fields) — the same for demo and live installs. */
async function loadCatalog(catalog: CatalogService, admin: Actor) {
  const types: Record<string, { id: string; trackingMode: string }> = {};
  for (const c of CATALOG) {
    const cat = await catalog.createCategory(admin, { name: c.name, code: c.code, icon: c.icon, color: c.color, description: c.description });
    for (const f of c.fields ?? []) {
      await catalog.createField(admin, { ...f, categoryId: cat.id, required: f.required ?? false, isUnique: f.isUnique ?? false, showInTable: f.showInTable ?? false, filterable: true, options: f.options ?? null });
    }
    for (const t of c.types) {
      const type = await catalog.createType(admin, { categoryId: cat.id, name: t.name, code: t.code, icon: t.icon, description: t.description ?? null, trackingMode: t.trackingMode ?? 'INDIVIDUAL', consumable: t.consumable ?? false });
      types[t.code] = { id: type.id, trackingMode: type.trackingMode };
      for (const f of t.fields ?? []) {
        await catalog.createField(admin, { ...f, assetTypeId: type.id, required: f.required ?? false, isUnique: f.isUnique ?? false, showInTable: f.showInTable ?? false, filterable: true, options: f.options ?? null });
      }
    }
  }
  return types;
}

const DEPARTMENTS: [string, string][] = [
  ['IT and Data', 'ITD'],
  ['Inside and Field Sales', 'SAL'],
  ['Human Resources', 'HR'],
  ['Accounts and Finance', 'FIN'],
  ['IT Support', 'ITS'],
  ['Operations', 'OPS'],
  ['Warehouse', 'WH'],
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const dbs = app.get(DbService);
  const force = process.argv.includes('--force');

  const [{ n }] = await dbs.root.select({ n: sql<number>`count(*)::int` }).from(roles);
  if (n > 0 && !force) {
    console.log('ℹ Database already seeded — skipping (use --force on an empty database).');
    await app.close();
    return;
  }

  const org = app.get(OrgService);
  const catalog = app.get(CatalogService);
  const employeesSvc = app.get(EmployeesService);
  const assetsSvc = app.get(AssetsService);
  const allocation = app.get(AllocationService);
  const lifecycle = app.get(LifecycleService);
  const maintenance = app.get(MaintenanceService);
  const requests = app.get(RequestsService);
  const tickets = app.get(TicketsService);
  const exits = app.get(ExitService);

  // ── Roles & first admin ─────────────────────────────────────────────────
  const roleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) {
    const [row] = await dbs.root.insert(roles).values({ name: r.name, description: r.description, permissions: r.permissions, isSystem: true }).returning();
    roleIds[r.name] = row.id;
  }

  // Live install: roles, the first admin, the company, departments and the asset catalog — no demo data.
  if (process.argv.includes('--bootstrap')) {
    const login = (process.env.ADMIN_EMAIL ?? process.env.ADMIN_LOGIN ?? 'admin').trim().toLowerCase();
    // Without ADMIN_PASSWORD a one-time password is generated and printed once in the server log.
    const generated = !process.env.ADMIN_PASSWORD;
    const password = process.env.ADMIN_PASSWORD ?? randomBytes(9).toString('base64url');
    if (password.length < 8) {
      console.error('✖ ADMIN_PASSWORD must be at least 8 characters.');
      process.exitCode = 1;
      await app.close();
      return;
    }
    const isEmail = login.includes('@');
    const [first] = await dbs.root
      .insert(users)
      .values({ email: isEmail ? login : null, username: isEmail ? null : login, name: process.env.ADMIN_NAME ?? 'Administrator', passwordHash: await hashPassword(password), roleId: roleIds.Admin })
      .returning();
    const actor: Actor = { userId: first.id, name: first.name, email: first.email, employeeId: null, roleName: 'Admin', permissions: new Set(SYSTEM_ROLES[0].permissions as Permission[]) };
    const company = (await org.create('companies', actor, { name: process.env.COMPANY_NAME ?? 'CARTREND AUTOPARTS PVT LTD', code: 'CARTREND' })) as { id: string };
    await org.create('locations', actor, { name: 'Main store', code: 'STORE', type: 'WAREHOUSE', isStore: true, companyId: company.id });
    for (const [name, deptCode] of DEPARTMENTS) await org.create('departments', actor, { name, code: deptCode, companyId: company.id });
    await loadCatalog(catalog, actor);
    console.log('✔ Live install ready: roles, company, departments and the asset catalog (no demo data).');
    console.log(`✔ First admin — sign in with: ${login}`);
    if (generated) console.log(`  One-time password: ${password}   ← change it after signing in (top-right menu → Change password)`);
    await app.close();
    return;
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const [adminUser] = await dbs.root
    .insert(users)
    .values({ email: 'admin@cartrend.test', name: 'Aditi Rao', passwordHash, roleId: roleIds.Admin })
    .returning();
  const admin: Actor = {
    userId: adminUser.id,
    name: adminUser.name,
    email: adminUser.email,
    employeeId: null,
    roleName: 'Admin',
    permissions: new Set(SYSTEM_ROLES[0].permissions as Permission[]),
  };

  // ── Organisation ────────────────────────────────────────────────────────
  const acme = (await org.create('companies', admin, {
    name: 'Cartrend Autoparts Pvt Ltd',
    code: 'CARTREND',
    legalName: 'Cartrend Autoparts Private Limited',
    address: 'Near Old PO, Bijwasan, New Delhi 110061',
  })) as { id: string };
  // One company: the warehouse belongs to it too.
  const logistics = acme;

  const loc = async (name: string, code: string, type: string, extra: Record<string, unknown> = {}) =>
    ((await org.create('locations', admin, { name, code, type, isStore: false, companyId: acme.id, ...extra })) as { id: string }).id;
  const mumbai = await loc('Bijwasan HO', 'BJW-HO', 'OFFICE', { address: 'Near Old PO, Bijwasan, New Delhi 110061' });
  const mumbai3 = await loc('Bijwasan HO · Ground Floor', 'BJW-GF', 'FLOOR', { parentId: mumbai });
  const mumbai4 = await loc('Bijwasan HO · First Floor', 'BJW-FF', 'FLOOR', { parentId: mumbai });
  const itStore = await loc('IT Store Room', 'BJW-ITS', 'ROOM', { parentId: mumbai3, isStore: true });
  const serverRoom = await loc('Server Room', 'BJW-SRV', 'ROOM', { parentId: mumbai4 });
  const pune = await loc('Bijwasan Warehouse', 'BJW-WH', 'WAREHOUSE', { isStore: true, address: 'Bijwasan, New Delhi 110061' });
  const blr = await loc('Karol Bagh Branch', 'KB', 'OFFICE', { address: 'Karol Bagh, New Delhi 110005' });
  const jaipur = await loc('Car Mall Jaipur', 'JPR', 'OFFICE', { address: 'Car Mall, Jaipur, Rajasthan' });
  const parking = await loc('Bijwasan HO · Parking', 'BJW-PK', 'SITE', { parentId: mumbai });
  const officeLocations = [mumbai3, mumbai4, blr, jaipur];

  const dept = async (name: string, code: string, companyId = acme.id) =>
    ((await org.create('departments', admin, { name, code, companyId })) as { id: string }).id;
  const depts = {
    engineering: await dept('IT and Data', 'ITD'),
    sales: await dept('Inside and Field Sales', 'SAL'),
    hr: await dept('Human Resources', 'HR'),
    finance: await dept('Accounts and Finance', 'FIN'),
    it: await dept('IT Support', 'ITS'),
    operations: await dept('Operations', 'OPS'),
    logistics: await dept('Warehouse', 'WH'),
  };

  const vendor = async (name: string, extra: Record<string, unknown> = {}) => ((await org.create('vendors', admin, { name, ...extra })) as { id: string }).id;
  const vendors = {
    dell: await vendor('Dell Technologies India', { contactName: 'Rakesh Menon', email: 'enterprise@dell.example', phone: '+91 80 4000 1000' }),
    apple: await vendor('Ingram Micro (Apple)', { contactName: 'Farah Khan', email: 'apple@ingram.example' }),
    hp: await vendor('HP India', { email: 'b2b@hp.example' }),
    lenovo: await vendor('Lenovo India', { email: 'sales@lenovo.example' }),
    honda: await vendor('Honda 2Wheelers, Dwarka', { phone: '+91 11 4500 1234' }),
    tata: await vendor('Tata Motors Fleet', { email: 'fleet@tata.example' }),
    airtel: await vendor('Airtel Business', { email: 'corporate@airtel.example' }),
    microsoft: await vendor('Microsoft India', { website: 'https://microsoft.com' }),
    godrej: await vendor('Godrej Interio', { email: 'office@godrej.example' }),
    karam: await vendor('Karam Safety', { email: 'orders@karam.example' }),
    canon: await vendor('Canon India', {}),
    service: await vendor('QuickFix IT Services', { contactName: 'Imran Shaikh', phone: '+91 98200 11223', notes: 'Laptop and printer repair partner' }),
  };

  // ── Catalog ─────────────────────────────────────────────────────────────
  const types = await loadCatalog(catalog, admin);

  // ── Employees & logins ──────────────────────────────────────────────────
  let code = 0;
  const emp = async (firstName: string, lastName: string, departmentId: string, designation: string, extra: Record<string, unknown> = {}) => {
    code += 1;
    const e = await employeesSvc.create(admin, {
      employeeCode: `CT${pad(code, 6)}`,
      firstName,
      lastName,
      email: `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, '') + '@cartrend.test',
      phone: `+91 9${int(100000000, 999999999)}`,
      personalPhone: `+91 ${pick(['6', '7', '8', '9'])}${int(100000000, 999999999)}`,
      personalEmail: `${firstName.toLowerCase()}${int(10, 99)}@gmail.test`,
      designation,
      companyId: acme.id,
      departmentId,
      locationId: pick(officeLocations),
      managerId: null,
      joinDate: daysFromNow(-int(60, 2200)),
      notes: null,
      ...extra,
    });
    return e.id;
  };
  const aditi = await emp('Aditi', 'Rao', depts.it, 'Head of IT', { locationId: mumbai4 });
  const vikram = await emp('Vikram', 'Singh', depts.it, 'IT Asset Manager', { locationId: mumbai3, managerId: aditi });
  const neha = await emp('Neha', 'Kapoor', depts.hr, 'HR Business Partner', { locationId: mumbai4 });
  const sanjay = await emp('Sanjay', 'Rao', depts.sales, 'Sales Manager', { locationId: mumbai3 });
  const rahul = await emp('Rahul', 'Sharma', depts.sales, 'Senior Sales Executive', { locationId: mumbai3, managerId: sanjay, email: 'rahul.sharma@cartrend.test' });
  const karan = await emp('Karan', 'Malhotra', depts.engineering, 'Software Engineer', { locationId: blr });

  await dbs.root.update(users).set({ employeeId: aditi }).where(eq(users.id, adminUser.id));
  const login = (email: string, name: string, role: string, employeeId: string) =>
    dbs.root.insert(users).values({ email, name, passwordHash, roleId: roleIds[role], employeeId });
  await login('it@cartrend.test', 'Vikram Singh', 'IT / Asset Manager', vikram);
  await login('hr@cartrend.test', 'Neha Kapoor', 'HR', neha);
  await login('manager@cartrend.test', 'Sanjay Rao', 'Manager', sanjay);
  await login('rahul@cartrend.test', 'Rahul Sharma', 'Employee', rahul);
  await dbs.root.insert(users).values({ email: 'ceo@cartrend.test', name: 'Managing Director', passwordHash, roleId: roleIds.Leadership });

  const deptList = [depts.engineering, depts.engineering, depts.engineering, depts.sales, depts.sales, depts.finance, depts.operations, depts.hr, depts.it, depts.logistics];
  const designations: Record<string, string[]> = {
    [depts.engineering]: ['Full Stack Developer', 'Data Analyst', 'QA Engineer'],
    [depts.sales]: ['Sales Executive', 'Field Sales Executive', 'CRM Leads', 'Inside Sales Executive'],
    [depts.finance]: ['Account Executive', 'Accountant'],
    [depts.operations]: ['Operations Executive', 'Picker and Packer'],
    [depts.hr]: ['HR Executive', 'Recruiter'],
    [depts.it]: ['IT Support Engineer', 'Network Engineer'],
    [depts.logistics]: ['Warehouse Supervisor', 'Picker and Packer', 'Driver'],
  };
  const staff: string[] = [karan];
  const used = new Set(['Rahul Sharma', 'Karan Malhotra']);
  while (staff.length < 34) {
    const f = pick(FIRST);
    const l = pick(LAST);
    if (used.has(`${f} ${l}`)) continue;
    used.add(`${f} ${l}`);
    const d = pick(deptList);
    staff.push(
      await emp(f, l, d, pick(designations[d]), {
        managerId: d === depts.sales ? sanjay : d === depts.it ? aditi : null,
        locationId: d === depts.logistics ? pune : pick(officeLocations),
        companyId: d === depts.logistics ? logistics.id : acme.id,
      }),
    );
  }

  // ── Assets ──────────────────────────────────────────────────────────────
  type Holder = { holderType: HolderType; holderId: string } | null;
  const add = async (
    typeCode: string,
    name: string,
    attributes: Attributes,
    opts: {
      holder?: Holder;
      status?: 'PURCHASED' | 'RECEIVED' | 'IN_INVENTORY' | 'AVAILABLE';
      vendorId?: string;
      cost?: number;
      manufacturer?: string;
      model?: string;
      serial?: string | null;
      locationId?: string;
      quantity?: number;
      warrantyDays?: number;
      ownership?: 'OWNED' | 'LEASED' | 'RENTED' | 'SUBSCRIPTION' | 'LICENSED';
      ownerCompanyId?: string;
    } = {},
  ) => {
    const status = opts.status ?? (opts.holder ? 'AVAILABLE' : 'AVAILABLE');
    const a = await assetsSvc.create(admin, {
      assetTypeId: types[typeCode].id,
      name,
      status,
      condition: 'GOOD',
      serialNumber: opts.serial === undefined ? serial(typeCode.slice(0, 2)) : opts.serial,
      manufacturer: opts.manufacturer ?? null,
      model: opts.model ?? null,
      description: null,
      ownership: opts.ownership ?? 'OWNED',
      ownerCompanyId: opts.ownerCompanyId ?? acme.id,
      vendorId: opts.vendorId ?? null,
      purchaseDate: daysFromNow(-int(30, 1100)),
      purchaseCost: opts.cost ?? null,
      currency: 'INR',
      invoiceNumber: `INV-${int(10000, 99999)}`,
      warrantyExpiry: opts.warrantyDays !== undefined ? daysFromNow(opts.warrantyDays) : daysFromNow(int(-200, 900)),
      locationId: opts.locationId ?? (status === 'IN_INVENTORY' ? itStore : mumbai3),
      attributes,
      quantity: opts.quantity ?? 1,
      assignTo: opts.holder ?? null,
    });
    return a.id;
  };
  const toEmp = (id: string): Holder => ({ holderType: 'EMPLOYEE', holderId: id });

  const laptopModels = [
    { m: 'Dell', model: 'Latitude 7440', v: vendors.dell, cpu: 'Intel Core i7-1365U', cost: 118000 },
    { m: 'Lenovo', model: 'ThinkPad T14 Gen 4', v: vendors.lenovo, cpu: 'Intel Core i5-1345U', cost: 96000 },
    { m: 'Apple', model: 'MacBook Pro 14 M3', v: vendors.apple, cpu: 'Apple M3 Pro', cost: 199000 },
    { m: 'HP', model: 'EliteBook 840 G10', v: vendors.hp, cpu: 'Intel Core i7-1355U', cost: 112000 },
  ];
  const laptop = (holder: Holder, forceModel?: number, extra: Parameters<typeof add>[3] = {}) => {
    const lm = forceModel !== undefined ? laptopModels[forceModel] : pick(laptopModels);
    const mac = lm.m === 'Apple';
    return add(
      'LAP',
      `${lm.m} ${lm.model}`,
      {
        processor: lm.cpu,
        ram_gb: pick([16, 16, 32]),
        storage_gb: pick([512, 512, 1024]),
        storage_type: 'NVMe SSD',
        operating_system: mac ? 'macOS' : 'Windows 11',
        screen_size_inch: 14,
        ...(mac ? {} : { device_name: `LAPTOP-${serial('').slice(0, 7)}`, device_id: deviceId() }),
      },
      { holder, vendorId: lm.v, manufacturer: lm.m, model: lm.model, cost: lm.cost, ...extra },
    );
  };
  const charger = (holder: Holder, extra: Parameters<typeof add>[3] = {}) =>
    add('CHG', pick(['Dell 65W USB-C Charger', 'Lenovo 65W USB-C Adapter', 'Apple 96W USB-C Power Adapter']), { wattage_w: pick([65, 65, 96]), connector: 'USB-C' }, { holder, cost: 3500, ...extra });

  // Rahul Sharma: the full exit example — laptop, charger, SIM, access card, scooty, helmet, keys.
  await laptop(toEmp(rahul), 0);
  await charger(toEmp(rahul), { serial: 'DL65W-RS-0412' });
  await add('SIM', 'Airtel Corporate SIM', { connection_number: '9000000775', billable_account: '1-0000000000000', circle: 'DL', plan: 'INFINITY_299_30GB_CORP_PLAN', sim_number: '89910000000000000000U', carrier: 'Airtel', monthly_data_gb: 30 }, { holder: toEmp(rahul), vendorId: vendors.airtel, serial: '89910000000000000000U', cost: 0, ownership: 'SUBSCRIPTION' });
  await add('ACC', 'Access Card — Bijwasan HO', { card_number: 'AC-BJW-30451', access_zones: ['Main Entrance', 'Office Floor', 'Parking'] }, { holder: toEmp(rahul), serial: null, cost: 350 });
  await add(
    'SCT',
    'Honda Activa 6G',
    { registration_no: 'DL-02-EK-4521', engine_no: 'JF50E-7210458', chassis_no: 'ME4JF50AMNT210458', fuel_type: 'Petrol', insurance_policy_no: 'ICICI-2W-88213', insurance_expiry: daysFromNow(140), puc_expiry: daysFromNow(60), engine_cc: 110 },
    { holder: toEmp(rahul), vendorId: vendors.honda, manufacturer: 'Honda', model: 'Activa 6G', cost: 82000, serial: null, locationId: parking },
  );
  await add('HLM', 'Steelbird ISI Helmet', { size: 'L', isi_certified: true }, { holder: toEmp(rahul), vendorId: vendors.karam, cost: 1800, serial: null });
  await add('KEY', 'Sales Cabin Keys', { key_number: 'K-3-SAL-07', opens: 'Sales cabin 7 & drawer, Floor 3', copies_issued: 1 }, { holder: toEmp(rahul), serial: null, cost: 0 });

  // Karan Malhotra is already on notice — gives the Exits page some life.
  await laptop(toEmp(karan), 2);
  await charger(toEmp(karan));
  await add('MON', 'Dell UltraSharp 27', { screen_size_inch: 27, resolution: '2560x1440', panel: 'IPS' }, { holder: toEmp(karan), vendorId: vendors.dell, manufacturer: 'Dell', model: 'U2723QE', cost: 42000 });
  await add('ACC', 'Access Card — Karol Bagh', { card_number: 'AC-KB-11873', access_zones: ['Main Entrance', 'Office Floor'] }, { holder: toEmp(karan), serial: null, cost: 350 });

  // Leadership & IT.
  for (const id of [aditi, vikram, neha, sanjay]) {
    await laptop(toEmp(id), 2);
    await add('MOB', 'Apple iPhone 15', { imei: `35${int(1000000000000, 9999999999999)}`, storage_gb: '128', operating_system: 'iOS' }, { holder: toEmp(id), vendorId: vendors.apple, manufacturer: 'Apple', model: 'iPhone 15', cost: 72000 });
  }

  // Everyone else gets a laptop + charger, and some get more.
  for (const id of staff.slice(1)) {
    await laptop(toEmp(id));
    await charger(toEmp(id));
    if (rand() < 0.45) await add('MON', pick(['Dell P2422H', 'LG 27UL500', 'Samsung S24']), { screen_size_inch: pick([24, 27]), resolution: pick(['1920x1080', '3840x2160']), panel: 'IPS' }, { holder: toEmp(id), cost: 16000 });
    if (rand() < 0.35) await add('HDS', pick(['Jabra Evolve2 65', 'Logitech Zone Vibe']), { wireless: true, noise_cancelling: rand() < 0.5 }, { holder: toEmp(id), cost: 9000 });
    if (rand() < 0.3) {
      const iccid = `899110${int(1000000000000, 9999999999999)}U`;
      await add(
        'SIM',
        'Airtel Corporate SIM',
        { connection_number: `92${int(10000000, 99999999)}`, billable_account: '1-0000000000000', circle: 'DL', plan: 'Postpaid 349_30GB CORP PLAN_PKG_51320', sim_number: iccid, carrier: 'Airtel' },
        { holder: toEmp(id), vendorId: vendors.airtel, serial: iccid, cost: 0, ownership: 'SUBSCRIPTION' },
      );
    }
    await add('ACC', 'Access Card', { card_number: `AC-${int(10000, 99999)}`, access_zones: ['Main Entrance', 'Office Floor'] }, { holder: toEmp(id), serial: null, cost: 350 });
  }

  // Spares in stores / available.
  for (let i = 0; i < 6; i++) await laptop(null, i % 4, { status: 'IN_INVENTORY', locationId: i < 4 ? itStore : pune });
  for (let i = 0; i < 4; i++) await laptop(null, 1);
  for (let i = 0; i < 5; i++) await charger(null, { status: 'IN_INVENTORY', locationId: itStore });
  for (let i = 0; i < 3; i++) await add('MSE', 'Logitech MX Anywhere 3', { wireless: true }, { cost: 5500 });
  for (let i = 0; i < 3; i++) await add('KBD', 'Logitech MX Keys', { wireless: true, layout: 'US' }, { cost: 9000 });
  await add('MOB', 'Samsung Galaxy S24', { imei: `35${int(1000000000000, 9999999999999)}`, storage_gb: '256', operating_system: 'Android' }, { cost: 65000 });
  await add('TAB', 'Apple iPad Air', { storage_gb: '128', cellular: true }, { holder: { holderType: 'DEPARTMENT', holderId: depts.sales }, cost: 60000 });
  await laptop(null, 3, { status: 'PURCHASED', vendorId: vendors.hp });
  await laptop(null, 0, { status: 'RECEIVED' });

  // Department / location / company / vendor holders.
  await add('PRN', 'HP LaserJet Pro MFP 4104', { printer_type: 'Multifunction', colour: false, ip_address: '10.0.3.21' }, { holder: { holderType: 'DEPARTMENT', holderId: depts.finance }, vendorId: vendors.hp, cost: 38000, locationId: mumbai3 });
  await add('PRN', 'Canon imageRUNNER C3326i', { printer_type: 'Laser', colour: true, ip_address: '10.0.4.10' }, { holder: { holderType: 'LOCATION', holderId: mumbai4 }, vendorId: vendors.canon, cost: 210000 });
  await add('PRJ', 'Epson EB-L630U', { lumens: 6200, resolution: '1080p' }, { holder: { holderType: 'DEPARTMENT', holderId: depts.sales }, cost: 145000 });
  await add('TV', 'Samsung 65" Crystal 4K', { screen_size_inch: 65, smart_tv: true }, { holder: { holderType: 'LOCATION', holderId: mumbai4 }, cost: 72000 });
  await add('SRV', 'Dell PowerEdge R760', { cpu_cores: 32, ram_gb: 256, rack_position: 'Rack A · U10', ip_address: '10.0.0.10' }, { holder: { holderType: 'LOCATION', holderId: serverRoom }, vendorId: vendors.dell, cost: 890000, manufacturer: 'Dell', model: 'R760' });
  await add('SRV', 'Dell PowerEdge R660', { cpu_cores: 16, ram_gb: 128, rack_position: 'Rack A · U14', ip_address: '10.0.0.11' }, { holder: { holderType: 'LOCATION', holderId: serverRoom }, vendorId: vendors.dell, cost: 540000 });
  await add('RTR', 'Cisco Catalyst 9200', { ports: 48, ip_address: '10.0.0.1', firmware: 'IOS-XE 17.9' }, { holder: { holderType: 'LOCATION', holderId: serverRoom }, cost: 310000 });
  await add('UPS', 'APC Smart-UPS 3000VA', { capacity_va: 3000, battery_replaced_on: daysFromNow(-400) }, { holder: { holderType: 'LOCATION', holderId: serverRoom }, cost: 125000 });
  await add('CAM', 'Canon EOS R6 Mark II', { lens: '24-105mm f/4', megapixels: 24, memory_card: '128GB SD UHS-II' }, { holder: { holderType: 'DEPARTMENT', holderId: depts.operations }, vendorId: vendors.canon, cost: 243000 });
  await add('CAM', 'Sony ZV-E10', { lens: '16-50mm', megapixels: 24, memory_card: '64GB SD' }, { cost: 62000 });
  await add('POS', 'Pine Labs Plutus Smart', { terminal_id: 'PL-MUM-00921', acquiring_bank: 'HDFC Bank' }, { holder: { holderType: 'LOCATION', holderId: mumbai }, cost: 0, ownership: 'RENTED' });
  await add('SCN', 'Zebra DS2208 Barcode Scanner', { scanner_type: 'Handheld barcode' }, { holder: { holderType: 'LOCATION', holderId: pune }, cost: 7500 });

  await add('CAR', 'Toyota Innova Crysta', { registration_no: 'DL-01-DX-7788', engine_no: '2GD-4418821', chassis_no: 'MBJ11JV4007712', fuel_type: 'Diesel', insurance_policy_no: 'HDFC-CAR-55120', insurance_expiry: daysFromNow(22), puc_expiry: daysFromNow(90), seating_capacity: 7 }, { holder: { holderType: 'COMPANY', holderId: acme.id }, cost: 2450000, locationId: parking, manufacturer: 'Toyota', model: 'Innova Crysta', serial: null });
  await add('CAR', 'Maruti Suzuki Ciaz', { registration_no: 'DL-02-FB-1290', fuel_type: 'Petrol', insurance_expiry: daysFromNow(210), seating_capacity: 5 }, { holder: toEmp(sanjay), cost: 1100000, locationId: parking, serial: null });
  await add('BIK', 'Bajaj Pulsar 150', { registration_no: 'DL-12-KT-3301', fuel_type: 'Petrol', insurance_expiry: daysFromNow(300), engine_cc: 150 }, { holder: toEmp(staff[5]), cost: 115000, serial: null });
  await add('SCT', 'TVS Jupiter', { registration_no: 'DL-02-EZ-8812', fuel_type: 'Petrol', insurance_expiry: daysFromNow(95), engine_cc: 110 }, { cost: 78000, serial: null, locationId: parking });
  await add('VAN', 'Tata Winger', { registration_no: 'DL-14-GU-4410', fuel_type: 'Diesel', insurance_expiry: daysFromNow(45), seating_capacity: 12 }, { holder: { holderType: 'COMPANY', holderId: logistics.id }, vendorId: vendors.tata, ownerCompanyId: logistics.id, cost: 1650000, locationId: pune, serial: null });
  await add('TRK', 'Tata Ultra T.7', { registration_no: 'DL-14-HB-0092', fuel_type: 'Diesel', insurance_expiry: daysFromNow(12), load_capacity_t: 7 }, { holder: { holderType: 'DEPARTMENT', holderId: depts.logistics }, vendorId: vendors.tata, ownerCompanyId: logistics.id, cost: 2100000, locationId: pune, serial: null, ownership: 'LEASED' });
  await add('FLT', 'Godrej GX 300 Electric Forklift', { fuel_type: 'Electric', lift_capacity_kg: 2500 }, { holder: { holderType: 'LOCATION', holderId: pune }, ownerCompanyId: logistics.id, cost: 1350000 });

  await add('MCH', 'Industrial Shrink Wrapping Machine', { power_kw: 7.5, next_service: daysFromNow(18) }, { holder: { holderType: 'LOCATION', holderId: pune }, ownerCompanyId: logistics.id, cost: 450000 });
  await add('TST', 'Fluke 87V Multimeter', { calibration_due: daysFromNow(35), accuracy: '±0.05%' }, { holder: { holderType: 'DEPARTMENT', holderId: depts.it }, cost: 42000 });
  await add('TOL', 'Bosch GSB 180 Drill Kit', { tool_kind: 'Power tool' }, { holder: { holderType: 'DEPARTMENT', holderId: depts.operations }, cost: 6500 });
  await add('ELE', 'Extension Board 6-way (Surge)', { voltage_v: 230, power_w: 2500 }, { cost: 1200 });

  for (let i = 0; i < 6; i++) {
    await add('FEX', `Fire Extinguisher ${pick(['ABC 6kg', 'CO2 4.5kg'])}`, { extinguisher_type: pick(['ABC', 'CO2']), capacity_kg: pick([4.5, 6]), refill_due: daysFromNow(int(-10, 300)) }, { holder: { holderType: 'LOCATION', holderId: pick([mumbai3, mumbai4, pune, blr]) }, cost: 3200, serial: null });
  }
  for (let i = 0; i < 4; i++) await add('HLM', 'Karam Safety Helmet', { size: pick(['M', 'L']), isi_certified: true }, { holder: i < 3 ? toEmp(staff[staff.length - 1 - i]) : null, vendorId: vendors.karam, cost: 650, serial: null });
  await add('SHO', 'Karam FS 21 Safety Shoes', { size_uk: 9 }, { holder: toEmp(staff[staff.length - 1]), cost: 1900, serial: null });

  for (let i = 0; i < 4; i++) await add('AC', `Daikin ${pick(['1.5', '2'])}T Split AC`, { tonnage: pick([1.5, 2]), star_rating: pick(['3', '5']) }, { holder: { holderType: 'LOCATION', holderId: pick([mumbai3, mumbai4, blr]) }, cost: 52000 });
  await add('GEN', 'Kirloskar 125 kVA DG Set', { capacity_kva: 125, fuel: 'Diesel' }, { holder: { holderType: 'LOCATION', holderId: mumbai }, cost: 1450000 });
  for (let i = 0; i < 5; i++) await add('CCTV', 'Hikvision 4MP Dome Camera', { resolution: '4MP', nvr_channel: i + 1 }, { holder: { holderType: 'LOCATION', holderId: pick([mumbai, pune]) }, cost: 4800 });
  await add('APL', 'LG 260L Refrigerator', { appliance_kind: 'Refrigerator' }, { holder: { holderType: 'LOCATION', holderId: mumbai4 }, cost: 28000 });
  for (let i = 0; i < 6; i++) await add('CHR', 'Featherlite Mesh Chair', { material: 'Mesh', ergonomic: true }, { holder: { holderType: 'LOCATION', holderId: pick([mumbai3, mumbai4]) }, vendorId: vendors.godrej, cost: 11500, serial: null });
  await add('DSK', 'Godrej Height Adjustable Desk', { width_cm: 140, height_adjustable: true }, { holder: toEmp(aditi), vendorId: vendors.godrej, cost: 38000, serial: null });
  await add('CAB', 'Godrej Steel Cabinet', { drawers: 4, lockable: true }, { holder: { holderType: 'DEPARTMENT', holderId: depts.hr }, vendorId: vendors.godrej, cost: 16000, serial: null });
  await add('KEY', 'Server Room Key', { key_number: 'K-4-SRV-01', opens: 'Server room, Floor 4', copies_issued: 2 }, { holder: toEmp(vikram), serial: null, cost: 0 });

  await add('DOM', 'cartrends.in', { domain_name: 'cartrends.in', registrar: 'GoDaddy', domain_expiry: daysFromNow(64), auto_renew: true }, { serial: null, cost: 1200, ownership: 'SUBSCRIPTION', warrantyDays: 64 });
  await add('CLD', 'AWS Production Account', { provider: 'AWS', account_id: '4821-0093-1172', owner_email: 'cloud@cartrend.test', console_url: 'https://console.aws.amazon.com' }, { holder: { holderType: 'DEPARTMENT', holderId: depts.engineering }, serial: null, cost: 0, ownership: 'SUBSCRIPTION' });
  await add('SUB', 'Slack Business+', { plan: 'Business+', billing_cycle: 'Yearly', renewal_date: daysFromNow(180), seats: 60 }, { holder: { holderType: 'COMPANY', holderId: acme.id }, serial: null, cost: 540000, ownership: 'SUBSCRIPTION' });
  await add('PRP', 'Bijwasan Warehouse Building', { address: 'Bijwasan, New Delhi 110061', area_sq_ft: 42000 }, { holder: { holderType: 'COMPANY', holderId: logistics.id }, ownerCompanyId: logistics.id, cost: 145000000, serial: null, locationId: pune });
  await add('LSE', 'Karol Bagh Branch Lease', { lease_start: daysFromNow(-500), lease_end: daysFromNow(595), monthly_rent: 850000 }, { holder: { holderType: 'COMPANY', holderId: acme.id }, serial: null, ownership: 'LEASED', locationId: blr });

  // Pooled (quantity-tracked) assets.
  const m365 = await add('LIC', 'Microsoft 365 Business Premium', { product_version: '2025', license_expiry: daysFromNow(210) }, { quantity: 50, vendorId: vendors.microsoft, serial: null, cost: 1100000, ownership: 'LICENSED' });
  for (const id of [karan, aditi, vikram, neha, sanjay, ...staff.slice(1, 22)]) {
    await allocation.assign(admin, m365, { holderType: 'EMPLOYEE', holderId: id, quantity: 1 });
  }
  const adobe = await add('LIC', 'Adobe Creative Cloud', { product_version: '2025', license_expiry: daysFromNow(28) }, { quantity: 8, serial: null, cost: 480000, ownership: 'LICENSED' });
  for (const id of staff.slice(1, 4)) await allocation.assign(admin, adobe, { holderType: 'EMPLOYEE', holderId: id, quantity: 1 });
  const gloves = await add('GLV', 'Nitrile Gloves (pairs)', { glove_type: 'Nitrile' }, { quantity: 500, vendorId: vendors.karam, serial: null, cost: 15000, locationId: pune });
  await allocation.assign(admin, gloves, { holderType: 'DEPARTMENT', holderId: depts.logistics, quantity: 120 });
  await add('STN', 'Welcome Stationery Kit', { unit: 'Kit' }, { quantity: 80, serial: null, cost: 24000, locationId: itStore });
  await add('JKT', 'Joining Kit', { contents: 'Bag, T-shirt, diary, pen, lanyard' }, { quantity: 40, serial: null, cost: 0, locationId: itStore });
  await add('INV', 'USB-C to HDMI Adapter', { sku: 'ADP-UC-HDMI' }, { quantity: 40, serial: null, cost: 32000, locationId: itStore });

  // A warehouse worker with no email: signs in with his employee ID and only sees his own kit.
  const anil = await emp('Anil', 'Yadav', depts.logistics, 'Picker and Packer', {
    employeeCode: 'CT000099',
    email: null,
    phone: null,
    personalEmail: null,
    locationId: pune,
    companyId: logistics.id,
  });
  await add('HLM', 'Karam Safety Helmet', { size: 'L', isi_certified: true }, { holder: toEmp(anil), vendorId: vendors.karam, cost: 650, serial: null });
  await add('SHO', 'Karam FS 21 Safety Shoes', { size_uk: 8 }, { holder: toEmp(anil), cost: 1900, serial: null });
  await add('ACC', 'Access Card — Bijwasan Warehouse', { card_number: 'AC-WH-20781', access_zones: ['Main Entrance', 'Warehouse'] }, { holder: toEmp(anil), serial: null, cost: 350 });
  await allocation.assign(admin, gloves, { holderType: 'EMPLOYEE', holderId: anil, quantity: 4 });
  await employeesSvc.grantAccess(admin, anil, { password: DEMO_PASSWORD });

  // ── Lifecycle variety: maintenance, vendor repair, retired, lost ────────
  const repairLaptop = await laptop(toEmp(staff[8]), 3);
  await maintenance.create(admin, { assetId: repairLaptop, type: 'REPAIR', title: 'Keyboard not responding', description: 'Several keys unresponsive after liquid spill', vendorId: vendors.service, cost: 6500, startNow: true, scheduledDate: null });
  const printer = await add('PRN', 'Brother HL-L2351DW', { printer_type: 'Laser', colour: false }, { cost: 14000 });
  await maintenance.create(admin, { assetId: printer, type: 'SERVICE', title: 'Drum replacement', vendorId: vendors.service, startNow: true, cost: 3200, description: null, scheduledDate: null });
  const genSvc = await add('UPS', 'APC Back-UPS 1100VA', { capacity_va: 1100 }, { holder: { holderType: 'LOCATION', holderId: mumbai3 }, cost: 9000 });
  await maintenance.create(admin, { assetId: genSvc, type: 'PREVENTIVE', title: 'Quarterly battery check', startNow: false, scheduledDate: daysFromNow(9), vendorId: null, cost: null, description: null });
  const atVendor = await laptop(null, 1);
  await allocation.assign(admin, atVendor, { holderType: 'VENDOR', holderId: vendors.service, quantity: 1, notes: 'Motherboard replacement under warranty', expectedReturnDate: daysFromNow(7) });
  const oldLaptop = await laptop(null, 1);
  await lifecycle.perform(admin, oldLaptop, { action: 'retire', notes: 'End of life (5 years)', locationId: null });
  const oldLaptop2 = await laptop(null, 3);
  await lifecycle.perform(admin, oldLaptop2, { action: 'retire', notes: 'Battery swelling', locationId: null });
  await lifecycle.perform(admin, oldLaptop2, { action: 'dispose', notes: 'E-waste recycler certificate #EW-2291', locationId: null });
  const lostPhone = await add('MOB', 'OnePlus 12R', { imei: `86${int(1000000000000, 9999999999999)}`, storage_gb: '256', operating_system: 'Android' }, { holder: toEmp(staff[11]), cost: 42000 });
  await lifecycle.perform(admin, lostPhone, { action: 'mark_lost', notes: 'Reported lost while travelling (FIR #1182)', locationId: null });

  // Transfers & returns for realistic history.
  const moved = await laptop(toEmp(staff[2]), 1);
  await allocation.transfer(admin, moved, { holderType: 'EMPLOYEE', holderId: staff[3], quantity: 1, notes: 'Role change — handed over', allocationId: null });
  const returned = await laptop(toEmp(staff[4]), 1);
  await allocation.returnAsset(admin, returned, { condition: 'FAIR', makeAvailable: false, notes: 'Returned after project end', allocationId: null });

  // ── Karan's notice period (exit case in progress) ───────────────────────
  const hrActor: Actor = { ...admin, name: 'Neha Kapoor', roleName: 'HR' };
  const karanCase = await employeesSvc.changeStatus(hrActor, karan, { status: 'NOTICE_PERIOD', lastWorkingDate: daysFromNow(9), noticeDate: daysFromNow(-21), reason: 'Resigned — relocating' });
  const detail = await exits.get(admin, karanCase.exitCaseId!);
  const firstTwo = detail.items.slice(0, 2);
  for (const item of firstTwo) await exits.updateItem({ ...admin, name: 'Vikram Singh' }, detail.id, item.id, { status: 'RETURNED' });

  // ── Requests & tickets ──────────────────────────────────────────────────
  const rahulActor: Actor = { ...admin, name: 'Rahul Sharma', employeeId: rahul, roleName: 'Employee', permissions: new Set(['request:create', 'ticket:create']) };
  await requests.create(rahulActor, { assetTypeId: types.MON.id, quantity: 1, priority: 'MEDIUM', reason: 'Second screen for CRM dashboards', neededBy: daysFromNow(14), employeeId: null });
  const r2 = await requests.create(admin, { employeeId: staff[6], assetTypeId: types.HDS.id, quantity: 1, priority: 'HIGH', reason: 'Customer calls all day', neededBy: daysFromNow(3) });
  await requests.decide({ ...admin, name: 'Sanjay Rao' }, r2.id, 'APPROVE', 'Approved');
  const r3 = await requests.create(admin, { employeeId: staff[7], assetTypeId: types.MSE.id, quantity: 1, priority: 'LOW', reason: 'Trackpad strain', neededBy: null });
  await requests.decide(admin, r3.id, 'REJECT', 'Use the spare pool at the IT desk');

  await tickets.create(rahulActor, { title: 'Laptop battery drains quickly', description: 'Lasts about 2 hours on a full charge.', assetId: null, type: 'ISSUE', priority: 'MEDIUM' });
  await tickets.create(admin, { title: 'Printer paper jam on Floor 3', description: null, assetId: printer, type: 'REPAIR', priority: 'LOW' });
  await tickets.create(admin, { title: 'Lost phone — block SIM and wipe device', description: 'Staff member reported the phone lost.', assetId: lostPhone, type: 'LOSS', priority: 'URGENT' });

  const [{ assetCount }] = await dbs.root.select({ assetCount: sql<number>`count(*)::int` }).from(sql`assets`);
  console.log(`✔ Seeded demo data: ${assetCount} assets, ${staff.length + 6} employees, ${Object.keys(types).length} asset types.`);
  console.log(`  Sign in with admin@cartrend.test / ${DEMO_PASSWORD} (also it@, hr@, manager@, ceo@, rahul@cartrend.test, or employee ID CT000099)`);
  await app.close();
}

main().catch((err) => {
  console.error('✖ Seed failed', err);
  process.exit(1);
});
