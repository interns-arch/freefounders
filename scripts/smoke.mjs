// `npm run smoke`: end-to-end check of single login against the running suite (`npm run dev` first).
// Talks to http://localhost:8080 exactly like the browser does: cookies, CSRF header, Bearer tokens.
// Safe to run repeatedly: it creates people with unique names.
import assert from 'node:assert/strict';

const BASE = process.env.FF_URL ?? 'http://localhost:8080';
const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const run = Date.now().toString(36);

/** A tiny browser: keeps cookies per path like a real one would send them. */
class Browser {
  cookies = new Map(); // name -> { value, path }

  cookieHeader(path) {
    return [...this.cookies.entries()]
      .filter(([, c]) => path.startsWith(c.path))
      .map(([k, c]) => `${k}=${c.value}`)
      .join('; ');
  }

  async fetch(method, path, { body, token } = {}) {
    const res = await fetch(BASE + path, {
      method,
      redirect: 'manual',
      headers: {
        'x-requested-with': 'XMLHttpRequest',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(this.cookieHeader(path) ? { cookie: this.cookieHeader(path) } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = raw.split(';').map((s) => s.trim());
      const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
      const cpath = attrs.find((a) => /^path=/i.test(a))?.slice(5) ?? '/';
      const expired = attrs.some((a) => /^expires=/i.test(a) && new Date(a.slice(8)) < new Date()) || attrs.some((a) => /^max-age=0$/i.test(a));
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, { value, path: cpath });
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, body: data };
  }

  async signIn(login, password) {
    const res = await this.fetch('POST', '/api/platform/auth/login', { body: { login, password } });
    assert.equal(res.status, 200, `sign in as ${login}: ${JSON.stringify(res.body)}`);
    return res.body;
  }

  async token() {
    const res = await this.fetch('POST', '/api/platform/auth/refresh', { body: {} });
    return res.status === 200 ? res.body.accessToken : null;
  }
}

const steps = [];
async function step(name, fn) {
  try {
    await fn();
    steps.push(name);
    console.log(`  ✔ ${name}`);
  } catch (err) {
    console.error(`  ✖ ${name}\n    ${err.message.split('\n').join('\n    ')}`);
    process.exit(1);
  }
}

console.log(`\nSmoke test against ${BASE}\n`);
const owner = new Browser();
let ownerId;

await step('every part answers through the gateway', async () => {
  for (const [path, ok] of [
    ['/api/platform/health', 200],
    ['/', 200],
    ['/tasks/', 200],
    ['/assets/', 200],
    ['/assets/api/health', 200],
    ['/tasks/api/auth/me', 401],
  ]) {
    assert.equal((await owner.fetch('GET', path)).status, ok, path);
  }
});

await step('owner signs in once at the portal', async () => {
  await owner.signIn(OWNER.login, OWNER.password);
  assert.ok(owner.cookies.has('ff_refresh'), 'refresh cookie set');
  const me = await owner.fetch('GET', '/api/platform/auth/me', { token: await owner.token() });
  ownerId = me.body.person.id;
  assert.equal(me.body.person.role, 'owner');
});

await step('owner gives themselves Tasks and Assets (provisioned in both apps)', async () => {
  const t = await owner.token();
  const tasks = await owner.fetch('PUT', `/api/platform/people/${ownerId}/apps/tasks`, { token: t, body: { appRole: 'super_admin' } });
  assert.equal(tasks.status, 200, JSON.stringify(tasks.body));
  const assets = await owner.fetch('PUT', `/api/platform/people/${ownerId}/apps/assets`, { token: t, body: { appRole: 'Admin' } });
  assert.equal(assets.status, 200, JSON.stringify(assets.body));
  const me = await owner.fetch('GET', '/api/platform/auth/me', { token: await owner.token() });
  assert.deepEqual(me.body.apps.map((a) => a.app).sort(), ['assets', 'tasks']);
});

await step('the same login opens Tasks', async () => {
  const me = await owner.fetch('GET', '/tasks/api/auth/me', { token: await owner.token() });
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.role, 'super_admin');
  assert.ok(me.body.capabilities.length > 0);
  assert.equal((await owner.fetch('GET', '/tasks/api/tasks/', { token: await owner.token() })).status, 200);
});

await step('…and Assets (token exchanged for a short session cookie)', async () => {
  const ex = await owner.fetch('POST', '/assets/api/auth/platform-session', { token: await owner.token() });
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  assert.ok(owner.cookies.has('eam_session'));
  const me = await owner.fetch('GET', '/assets/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.role.name, 'Admin');
  assert.equal((await owner.fetch('GET', '/assets/api/assets')).status, 200);
});

const member = new Browser();
let memberId;
let memberPassword;
await step('owner adds a member with a login and gives them Tasks only', async () => {
  const t = await owner.token();
  const created = await owner.fetch('POST', '/api/platform/people', {
    token: t,
    body: { fullName: `Smoke Member ${run}`, email: `smoke-${run}@freefounders.test`, login: { username: `smoke-${run}` } },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  memberId = created.body.person.id;
  memberPassword = created.body.generatedPassword;
  const roles = await owner.fetch('GET', '/api/platform/apps/tasks/roles', { token: t });
  assert.ok(roles.body.some((r) => r.value === 'warehouse'), 'Tasks roles listed');
  const grant = await owner.fetch('PUT', `/api/platform/people/${memberId}/apps/tasks`, { token: t, body: { appRole: 'warehouse' } });
  assert.equal(grant.status, 200, JSON.stringify(grant.body));
});

await step('member must change the generated password, then reaches Tasks but not Assets', async () => {
  const first = await member.signIn(`smoke-${run}`, memberPassword);
  assert.equal(first.mustChangePassword, true);
  const changed = await member.fetch('POST', '/api/platform/auth/change-password', {
    token: await member.token(),
    body: { currentPassword: memberPassword, newPassword: `Smoke-${run}-pw` },
  });
  assert.equal(changed.status, 200);
  const tasksMe = await member.fetch('GET', '/tasks/api/auth/me', { token: await member.token() });
  assert.equal(tasksMe.status, 200);
  assert.equal(tasksMe.body.role, 'warehouse');
  assert.equal((await member.fetch('POST', '/assets/api/auth/platform-session', { token: await member.token() })).status, 401);
  assert.equal((await member.fetch('GET', '/api/platform/people', { token: await member.token() })).status, 403, 'members cannot manage people');
});

await step('deactivating the member signs them out of everything', async () => {
  const before = await member.token();
  assert.ok(before);
  const off = await owner.fetch('PATCH', `/api/platform/people/${memberId}`, { token: await owner.token(), body: { status: 'inactive' } });
  assert.equal(off.status, 200);
  assert.equal(await member.token(), null, 'no new tokens');
  assert.equal((await member.fetch('POST', '/api/platform/auth/login', { body: { login: `smoke-${run}`, password: `Smoke-${run}-pw` } })).status, 401);
});

await step('owner signs out: no new tokens for either app', async () => {
  await owner.fetch('POST', '/api/platform/auth/logout', { body: {} });
  assert.equal(owner.cookies.has('ff_refresh'), false, 'refresh cookie cleared');
  assert.equal(await owner.token(), null);
});

console.log(`\n✔ ${steps.length} checks passed\n`);
