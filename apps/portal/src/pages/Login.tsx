import { type FormEvent, useState } from 'react';
import { errorText, login } from '../api';
import { Brand } from '../ui';

export function LoginPage({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(loginId, password);
      await onSignedIn();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <form className="card auth-card" onSubmit={submit} noValidate>
        <Brand />
        <h1>Sign in</h1>
        <p className="muted">One login for Tasks and Assets.</p>
        <label className="field">
          <span>Email, username or employee ID</span>
          <input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary block" disabled={busy || !loginId || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="fine">Forgot your password? Ask your company admin to reset it.</p>
      </form>
    </main>
  );
}
