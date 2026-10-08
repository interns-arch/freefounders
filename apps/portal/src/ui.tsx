import type { ReactNode } from 'react';
import type { Me } from './api';
import { navigate } from './nav';

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden>
        FF
      </span>
      <span className="brand-name">FreeFounders</span>
    </div>
  );
}

export function TopBar({ me, onSignOut, children }: { me: Me; onSignOut: () => void; children?: ReactNode }) {
  return (
    <header className="topbar">
      <a
        href="/?choose"
        onClick={(e) => {
          e.preventDefault();
          navigate('/?choose');
        }}
        className="brand-link"
      >
        <Brand />
      </a>
      {children}
      <div className="topbar-right">
        <span className="who">
          <strong>{me.person.fullName}</strong>
          <small>
            {me.company.logoUrl && <img className="company-logo" src={me.company.logoUrl} alt="" />}
            {me.company.shortName || me.company.name}
          </small>
        </span>
        <button className="btn ghost" onClick={() => navigate('/account')}>
          Change password
        </button>
        <button className="btn ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}

type AdminPage = 'people' | 'roles' | 'settings';

/** Admin pages: People, Roles and Settings. */
export function PageNav({ current }: { current: AdminPage }) {
  const link = (to: AdminPage, label: string) => (
    <a
      href={`/${to}`}
      className={`tab${current === to ? ' on' : ''}`}
      aria-current={current === to ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        navigate(`/${to}`);
      }}
    >
      {label}
    </a>
  );
  return (
    <nav className="tabs" aria-label="Admin">
      <a className="btn ghost" href="/?choose">
        ← Workspaces
      </a>
      {link('people', 'People & access')}
      {link('roles', 'Roles')}
      {link('settings', 'Settings')}
    </nav>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal-card">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
