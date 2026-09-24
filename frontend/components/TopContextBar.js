'use client';

import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';

export default function TopContextBar({ activeStep = '01', stepLabel = 'Create', totalSteps = '06' }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-[var(--border-light)] bg-[var(--bg-surface)]/95 backdrop-blur-sm px-4 sm:px-8 flex items-center justify-between">
      {/* Left: IPE Brand */}
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-6 h-6 rounded-[5px] bg-[var(--text-main)] text-[var(--bg-surface)] flex items-center justify-center font-mono-num font-semibold text-[11px] tracking-wider transition-colors group-hover:bg-[var(--accent-primary)]">
            IP
          </div>
          <span className="text-xs font-semibold tracking-tight text-[var(--text-main)] font-mono-num uppercase">
            IPE
          </span>
        </Link>
      </div>

      {/* Center: Guided Step Indicator */}
      {user && (
        <div className="hidden sm:flex items-center gap-2 text-xs font-mono-num">
          <span className="text-[var(--text-muted)] uppercase tracking-wider text-[11px]">
            Step {activeStep} / {totalSteps}
          </span>
          <span className="text-[var(--border-medium)]">·</span>
          <span className="text-[var(--accent-primary)] font-medium">
            {stepLabel}
          </span>
        </div>
      )}

      {/* Right: Theme Toggle & User Status */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleTheme}
          className="px-2.5 py-1 text-[11px] font-mono-num text-[var(--text-secondary)] hover:text-[var(--text-main)] border border-[var(--border-light)] hover:border-[var(--border-medium)] rounded-[5px] transition-smooth bg-[var(--bg-surface)]"
          title="Toggle color theme"
        >
          {theme === 'dark' ? 'LIGHT' : 'DARK'}
        </button>

        {user ? (
          <div className="flex items-center gap-3 text-xs font-mono-num">
            <span className="text-[var(--text-secondary)] hidden md:inline truncate max-w-[140px]">
              {user.email?.split('@')[0]}
            </span>
            <button
              onClick={logout}
              className="text-[var(--accent-rose)] hover:underline font-medium text-[11px]"
            >
              LOGOUT
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
