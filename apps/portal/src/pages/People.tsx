import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, type AppInfo, APP_NAMES, call, errorText, type Me, type Person, type PlatformRole, type Role, type Department } from '../api';
import { Modal, PageNav, TopBar } from '../ui';
import { roleApps } from './Roles';

const LEVELS: Record<PlatformRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

type Dialog =
  | { kind: 'add' }
  | { kind: 'roles'; person: Person }
  | { kind: 'password'; person: Person; username: string | null; password: string }
  | { kind: 'edit'; person: Person }
  | { kind: 'exit'; person: Person };

export function PeoplePage({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
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
    call<Role[]>('GET', '/roles').then(setRoles, (err) => setError(errorText(err)));
  }, []);
  const roleById = new Map(roles.map((r) => [r.id, r]));

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorText(err));
    }
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
        <PageNav current="people" />
      </TopBar>
      <main className="container">
        <div className="page-head">
          <div>
            <h1>People &amp; access</h1>
            <p className="muted">Everyone at {me.company.name}: their login and their roles. Roles decide which apps they can open.</p>
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
                <th>Roles</th>
                <th>Apps</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {people === null && (
                <tr>
                  <td colSpan={6} className="muted">
                    Loading…
                  </td>
                </tr>
              )}
              {people?.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
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
                    {p.status === 'active' && p.lastWorkingDate && <span className="pill warn">Leaving {p.lastWorkingDate}</span>}
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
                  <td className="role-cell" aria-label={`Roles of ${p.fullName}`}>
                    {p.roleIds.map((id) => roleById.get(id)).filter(Boolean).map((r) => (
                      <span key={r!.id} className={`chip${r!.system ? ' chip-system' : ''}`}>
                        {r!.name}
                      </span>
                    ))}
                    {p.roleIds.length === 0 && <span className="muted">No role</span>}
                    <div>
                      <button className="btn small" onClick={() => setDialog({ kind: 'roles', person: p })} disabled={p.status === 'inactive'}>
                        Change roles
                      </button>
                    </div>
                  </td>
                  <td aria-label={`Apps of ${p.fullName}`}>
                    {p.apps.map((a) => (
                      <span key={a} className={`chip chip-${a}`}>
                        {APP_NAMES[a]}
                      </span>
                    ))}
                    {p.apps.length === 0 && <span className="muted">—</span>}
                  </td>
                  <td className="row-actions">
                    <button className="btn small" onClick={() => setDialog({ kind: 'edit', person: p })}>
                      Edit
                    </button>
                    <button className="btn small" onClick={() => void resetPassword(p)}>
                      {p.login ? 'Reset password' : 'Create login'}
                    </button>
                    {p.id !== me.person.id && p.status === 'active' && (
                      <button className="btn small" onClick={() => setDialog({ kind: 'exit', person: p })}>
                        {p.lastWorkingDate ? 'Exit started' : 'Start exit'}
                      </button>
                    )}
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
      {dialog?.kind === 'exit' && <ExitForm person={dialog.person} onClose={() => setDialog(null)} onDone={load} />}
      {dialog?.kind === 'edit' && <PersonForm me={me} person={dialog.person} onClose={() => setDialog(null)} onSaved={async () => (await load(), setDialog(null))} />}
      {dialog?.kind === 'roles' && (
        <RolesDialog me={me} person={dialog.person} roles={roles} apps={apps} onClose={() => setDialog(null)} onDone={async () => (await load(), setDialog(null))} />
      )}
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
    departmentId: person?.departmentId ?? '',
    designation: person?.designation ?? '',
    reportsTo: person?.reportsTo ?? '',
    joinDate: person?.joinDate ?? '',
    withLogin: true,
    username: '',
    password: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  // People directory (PLAN.md §17.1): the company's departments, and who this person can report to.
  const [depts, setDepts] = useState<Department[]>([]);
  const [everyone, setEveryone] = useState<Person[]>([]);
  useEffect(() => {
    call<Department[]>('GET', '/departments').then(setDepts, () => setDepts([]));
    call<Person[]>('GET', '/people').then(setEveryone, () => setEveryone([]));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    const fields = {
      fullName: f.fullName,
      email: f.email,
      employeeCode: f.employeeCode,
      mobile: f.mobile,
      platformRole: f.platformRole,
      departmentId: f.departmentId || null,
      designation: f.designation || null,
      reportsTo: f.reportsTo || null,
      joinDate: f.joinDate || null,
    };
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
          <label className="field">
            <span>Department</span>
            <select value={f.departmentId} onChange={set('departmentId')}>
              <option value="">—</option>
              {depts
                .filter((d) => d.active || d.id === f.departmentId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
            {fieldError('departmentId')}
          </label>
          <label className="field">
            <span>Designation</span>
            <input value={f.designation} onChange={set('designation')} maxLength={80} placeholder="e.g. Sales Executive" />
            {fieldError('designation')}
          </label>
          <label className="field">
            <span>Reports to</span>
            <select value={f.reportsTo} onChange={set('reportsTo')}>
              <option value="">— nobody (approvals go to admins) —</option>
              {everyone
                .filter((p) => p.id !== person?.id && (p.status === 'active' || p.id === f.reportsTo))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
            </select>
            {fieldError('reportsTo')}
          </label>
          <label className="field">
            <span>Joining date</span>
            <input type="date" value={f.joinDate} onChange={set('joinDate')} />
            {fieldError('joinDate')}
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

function RolesDialog({
  me,
  person,
  roles,
  apps,
  onClose,
  onDone,
}: {
  me: Me;
  person: Person;
  roles: Role[];
  apps: AppInfo[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(person.roleIds));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inPlan = new Set(apps.map((a) => a.app));
  const reach = [...new Set(roles.filter((r) => chosen.has(r.id)).flatMap((r) => roleApps(r)))].filter((a) => inPlan.has(a));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await call('PUT', `/people/${person.id}/roles`, { roleIds: [...chosen] });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`Roles of ${person.fullName}`} onClose={onClose}>
      <p className="muted">Pick one or more roles. Their permissions add up; the widest scope wins.</p>
      <div className="role-pick">
        {roles.map((r) => {
          // Only an owner gives or takes Super Admin.
          const lockedForMe = r.code === 'ff_super_admin' && me.person.role !== 'owner';
          return (
            <label key={r.id} className="check">
              <input
                type="checkbox"
                checked={chosen.has(r.id)}
                disabled={lockedForMe}
                onChange={() =>
                  setChosen((prev) => {
                    const next = new Set(prev);
                    if (next.has(r.id)) next.delete(r.id);
                    else next.add(r.id);
                    return next;
                  })
                }
              />
              <span>
                {r.name}
                {r.system && <span className="pill">Locked</span>}
              </span>
              <span>
                {roleApps(r).map((a) => (
                  <span key={a} className={`chip chip-${a}`}>
                    {APP_NAMES[a]}
                  </span>
                ))}
              </span>
            </label>
          );
        })}
      </div>
      <p className="fine">
        {reach.length
          ? `${person.fullName.split(' ')[0]} will be able to open: ${reach.map((a) => APP_NAMES[a]).join(', ')}.`
          : `${person.fullName.split(' ')[0]} will not be able to open any app.`}{' '}
        Losing an app signs them out.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save roles'}
        </button>
      </div>
    </Modal>
  );
}

interface ExitResult {
  lastWorkingDate: string;
  assets?: { caseNumber?: string | null; url?: string | null; error?: string };
  tasks?: { code?: string; error?: string };
}

/** Start someone's exit (PLAN.md §17.4): Assets lists the assets to recover, Tasks makes the exit checklist. */
function ExitForm({ person, onClose, onDone }: { person: Person; onClose: () => void; onDone: () => Promise<void> | void }) {
  const [lastWorkingDate, setDate] = useState(person.lastWorkingDate ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ExitResult | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setResult(await call<ExitResult>('POST', `/people/${person.id}/exit`, { lastWorkingDate, reason: reason || null }));
      await onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Exit: ${person.fullName}`} onClose={onClose}>
      {result ? (
        <div className="form">
          <p>
            <strong>Exit started.</strong> Last working day {result.lastWorkingDate}. They stay active until the exit is complete.
          </p>
          <ul className="result-list">
            {result.assets && (
              <li>
                Assets:{' '}
                {result.assets.error ? (
                  <span className="error-text">{result.assets.error}</span>
                ) : (
                  <>
                    exit case {result.assets.caseNumber}
                    {result.assets.url && (
                      <>
                        {' '}
                        — <a href={result.assets.url}>open it</a>
                      </>
                    )}
                    . Completing it (all assets back) switches them off everywhere.
                  </>
                )}
              </li>
            )}
            {result.tasks && (
              <li>
                Tasks: {result.tasks.error ? <span className="error-text">{result.tasks.error}</span> : <>exit checklist {result.tasks.code} for their manager.</>}
              </li>
            )}
            {!result.assets && !result.tasks && <li>They have neither Tasks nor Assets: deactivate them on their last day.</li>}
          </ul>
          <div className="actions">
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>Last working day *</span>
            <input type="date" value={lastWorkingDate} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="field">
            <span>Reason (optional)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </label>
          <p className="fine">Assets opens an exit case listing what they hold; Tasks gives their manager the exit checklist.</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy || !lastWorkingDate}>
              {busy ? 'Starting…' : 'Start exit'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
