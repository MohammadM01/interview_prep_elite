'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';

export default function AuthScreen({ onSuccess }) {
  const { login, register } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [statusMessage, setStatusMessage] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      if (isRegister) {
        await register(email, password);
        setStatusMessage({ type: 'success', text: 'Account created. Transitioning to workspace...' });
      } else {
        await login(email, password);
        setStatusMessage({ type: 'success', text: 'Signed in. Transitioning to workspace...' });
      }
      onSuccess?.();
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Authentication failed. Please verify credentials.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-main)] flex flex-col justify-between p-6 sm:p-12">
      {/* Top minimal bar */}
      <header className="flex items-center justify-between max-w-4xl w-full mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-[5px] bg-[var(--text-main)] text-[var(--bg-surface)] flex items-center justify-center font-mono-num font-semibold text-xs tracking-wider">
            IP
          </div>
          <span className="text-xs font-semibold tracking-tight text-[var(--text-main)] font-mono-num uppercase">
            IPE
          </span>
        </div>

        <button
          onClick={toggleTheme}
          className="px-2.5 py-1 text-[11px] font-mono-num text-[var(--text-secondary)] hover:text-[var(--text-main)] border border-[var(--border-light)] hover:border-[var(--border-medium)] rounded-[5px] transition-smooth bg-[var(--bg-surface)]"
        >
          {theme === 'dark' ? 'LIGHT' : 'DARK'}
        </button>
      </header>

      {/* Central Login / Register Stage */}
      <main className="max-w-md w-full mx-auto my-auto py-8">
        <div className="mb-8">
          <div className="text-[10px] font-mono-num uppercase tracking-wider text-[var(--accent-primary)] font-semibold mb-2">
            01 / AUTHENTICATION
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-main)] leading-tight">
            Interview Preparation Elite
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed">
            Prepare smarter. Practice with purpose. Grounded in verified company research and deterministic coverage.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-mono-num uppercase tracking-wider text-[var(--text-main)] font-medium mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="candidate@company.com"
              className="w-full px-3.5 py-2.5 text-xs font-mono-num rounded-[6px] border border-[var(--border-light)] bg-[var(--bg-surface)] text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-smooth"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono-num uppercase tracking-wider text-[var(--text-main)] font-medium mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-3.5 py-2.5 text-xs font-mono-num rounded-[6px] border border-[var(--border-light)] bg-[var(--bg-surface)] text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-smooth"
            />
          </div>

          {statusMessage && (
            <div
              className={`p-3 text-xs font-mono-num rounded-[6px] border ${
                statusMessage.type === 'error'
                  ? 'bg-rose-500/10 border-[var(--accent-rose)]/40 text-[var(--accent-rose)]'
                  : 'bg-emerald-500/10 border-[var(--accent-emerald)]/40 text-[var(--accent-emerald)]'
              }`}
            >
              {statusMessage.text}
            </div>
          )}

          <div className="pt-2 flex flex-col gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 text-xs font-mono-num font-semibold uppercase tracking-wider bg-[var(--text-main)] text-[var(--bg-surface)] hover:bg-[var(--accent-primary)] disabled:opacity-50 rounded-[6px] transition-smooth cursor-pointer"
            >
              {isSubmitting
                ? 'Verifying...'
                : isRegister
                ? 'Create Workspace Account →'
                : 'Sign In to Workspace →'}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setStatusMessage(null);
              }}
              className="text-center text-xs font-mono-num text-[var(--text-secondary)] hover:text-[var(--text-main)] underline transition-colors pt-1"
            >
              {isRegister
                ? 'Already have an account? Sign in'
                : "Don't have an account? Register"}
            </button>
          </div>
        </form>
      </main>

      {/* Minimal Footer */}
      <footer className="text-center text-xs font-mono-num text-[var(--text-muted)] py-4">
        DETERMINISTIC INTERVIEW INTELLIGENCE
      </footer>
    </div>
  );
}
