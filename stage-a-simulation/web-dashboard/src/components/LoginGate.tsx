'use client';

import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { SIM_HTTP } from '@/lib/config';
import { Session } from '@/lib/session';

type Props = { children: (session: Session, logout: () => void) => ReactNode };

// shows the login form until there is a session. only used on stage B, stage A has no login
export default function LoginGate({ children }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<'checking' | 'out' | 'in'>('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // created here because sessionStorage only exists in the browser
    const created = new Session({
      base: SIM_HTTP,
      fetch: (...args) => window.fetch(...args),
      storage: window.sessionStorage,
      onExpired: () => {
        setStatus('out');
        setError('Your session has ended, please log in again');
      },
    });
    void created.restore().then((restored) => {
      setSession(created);
      setStatus(restored ? 'in' : 'out');
    });
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!session) return;
    setSubmitting(true);
    setError('');
    try {
      await session.login(email, password);
      setPassword('');
      setStatus('in');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const logout = () => {
    void session?.logout();
    setStatus('out');
    setError('');
  };

  if (status === 'in' && session) return <>{children(session, logout)}</>;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-emerald-400" />
          <h1 className="text-lg font-bold text-white">ASE-PRIME Fleet Command</h1>
        </div>

        <label className="block text-xs text-slate-400">
          Email
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
          />
        </label>

        <label className="block text-xs text-slate-400">
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
          />
        </label>

        {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting || status === 'checking'}
          className="w-full rounded-lg bg-emerald-500 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </main>
  );
}
