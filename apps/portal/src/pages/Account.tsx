import { type FormEvent, useState } from 'react';
import { ApiError, call, errorText, type Me } from '../api';
import { TopBar } from '../ui';

export function AccountPage({ me, onDone, onSignOut }: { me: Me; onDone: () => Promise<void>; onSignOut: () => void }) {
  const first = new URLSearchParams(window.location.search).has('first') || me.mustChangePassword;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (next.length < 8) return setError('Use at least 8 characters.');
    if (next !== again) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      await call('POST', '/auth/change-password', { currentPassword: current, newPassword: next });
      setDone(true);
      setCurrent('');
      setNext('');
      setAgain('');
      if (first) await onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.errors ? Object.values(err.errors)[0] : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <TopBar me={me} onSignOut={onSignOut} />
      <main className="container narrow">
        <form className="card form" onSubmit={submit}>
          <h1>{first ? 'Choose a new password' : 'Change password'}</h1>
          <p className="muted">
            {first
              ? 'Your password was set by an admin. Pick your own before you continue.'
              : 'Your other devices will be signed out; this one stays signed in.'}
          </p>
          <label className="field">
            <span>{first ? 'Password you were given' : 'Current password'}</span>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus required />
          </label>
          <label className="field">
            <span>New password (8+ characters)</span>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
          </label>
          <label className="field">
            <span>New password again</span>
            <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {done && !first && (
            <p className="ok" role="status">
              Password changed.
            </p>
          )}
          <div className="actions">
            {!first && (
              <a className="btn" href="/?choose">
                Back
              </a>
            )}
            <button className="btn primary" disabled={busy || !current || !next || !again}>
              {busy ? 'Saving…' : 'Save password'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
