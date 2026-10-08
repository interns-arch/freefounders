import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  type AppCatalogue,
  type AppKey,
  APP_NAMES,
  call,
  errorText,
  type Grant,
  LEVEL_LABELS,
  type Me,
  type Role,
  type Scope,
  SCOPE_LABELS,
} from '../api';
import { Modal, PageNav, TopBar } from '../ui';

/** Which apps a role reaches (it has at least one permission there). */
export function roleApps(role: Pick<Role, 'grants'>): AppKey[] {
  return [...new Set(role.grants.map((g) => g.app))];
}

export function RolesPage({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [catalogue, setCatalogue] = useState<AppCatalogue[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Role | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setRoles(await call<Role[]>('GET', '/roles'));
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => {
    void load();
    call<AppCatalogue[]>('GET', '/roles/catalogue').then(setCatalogue, (err) => setError(errorText(err)));
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="page">
      <TopBar me={me} onSignOut={onSignOut}>
        <PageNav current="roles" />
      </TopBar>
      <main className="container">
        <div className="page-head">
          <div>
            <h1>Roles</h1>
            <p className="muted">What each role can do in every app. A person can have several roles; their permissions add up.</p>
          </div>
          <button className="btn primary" onClick={() => setEditing('new')} disabled={!catalogue}>
            + New role
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Level</th>
                <th>Apps</th>
                <th>People</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {roles === null && (
                <tr>
                  <td colSpan={5} className="muted">
                    Loading…
                  </td>
                </tr>
              )}
              {roles?.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>
                      {r.name}
                      {r.system && <span className="pill">Locked</span>}
                    </strong>
                    <small>{r.description || `${r.grants.length} permission${r.grants.length === 1 ? '' : 's'}`}</small>
                  </td>
                  <td>{LEVEL_LABELS[r.level] ?? r.level}</td>
                  <td>
                    {roleApps(r).map((a) => (
                      <span key={a} className={`chip chip-${a}`}>
                        {APP_NAMES[a]}
                      </span>
                    ))}
                    {r.grants.length === 0 && <span className="muted">None</span>}
                  </td>
                  <td>{r.people}</td>
                  <td className="row-actions">
                    <button className="btn small" onClick={() => setEditing(r)} disabled={!catalogue}>
                      {r.system ? 'View' : 'Edit'}
                    </button>
                    <button className="btn small" onClick={() => void act(() => call('POST', `/roles/${r.id}/duplicate`))}>
                      Duplicate
                    </button>
                    {!r.system && (
                      <button
                        className="btn small danger"
                        onClick={() =>
                          void act(async () => {
                            if (!window.confirm(`Archive "${r.name}"? ${r.people ? `${r.people} people lose it (and any app only it gave them).` : ''}`)) return;
                            await call('DELETE', `/roles/${r.id}`);
                          })
                        }
                      >
                        Archive
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
      {editing && catalogue && (
        <RoleEditor
          role={editing === 'new' ? null : editing}
          catalogue={catalogue}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await load();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

const key = (g: Pick<Grant, 'app' | 'permission'>) => `${g.app}:${g.permission}`;

function RoleEditor({ role, catalogue, onClose, onSaved }: { role: Role | null; catalogue: AppCatalogue[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const locked = !!role?.system;
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [level, setLevel] = useState(role?.level ?? 1);
  const [grants, setGrants] = useState<Map<string, Grant>>(() => new Map((role?.grants ?? []).map((g) => [key(g), g])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const groups = useMemo(
    () =>
      catalogue.map((c) => ({
        app: c.app,
        groups: [...new Set(c.permissions.map((p) => p.group))].map((g) => ({ name: g, permissions: c.permissions.filter((p) => p.group === g) })),
      })),
    [catalogue],
  );

  const toggle = (app: AppKey, permission: string, scopes: Scope[] | null) =>
    setGrants((prev) => {
      const next = new Map(prev);
      const k = key({ app, permission });
      if (next.has(k)) next.delete(k);
      // A newly ticked permission starts at the narrowest scope; widen it on purpose.
      else next.set(k, { app, permission, scope: scopes ? scopes[0] : '' });
      return next;
    });
  const setScope = (app: AppKey, permission: string, scope: Scope) =>
    setGrants((prev) => new Map(prev).set(key({ app, permission }), { app, permission, scope }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = { name: name.trim(), description: description.trim() || null, level, grants: [...grants.values()] };
    try {
      await call(role ? 'PATCH' : 'POST', role ? `/roles/${role.id}` : '/roles', body);
      await onSaved();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={role ? (locked ? role.name : `Edit ${role.name}`) : 'New role'} onClose={onClose}>
      <form onSubmit={submit} className="role-editor">
        {locked && <p className="muted">{role?.description} Duplicate it to make an editable copy.</p>}
        <div className="grid2">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={locked} required maxLength={80} />
          </label>
          <label className="field">
            <span>Level</span>
            <select value={level} onChange={(e) => setLevel(Number(e.target.value))} disabled={locked}>
              {[1, 2, 3].map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Description (optional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} disabled={locked} maxLength={300} />
        </label>
        <p className="fine">Admin level: an administrator in every app (work given to them is protected from deletion).</p>

        <div className="matrix">
          {groups.map((app) => (
            <section key={app.app} aria-label={`${APP_NAMES[app.app]} permissions`}>
              <h3 className={`matrix-app chip-${app.app}`}>{APP_NAMES[app.app]}</h3>
              {app.groups.map((g) => (
                <div key={g.name} className="matrix-group">
                  <h4>{g.name}</h4>
                  {g.permissions.map((p) => {
                    const grant = grants.get(key({ app: app.app, permission: p.key }));
                    return (
                      <div key={p.key} className="matrix-row">
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={!!grant}
                            onChange={() => toggle(app.app, p.key, p.scopes)}
                            disabled={locked}
                            aria-label={`${APP_NAMES[app.app]}: ${p.label}`}
                          />
                          <span>{p.label}</span>
                        </label>
                        {p.scopes && grant && (
                          <div className="segmented" role="radiogroup" aria-label={`Scope for ${p.label}`}>
                            {p.scopes.map((s) => (
                              <button
                                type="button"
                                key={s}
                                role="radio"
                                aria-checked={grant.scope === s}
                                className={grant.scope === s ? 'on' : undefined}
                                onClick={() => setScope(app.app, p.key, s)}
                                disabled={locked}
                              >
                                {SCOPE_LABELS[s]}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </section>
          ))}
        </div>
        <p className="fine">Own = only my records · Team = mine and my direct reports · Department = everyone in my department · Company = everyone.</p>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            {locked ? 'Close' : 'Cancel'}
          </button>
          {!locked && (
            <button className="btn primary" disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : 'Save role'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
