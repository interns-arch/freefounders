#!/usr/bin/env node
/**
 * A tidy showcase company for the landing-page screenshots (PLAN.md §24.2), in the LOCAL dev suite only:
 * "Sharma Auto Components Pvt Ltd" (code SHOWCASE, owner anita.sharma / Demo@1234) with made-up people, tasks with a
 * task chain, assets and today's visitors, all entered through the apps' own APIs. The demo company of `npm run dev`
 * is full of e2e test rows, so the pictures are taken here instead. Safe to run again (it adds only what is missing).
 *
 *   npm run dev
 *   node scripts/landing-showcase.mjs
 *   node scripts/landing-screenshots.mjs
 *
 * Every name, number and email here is invented (.test addresses); nothing comes from a real company.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = process.env.FF_URL ?? 'http://localhost:8080';
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(BASE)) {
  console.error(`Refusing ${BASE}: the showcase company is made in the local dev suite only.`);
  process.exit(1);
}
const CODE = 'SHOWCASE';
const OWNER = { login: 'anita.sharma', password: 'Demo@1234', name: 'Anita Sharma', email: 'anita@sharmaauto.test' };
const COMPANY = 'Sharma Auto Components Pvt Ltd';

const jar = new Map();
let token = null;
async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      'x-requested-with': 'XMLHttpRequest',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token && (!url.startsWith('/assets/') || url.endsWith('/platform-session')) ? { authorization: `Bearer ${token}` } : {}),
      ...(url.startsWith('/assets/') && jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const pair = raw.split(';')[0];
    jar.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
  }
  const text = await res.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* text */
  }
  if (res.status >= 400) throw new Error(`${method} ${url} → ${res.status} ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 400)}`);
  return data;
}
const list = (d) => (Array.isArray(d) ? d : (d?.results ?? d?.items ?? d?.data ?? []));
const day = (n, h = 18) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

// 1. The company (once), through the platform CLI like the smoke test.
const platformDir = path.join(ROOT, 'services/platform');
const companies = execFileSync(process.execPath, ['dist/companies.js', 'list'], { cwd: platformDir, encoding: 'utf8' });
if (!companies.split('\n').some((l) => l.startsWith(CODE))) {
  execFileSync(
    process.execPath,
    ['dist/companies.js', 'create', '--name', COMPANY, '--code', CODE, '--owner-name', OWNER.name, '--owner-login', OWNER.login, '--owner-email', OWNER.email, '--owner-password', OWNER.password, '--apps', 'tasks,assets'],
    { cwd: platformDir, env: { ...process.env, TASKS_INTERNAL_URL: 'http://127.0.0.1:8000/api/internal', ASSETS_INTERNAL_URL: 'http://127.0.0.1:3000/api/internal' }, stdio: 'inherit' },
  );
}
token = (await api('POST', '/api/platform/auth/login', { login: OWNER.login, password: OWNER.password })).accessToken;
console.log('✔ signed in as the showcase owner');

// 2. People.
const PEOPLE = [
  { fullName: 'Rohit Verma', dept: 'Sales', designation: 'Sales Manager', mobile: '9800000101' },
  { fullName: 'Priya Nair', dept: 'Human Resources', designation: 'HR Executive', mobile: '9800000102' },
  { fullName: 'Arjun Mehta', dept: 'Operations', designation: 'Workshop Supervisor', mobile: '9800000103' },
  { fullName: 'Sneha Kulkarni', dept: 'Accounts', designation: 'Accountant', mobile: '9800000104' },
  { fullName: 'Imran Shaikh', dept: 'Warehouse', designation: 'Store Keeper', mobile: '9800000105' },
  { fullName: 'Kavita Joshi', dept: 'Purchase', designation: 'Purchase Executive', mobile: '9800000106' },
  { fullName: 'Vikram Singh', dept: 'Operations', designation: 'Security Guard', mobile: '9800000107' },
  { fullName: 'Neha Gupta', dept: 'Sales', designation: 'Sales Executive', mobile: '9800000108' },
];
const depts = await api('GET', '/api/platform/departments');
const roles = await api('GET', '/api/platform/roles');
const member = roles.find((r) => r.code === 'ff_member' || r.name === 'Member');
const existing = list(await api('GET', '/api/platform/people?pageSize=200'));
const byName = new Map(existing.map((p) => [p.fullName, p]));
for (const p of PEOPLE) {
  if (byName.has(p.fullName)) continue;
  const slug = p.fullName.toLowerCase().replace(/\s+/g, '.');
  const made = await api('POST', '/api/platform/people', {
    fullName: p.fullName,
    email: `${slug}@sharmaauto.test`,
    employeeCode: '',
    mobile: p.mobile,
    platformRole: 'member',
    departmentId: depts.find((d) => d.name === p.dept)?.id ?? null,
    designation: p.designation,
    reportsTo: null,
    joinDate: '2025-04-01',
    login: { username: slug, password: 'Demo@1234' },
  });
  if (member) await api('PUT', `/api/platform/people/${made.person.id}/roles`, { roleIds: [member.id] });
  byName.set(p.fullName, made.person);
  console.log(`✔ person ${p.fullName}`);
}

// 3. Tasks, with one task chain (a task given in parts, and a part of a part).
const me = await api('GET', '/tasks/api/auth/me');
const users = list(await api('GET', '/tasks/api/users/?page_size=200'));
const uid = (name) => users.find((u) => [u.full_name, u.name, `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()].includes(name))?.id ?? me.id;
const have = list(await api('GET', '/tasks/api/tasks/?page_size=200'));
const titles = new Set(have.map((t) => t.title));
async function task(title, who, due, extra = {}) {
  const found = have.find((t) => t.title === title);
  if (found) return found;
  const t = await api('POST', '/tasks/api/tasks/', { title, assigned_to: uid(who), priority: 'normal', effort_minutes: 60, due_at: due, ...extra });
  titles.add(title);
  console.log(`✔ task ${title}`);
  return t;
}
await task('Send GST invoices for October', 'Sneha Kulkarni', day(1), { priority: 'high', description: 'All dealer invoices, then file GSTR-1.' });
await task('Approve Diwali bonus list', 'Priya Nair', day(2), { priority: 'high' });
await task('Follow up with Patel Motors on the brake-pad order', 'Rohit Verma', day(1, 12));
await task('Monthly stock count: Bay 3', 'Imran Shaikh', day(3), { effort_minutes: 180 });
await task('Get three quotes for the new air compressor', 'Kavita Joshi', day(4), { priority: 'low' });
await task('Service the forklift (500-hour check)', 'Arjun Mehta', day(1, 11), { priority: 'high' });
await task('Dealer meet presentation for Pune', 'Neha Gupta', day(5), { effort_minutes: 240 });
await task('Fire drill and extinguisher check', 'Vikram Singh', day(6), { priority: 'low' });
const parent = await task('Launch the new clutch-plate range', 'Rohit Verma', day(10), { priority: 'high', effort_minutes: 600, description: 'Price list, dealer mailer, stock in all branches.' });
const part = async (title, who, due, minutes, parentId) => {
  if (titles.has(title)) return have.find((t) => t.title === title);
  const t = await api('POST', '/tasks/api/tasks/', { title, assigned_to: uid(who), priority: 'normal', effort_minutes: minutes, due_at: due, parent: parentId });
  titles.add(title);
  console.log(`✔ part ${title}`);
  return t;
};
const pricePart = await part('Clutch plates: final dealer price list', 'Sneha Kulkarni', day(6), 120, parent.id);
await part('Clutch plates: stock in all three branches', 'Imran Shaikh', day(8), 180, parent.id);
await part('Clutch plates: dealer mailer and WhatsApp post', 'Neha Gupta', day(7), 120, parent.id);
if (pricePart) await part('Check competitor prices for clutch plates', 'Kavita Joshi', day(4), 60, pricePart.id);

// 4. Assets.
await api('POST', '/assets/api/auth/platform-session');
const types = list(await api('GET', '/assets/api/asset-types?pageSize=100'));
const employees = list(await api('GET', '/assets/api/employees?pageSize=200'));
const haveAssets = list(await api('GET', '/assets/api/assets?pageSize=200'));
const typeId = (re) => (types.find((t) => re.test(t.name)) ?? types[0])?.id;
const empId = (name) => employees.find((e) => (e.name ?? e.fullName) === name)?.id;
const ASSETS = [
  { name: 'Dell Latitude 5440', type: /laptop/i, serialNumber: 'DL5440-7781', manufacturer: 'Dell', model: 'Latitude 5440', who: 'Rohit Verma', attributes: { processor: 'Intel Core i5-1345U', ram_gb: 16 } },
  { name: 'Lenovo ThinkPad E14', type: /laptop/i, serialNumber: 'TPE14-2290', manufacturer: 'Lenovo', model: 'ThinkPad E14', who: 'Sneha Kulkarni', attributes: { processor: 'AMD Ryzen 5 7530U', ram_gb: 16 } },
  { name: 'Samsung Galaxy A35', type: /phone|mobile/i, serialNumber: 'SMA35-1182', manufacturer: 'Samsung', model: 'Galaxy A35', who: 'Neha Gupta', attributes: { imei: '356789012345671' } },
  { name: 'HP LaserJet Pro M404', type: /printer/i, serialNumber: 'HPM404-5521', manufacturer: 'HP', model: 'M404dn' },
  { name: 'Epson barcode printer', type: /printer/i, serialNumber: 'EPS-TM-3301', manufacturer: 'Epson', model: 'TM-T82X', who: 'Imran Shaikh' },
  { name: 'Apple iPad 10th gen (gate)', type: /tablet|ipad/i, serialNumber: 'IPAD10-8802', manufacturer: 'Apple', model: 'iPad 10', who: 'Vikram Singh' },
  { name: 'Dell 24" monitor', type: /monitor|display/i, serialNumber: 'P2422H-4410', manufacturer: 'Dell', model: 'P2422H', attributes: { screen_size_inch: 24 } },
];
for (const a of ASSETS) {
  if (haveAssets.some((x) => x.name === a.name)) continue;
  const holder = a.who ? empId(a.who) : null;
  try {
    await api('POST', '/assets/api/assets', {
      assetTypeId: typeId(a.type),
      name: a.name,
      serialNumber: a.serialNumber,
      manufacturer: a.manufacturer,
      model: a.model,
      purchaseDate: '2025-06-15',
      currency: 'INR',
      attributes: a.attributes ?? {},
      ...(holder ? { assignTo: { holderType: 'EMPLOYEE', holderId: holder } } : {}),
    });
    console.log(`✔ asset ${a.name}`);
  } catch (e) {
    console.warn(`  asset ${a.name}: ${e.message}`);
  }
}

/** A plain silhouette (no real face) as the visitor photo the gate requires. */
const SILHOUETTE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCABgAGADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD0iiiitiQooooAKKKry39pA22Sdc5IwOcfXHSgRYoqrHqVnI2FuFBxn5sr/OrVABRRRQMKKKKACiiigAooqvfymCxlkXOduBg4xnjP60CMzVNU8zNvbt8nR3H8XsPb/P1yqKKskK0NN1I2rCKUkwk/98f/AFqz6KAOvBDKGUggjII70tUdHlMtgAc5jYrknOe/9cVeqCgooooGFFFFABVXUozJp8yjGQu7n2Of6VaooEcfRWhqWmm1YyxAmEn/AL4/+tWfVkhRRVuwsHvZMnKxKfmb+g96ANXRYylhuOMO5Yfy/pWhSIixoqKMKowB7UtQUFFFFAwooooAKKKq3t/FZKN+Wdhwg/r6CgRZIDKVYAgjBB71Sl0e0lbIVozkk7D1/Osu41a6mJCv5SHsnX8+tU5JJJW3SOznGMsc1STFc3o9FtEbLb3GOjN/hir6IsahUUKo6ADArkkdo2DIxVh0IODVmHVLuE/60uM5w/P69aGmFzpaKpWWpxXjbMGOTGdpPX6GrtSMKKKKBhRRSEhVLMQABkk9qAKep332SHbGR5r9Aew9a50ksxZiSScknvUlzcPdTtK5PJ4Geg9Kiq0rEhRRRTEFFFFABW7pOoGdfImYGRR8pPVh/jWFTo5HhkWSNirKcgik1cZ11FRwSieBJRjDqDgHOPapKgoKq6lIY9PmYYyV28+5x/WrVVdTRn06YKMnAP4AgmhCOZooorQkKKKKACiiigAooooA6DRZC9htOMI5Ufz/AK1oVn6IjLYkkYDOSPccD+laFZvco//Z';

// 5. Today's visitors at the gate (the Visitors module is switched on first).
try {
  await api('PUT', '/api/platform/company/modules', { tasks: { visitors: true } });
  const visits = list(await api('GET', '/tasks/api/visitors/visits/?page_size=50'));
  const VISITORS = [
    { name: 'Suresh Patil', mobile: '9811000201', company: 'Patel Motors', purpose: 'Order discussion', host: 'Rohit Verma', vehicle_no: 'MH12 AB 4521' },
    { name: 'Meera Iyer', mobile: '9811000202', company: 'Bosch Service', purpose: 'Compressor quote', host: 'Kavita Joshi' },
    { name: 'Ravi Kumar', mobile: '9811000203', company: 'Blue Dart', purpose: 'Delivery', host: 'Imran Shaikh', items: '2 cartons' },
    { name: 'Aditi Rao', mobile: '9811000204', company: 'Candidate', purpose: 'Interview: Sales Executive', host: 'Priya Nair' },
  ];
  for (const v of VISITORS) {
    if (visits.some((x) => (x.visitor_name ?? x.visitor?.name ?? x.name) === v.name)) continue;
    const { host, ...rest } = v;
    await api('POST', '/tasks/api/visitors/visits/', { ...rest, host: uid(host), people: 1, photo: SILHOUETTE });
    console.log(`✔ visitor ${v.name}`);
  }
} catch (e) {
  console.warn(`  visitors: ${e.message}`);
}
// 6. Today's punches: most of the team checks in (the silhouette as the punch photo). The owner does not, so the
// owner's screens still show "Punch in".
const ownerToken = token;
for (const p of PEOPLE.slice(0, 6)) {
  try {
    token = (await api('POST', '/api/platform/auth/login', { login: p.fullName.toLowerCase().replace(/\s+/g, '.'), password: 'Demo@1234' })).accessToken;
    await api('POST', '/tasks/api/attendance/check_in/', { latitude: 18.5204, longitude: 73.8567, accuracy: 12, photo: SILHOUETTE });
    console.log(`✔ ${p.fullName} checked in`);
  } catch (e) {
    if (!/already/i.test(e.message)) console.warn(`  punch ${p.fullName}: ${e.message}`);
  }
}
token = ownerToken;

console.log(`\nShowcase ready: sign in as ${OWNER.login} / ${OWNER.password}`);
