'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';

export default function AuthTester({ onUserChange }) {
  const { user, loading, login, register, logout, checkAuth } = useAuth();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [statusMessage, setStatusMessage] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    onUserChange?.(user);
  }, [user, onUserChange]);

  async function handleSubmit(e) {
    e.preventDefault();
    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      if (mode === 'register') {
        await register(email, password);
        setStatusMessage({
          type: 'success',
          text: 'Account registered successfully'
        });
      } else {
        await login(email, password);
        setStatusMessage({
          type: 'success',
          text: 'Signed in successfully'
        });
      }
      setEmail('');
      setPassword('');
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Authentication request failed'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    setIsSubmitting(true);
    try {
      await logout();
      setStatusMessage({ type: 'success', text: 'Signed out successfully' });
    } catch {
      setStatusMessage({ type: 'error', text: 'Error during logout' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mt-8 p-6 rounded-lg bg-white border border-[#E4E4E7] shadow-sm">
      <div className="flex items-center justify-between border-b border-[#E4E4E7] pb-4 mb-6">
        <div>
          <h3 className="text-sm font-semibold text-[#18181B]">Authentication State</h3>
          <p className="text-xs text-[#71717A]">Step 2 MongoDB session verification</p>
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-zinc-50 text-zinc-600 border border-zinc-200">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Checking session...
            </span>
          ) : user ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              Authenticated
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 text-zinc-600 border border-zinc-200">
              Unauthenticated
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-[#71717A]">
          <div className="w-4 h-4 border-2 border-zinc-300 border-t-zinc-800 rounded-full animate-spin" />
          <span>Restoring authenticated session from server...</span>
        </div>
      ) : user ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded bg-[#FAFAF9] border border-[#E4E4E7]">
          <div>
            <p className="text-xs text-[#71717A]">Active User Email</p>
            <p className="text-sm font-medium text-[#18181B]">{user.email}</p>
            <p className="text-[11px] text-[#A1A1AA] mt-0.5">User ID: {user.id}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => checkAuth()}
              className="px-3 py-1.5 text-xs font-medium rounded border border-[#E4E4E7] bg-white text-[#18181B] hover:bg-zinc-50"
            >
              Verify /me
            </button>
            <button
              onClick={handleLogout}
              disabled={isSubmitting}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[#18181B] text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {isSubmitting ? 'Signing out...' : 'Sign Out'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => { setMode('login'); setStatusMessage(null); }}
              className={`px-3 py-1 text-xs font-medium rounded ${
                mode === 'login'
                  ? 'bg-[#18181B] text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('register'); setStatusMessage(null); }}
              className={`px-3 py-1 text-xs font-medium rounded ${
                mode === 'register'
                  ? 'bg-[#18181B] text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="flex-1 px-3 py-2 text-xs rounded border border-[#E4E4E7] bg-white text-[#18181B] placeholder-[#A1A1AA] focus:outline-none focus:ring-1 focus:ring-[#18181B]"
            />
            <input
              type="password"
              placeholder="Password (minimum 8 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="flex-1 px-3 py-2 text-xs rounded border border-[#E4E4E7] bg-white text-[#18181B] placeholder-[#A1A1AA] focus:outline-none focus:ring-1 focus:ring-[#18181B]"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium rounded bg-[#18181B] text-white hover:bg-zinc-800 disabled:opacity-50 whitespace-nowrap"
            >
              {isSubmitting ? 'Processing...' : mode === 'register' ? 'Create Account' : 'Sign In'}
            </button>
          </form>
        </div>
      )}

      {statusMessage && (
        <div
          className={`mt-4 p-3 rounded text-xs ${
            statusMessage.type === 'error'
              ? 'bg-rose-50 text-rose-700 border border-rose-200'
              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          }`}
        >
          {statusMessage.text}
        </div>
      )}
    </div>
  );
}
