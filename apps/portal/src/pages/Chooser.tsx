import { useState } from 'react';
import { type AppKey, isAdmin, type Me } from '../api';
import { navigate, remember, rememberedApp } from '../nav';
import { TopBar } from '../ui';

const BLURB: Record<AppKey, string> = {
  tasks: 'Tasks, checklists, attendance and leave',
  assets: 'Assets, onboarding kits, requests and tickets',
};

export function ChooserPage({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [keep, setKeep] = useState(() => !!rememberedApp());

  const open = (app: AppKey, path: string) => {
    remember(keep ? app : null);
    window.location.assign(path);
  };

  return (
    <div className="page">
      <TopBar me={me} onSignOut={onSignOut} />
      <main className="container narrow">
        <h1>Choose your workspace</h1>
        <p className="muted">Hi {me.person.fullName.split(' ')[0]}. Where would you like to go?</p>

        {me.apps.length === 0 && (
          <div className="card note">
            You don’t have access to any app yet.{' '}
            {isAdmin(me) ? 'Give yourself access from People & access below.' : 'Ask your company admin to give you access.'}
          </div>
        )}

        <div className="tiles">
          {me.apps.map((a) => (
            <button key={a.app} className={`tile tile-${a.app}`} onClick={() => open(a.app, a.path)}>
              <span className="tile-icon" aria-hidden>
                {a.app === 'tasks' ? '✓' : '▣'}
              </span>
              <span className="tile-name">{a.name}</span>
              <span className="tile-blurb">{BLURB[a.app]}</span>
            </button>
          ))}
          {isAdmin(me) && (
            <button className="tile tile-admin" onClick={() => navigate('/people')}>
              <span className="tile-icon" aria-hidden>
                ☺
              </span>
              <span className="tile-name">People &amp; access</span>
              <span className="tile-blurb">Add people, give app access, reset passwords</span>
            </button>
          )}
        </div>

        {me.apps.length > 1 && (
          <label className="check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            Remember my choice on this device
          </label>
        )}
      </main>
    </div>
  );
}
