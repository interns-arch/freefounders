import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from 'react';
import { APP_NAMES, type AppKey, call, type CompanySettings, errorText, type Me } from '../api';
import { PageNav, TopBar } from '../ui';

/** Settings each app keeps itself; the Settings Center links to them (PLAN.md §16.1). */
const APP_SETTINGS: Record<AppKey, Array<{ label: string; href: string; blurb: string }>> = {
  tasks: [
    { label: 'Task rules', href: '/tasks/settings', blurb: 'Completion evidence, departments, task categories, notifications' },
    { label: 'HR settings', href: '/tasks/hr?tab=settings', blurb: 'Working hours, week-offs, punch-in locations and photo, face check, leave types' },
  ],
  assets: [
    { label: 'Asset catalogue', href: '/assets/settings/catalog', blurb: 'Categories, asset types and custom fields' },
    { label: 'Departments & vendors', href: '/assets/settings/departments', blurb: 'Lists used by assets and people' },
  ],
};

export function SettingsPage({ me, onSignOut, onBrandChange }: { me: Me; onSignOut: () => void; onBrandChange: () => void }) {
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setCompany(await call<CompanySettings>('GET', '/company'));
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  return (
    <div className="page">
      <TopBar me={me} onSignOut={onSignOut}>
        <PageNav current="settings" />
      </TopBar>
      <main className="container">
        <div className="page-head">
          <div>
            <h1>Settings</h1>
            <p className="muted">Your company’s name and look, and which parts of each app are switched on.</p>
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {company === null && !error && <p className="muted">Loading…</p>}
        {company && (
          <>
            <ProfileCard
              company={company}
              onSaved={(c) => {
                setCompany(c);
                onBrandChange();
              }}
            />
            <ModulesCard company={company} onSaved={setCompany} />
            <section className="card settings-card" aria-labelledby="app-settings">
              <h2 id="app-settings">App settings</h2>
              <p className="muted">Each app keeps its own detailed settings. These open in the app.</p>
              <div className="link-grid">
                {company.apps.flatMap((app) =>
                  APP_SETTINGS[app].map((s) => (
                    <a key={s.href} className="link-tile" href={s.href}>
                      <span className={`chip chip-${app}`}>{APP_NAMES[app]}</span>
                      <strong>{s.label}</strong>
                      <small>{s.blurb}</small>
                    </a>
                  )),
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function SyncNote({ sync }: { sync?: Record<string, string> }) {
  const failed = Object.entries(sync ?? {}).filter(([, r]) => r !== 'ok');
  if (!failed.length) return null;
  return (
    <p className="error" role="alert">
      Saved, but {failed.map(([a]) => APP_NAMES[a as AppKey] ?? a).join(' and ')} could not be updated yet. It is sent again
      automatically on the next change.
    </p>
  );
}

function ProfileCard({ company, onSaved }: { company: CompanySettings; onSaved: (c: CompanySettings) => void }) {
  const [name, setName] = useState(company.name);
  const [shortName, setShortName] = useState(company.shortName ?? '');
  const [colour, setColour] = useState(company.colour ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sync, setSync] = useState<Record<string, string>>();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await call<CompanySettings>('PATCH', '/company', { name, shortName: shortName || null, colour: colour || null });
      setSync(res.sync);
      setMessage('Saved');
      onSaved(res);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    if (file.size > 512 * 1024) return setError('The logo must be at most 512 KB');
    const image = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Could not read the file'));
      r.readAsDataURL(file);
    });
    try {
      const res = await call<{ logoUrl: string | null; sync: Record<string, string> }>('PUT', '/company/logo', { image });
      setSync(res.sync);
      onSaved({ ...company, logoUrl: res.logoUrl });
    } catch (err) {
      setError(errorText(err));
    }
  };

  const removeLogo = async () => {
    try {
      const res = await call<{ logoUrl: null; sync: Record<string, string> }>('DELETE', '/company/logo');
      setSync(res.sync);
      onSaved({ ...company, logoUrl: null });
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <section className="card settings-card" aria-labelledby="company-profile">
      <h2 id="company-profile">Company</h2>
      <form onSubmit={save}>
        <div className="grid2">
          <label className="field">
            <span>Company name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} />
          </label>
          <label className="field">
            <span>Short name (menus and titles)</span>
            <input value={shortName} onChange={(e) => setShortName(e.target.value)} maxLength={40} placeholder={name} />
          </label>
        </div>
        <div className="grid2">
          <div className="field">
            <span id="brand-colour-label">Brand colour</span>
            <div className="colour-row">
              <input
                type="color"
                aria-labelledby="brand-colour-label"
                value={colour || '#2457f5'}
                onChange={(e) => setColour(e.target.value)}
              />
              <input
                className="input"
                aria-label="Brand colour code"
                value={colour}
                onChange={(e) => setColour(e.target.value)}
                placeholder="Default"
                pattern="#[0-9a-fA-F]{6}"
              />
              {colour && (
                <button type="button" className="btn small" onClick={() => setColour('')}>
                  Default
                </button>
              )}
            </div>
          </div>
          <div className="field">
            <span>Logo</span>
            <div className="logo-row">
              {company.logoUrl ? <img className="logo-preview" src={company.logoUrl} alt="Company logo" /> : <span className="logo-empty">No logo</span>}
              <label className="btn small">
                {company.logoUrl ? 'Change' : 'Upload'}
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} hidden aria-label="Upload logo" />
              </label>
              {company.logoUrl && (
                <button type="button" className="btn small danger" onClick={removeLogo}>
                  Remove
                </button>
              )}
            </div>
            <small className="muted">PNG, JPEG or WebP, up to 512 KB.</small>
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <SyncNote sync={sync} />
        <div className="form-actions">
          {message && <span className="muted" role="status">{message}</span>}
          <button className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save company'}
          </button>
        </div>
      </form>
    </section>
  );
}

function ModulesCard({ company, onSaved }: { company: CompanySettings; onSaved: (c: CompanySettings) => void }) {
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [sync, setSync] = useState<Record<string, string>>();

  const toggle = async (app: AppKey, key: string, on: boolean) => {
    setBusyKey(`${app}.${key}`);
    setError('');
    try {
      const res = await call<CompanySettings>('PUT', '/company/modules', { [app]: { [key]: on } });
      setSync(res.sync);
      onSaved(res);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusyKey('');
    }
  };

  return (
    <section className="card settings-card" aria-labelledby="modules">
      <h2 id="modules">Modules</h2>
      <p className="muted">Switch off what your company does not use: it leaves the menus and its reminders stop. Nothing is deleted.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <SyncNote sync={sync} />
      {company.modules.length === 0 && <p className="muted">No app is connected.</p>}
      {company.modules.map((a) => (
        <div key={a.app} className="module-group">
          <h3>
            <span className={`chip chip-${a.app}`}>{APP_NAMES[a.app]}</span>
          </h3>
          <ul className="module-list">
            {a.modules.map((m) => (
              <li key={m.key}>
                <div>
                  <strong>{m.label}</strong>
                  <small>{m.description}</small>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`${APP_NAMES[a.app]}: ${m.label}`}
                    checked={m.on}
                    disabled={busyKey === `${a.app}.${m.key}`}
                    onChange={(e) => void toggle(a.app, m.key, e.target.checked)}
                  />
                  <span />
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
