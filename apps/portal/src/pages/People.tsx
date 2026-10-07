import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, type AppInfo, type AppKey, type AppRole, call, errorText, type Me, type Person, type PlatformRole } from '../api';
import { Modal, TopBar } from '../ui';

const LEVELS: Record<PlatformRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

type Dialog =
  | { kind: 'add' }
  | { kind: 'grant'; person: Person; app: AppInfo }
  | { kind: 'password'; person: Person; username: string | null; password: string }
  | { kind: 'edit'; person: Person };

export function PeoplePage({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const load = useCallback(async () => {
    try {
      setPeople(await call<Person[]>('GET', `/people?search=${encodeURIComponent(search)}`));
    } catch (err) {
      setError(errorText(err));
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);
  useEffect(() => {
    call<AppInfo[]>('GET', '/apps').then(setApps, (err) => setError(errorText(err)));
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const toggleApp = (p: Person, app: AppInfo) => {
    if (!p.apps.includes(app.app)) return setDialog({ kind: 'grant', person: p, app });
    if (!window.confirm(`Remove ${app.name} from ${p.fullName}? They will be signed out.`)) return;
    void act(() => call('DELETE', `/people/${p.id}/apps/${app.app}`));
  };

  const resetPassword = (p: Person) =>
    act(async () => {
      if (!window.confirm(`Set a new password for ${p.fullName}? They will be signed out everywhere.`)) return;
      const res = await call<{ username: string | null; generatedPassword?: string }>('PUT', `/people/${p.id}/login`, {});
      setDialog({ kind: 'password', person: p, username: res.username, password: res.generatedPassword ?? '' });
    });

  const setStatus = (p: Person, status: 'active' | 'inactive') =>
    act(async () => {
      if (status === 'inactive' && !window.confirm(`Deactivate ${p.fullName}? They will be signed out of every app.`)) return;
      await call('PATCH', `/people/${p.id}`, { status });
    });

  return (
    <div className="page">
      <TopBar me={me} onSignOut={onSignOut}>
        <a className="btn ghost" href="/?choose">
          ← Workspaces
        </a>
      </TopBar>
      <main className="container">
        <div className="page-head">
          <div>
            <h1>People &amp; access</h1>
            <p className="muted">Everyone at {me.company.name}: their login and which apps they can open.</p>
          </div>
          <button className="btn primary" onClick={() => setDialog({ kind: 'add' })}>
            + Add person
          </button>
        </div>

        <input className="search" type="search" placeholder="Search name, email, employee ID or username" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search people" />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Level</th>
                <th>Sign-in</th>
                {apps.map((a) => (
                  <th key={a.app}>{a.name}</th>
                ))}
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {people === null && (
                <tr>
                  <td colSpan={4 + apps.length} className="muted">
                    Loading…
                  </td>
                </tr>
              )}
              {people?.length === 0 && (
                <tr>
                  <td colSpan={4 + apps.length} className="muted">
                    No one found.
                  </td>
                </tr>
              )}
              {people?.map((p) => (
                <tr key={p.id} className={p.status === 'inactive' ? 'inactive' : undefined}>
                  <td>
                    <strong>{p.fullName}</strong>
                    <small>{[p.email, p.employeeCode].filter(Boolean).join(' · ') || '—'}</small>
                  </td>
                  <td>
                    {LEVELS[p.platformRole]}
                    {p.status === 'inactive' && <span className="pill warn">Inactive</span>}
                  </td>
                  <td>
                    {p.login ? (
                      <>
                        {p.login.username ?? <span className="muted">email / ID</span>}
                        {p.login.locked && <span className="pill warn">Locked</span>}
                      </>
                    ) : (
                      <span className="muted">No login</span>
                    )}
                  </td>
                  {apps.map((a) => (
                    <td key={a.app}>
                      <label className="switch" title={p.apps.includes(a.app) ? `Remove ${a.name}` : `Give ${a.name}`}>
                        <input type="checkbox" checked={p.apps.includes(a.app)} onChange={() => toggleApp(p, a)} disabled={p.status === 'inactive'} aria-label={`${a.name} access for ${p.fullName}`} />
                        <span />
                      </label>
                    </td>
                  ))}
                  <td className="row-actions">
                    <button className="btn small" onClick={() => setDialog({ kind: 'edit', person: p })}>
                      Edit
                    </button>
                    <button className="btn small" onClick={() => void resetPassword(p)}>
                      {p.login ? 'Reset password' : 'Create login'}
                    </button>
                    {p.id !== me.person.id &&
                      (p.status === 'active' ? (
                        <button className="btn small danger" onClick={() => void setStatus(p, 'inactive')}>
                          Deactivate
                        </button>
                      ) : (
                        <button className="btn small" onClick={() => void setStatus(p, 'active')}>
                          Activate
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {dialog?.kind === 'add' && (
        <PersonForm
          me={me}
          onClose={() => setDialog(null)}
          onSaved={async (res) => {
            await load();
            setDialog(res.generatedPassword ? { kind: 'password', person: res.person, username: res.username, password: res.generatedPassword } : null);
          }}
        />
      )}
      {dialog?.kind === 'edit' && <PersonForm me={me} person={dialog.person} onClose={() => setDialog(null)} onSaved={async () => (await load(), setDialog(null))} />}
      {dialog?.kind === 'grant' && <GrantDialog person={dialog.person} app={dialog.app} onClose={() => setDialog(null)} onDone={async () => (await load(), setDialog(null))} />}
      {dialog?.kind === 'password' && (
        <Modal title="Login ready" onClose={() => setDialog(null)}>
          <p>
            Give these to <strong>{dialog.person.fullName}</strong>. They will choose their own password the first time they sign in.
          </p>
          <dl className="secret">
            <dt>Sign in with</dt>
            <dd>{dialog.username ?? dialog.person.email ?? dialog.person.employeeCode}</dd>
            <dt>Password</dt>
            <dd>
              <code>{dialog.password || '(the one you entered)'}</code>
            </dd>
          </dl>
          <p className="fine">This password is shown only once and is never stored where anyone can read it.</p>
          <div className="actions">
            <button className="btn primary" onClick={() => setDialog(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

interface SavedPerson {
  person: Person;
  username: string | null;
  generatedPassword?: string;
}

function PersonForm({ me, person, onClose, onSaved }: { me: Me; person?: Person; onClose: () => void; onSaved: (res: SavedPerson) => Promise<void> }) {
  const [f, setF] = useState({
    fullName: person?.fullName ?? '',
    email: person?.email ?? '',
    employeeCode: person?.employeeCode ?? '',
    mobile: person?.mobile ?? '',
    platformRole: person?.platformRole ?? ('member' as PlatformRole),
    withLogin: true,
    username: '',
    password: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    const fields = { fullName: f.fullName, email: f.email, employeeCode: f.employeeCode, mobile: f.mobile, platformRole: f.platformRole };
    try {
      if (person) {
        const saved = await call<Person>('PATCH', `/people/${person.id}`, fields);
        await onSaved({ person: saved, username: null });
      } else {
        const res = await call<{ person: Person; generatedPassword?: string }>('POST', '/people', {
          ...fields,
          ...(f.withLogin ? { login: { username: f.username || undefined, password: f.password || undefined } } : {}),
        });
        await onSaved({ person: res.person, username: f.username || null, generatedPassword: res.generatedPassword });
      }
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      setError(errorText(err));
      setBusy(false);
    }
  };

  const levels: PlatformRole[] = me.person.role === 'owner' ? ['member', 'admin', 'owner'] : ['member', 'admin'];
  const fieldError = (k: string) => errors[k] && <em className="field-error">{errors[k]}</em>;

  return (
    <Modal title={person ? `Edit ${person.fullName}` : 'Add person'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Full name *</span>
          <input value={f.fullName} onChange={set('fullName')} required autoFocus />
          {fieldError('fullName')}
        </label>
        <div className="grid2">
          <label className="field">
            <span>Email</span>
            <input type="email" value={f.email} onChange={set('email')} />
            {fieldError('email')}
          </label>
          <label className="field">
            <span>Employee ID</span>
            <input value={f.employeeCode} onChange={set('employeeCode')} />
            {fieldError('employeeCode')}
          </label>
          <label className="field">
            <span>Mobile</span>
            <input value={f.mobile} onChange={set('mobile')} inputMode="tel" />
            {fieldError('mobile')}
          </label>
          <label className="field">
            <span>Access level</span>
            <select value={f.platformRole} onChange={set('platformRole')} disabled={person?.id === me.person.id || (person?.platformRole === 'owner' && me.person.role !== 'owner')}>
              {(person?.platformRole === 'owner' && !levels.includes('owner') ? [...levels, 'owner' as const] : levels).map((l) => (
                <option key={l} value={l}>
                  {LEVELS[l]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!person && (
          <fieldset className="fieldset">
            <label className="check">
              <input type="checkbox" checked={f.withLogin} onChange={(e) => setF((p) => ({ ...p, withLogin: e.target.checked }))} />
              Create a login now
            </label>
            {f.withLogin && (
              <div className="grid2">
                <label className="field">
                  <span>Username (optional)</span>
                  <input value={f.username} onChange={set('username')} autoComplete="off" />
                  {fieldError('login.username')}
                </label>
                <label className="field">
                  <span>Password (blank = generate one)</span>
                  <input type="text" value={f.password} onChange={set('password')} autoComplete="off" />
                  {fieldError('login.password')}
                </label>
              </div>
            )}
            <p className="fine">They can sign in with their email, employee ID or username.</p>
          </fieldset>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !f.fullName.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function GrantDialog({ person, app, onClose, onDone }: { person: Person; app: AppInfo; onClose: () => void; onDone: () => Promise<void> }) {
  const [roles, setRoles] = useState<AppRole[] | null>(null);
  const [role, setRole] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call<AppRole[]>('GET', `/apps/${app.app}/roles`).then(setRoles, (err) => {
      setRoles([]);
      setError(errorText(err));
    });
  }, [app.app]);

  const grant = async () => {
    setBusy(true);
    setError('');
    try {
      await call('PUT', `/people/${person.id}/apps/${app.app as AppKey}`, role ? { appRole: role } : {});
      await onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`Give ${person.fullName} access to ${app.name}`} onClose={onClose}>
      <p className="muted">
        If {person.fullName.split(' ')[0]} already has a {app.name} login (same email, employee ID or username) it is linked; otherwise one is created. The role
        applies only to a new login.
      </p>
      <label className="field">
        <span>Role in {app.name}</span>
        <select value={role} onChange={(e) => setRole(e.target.value)} disabled={!roles}>
          <option value="">{roles ? 'Default role' : 'Loading roles…'}</option>
          {roles?.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void grant()} disabled={busy}>
          {busy ? 'Giving access…' : `Give ${app.name} access`}
        </button>
      </div>
    </Modal>
  );
}
