'use client';

import { useState, useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export default function AuthTester() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [statusMessage, setStatusMessage] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function checkSession() {
    try {
      setAuthLoading(true);
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(data.user);
      } else {
        setCurrentUser(null);
      }
    } catch (err) {
      setCurrentUser(null);
    } finally {
      setAuthLoading(false);
    }
  }

  useEffect(() => {
    checkSession();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setIsSubmitting(true);
    setStatusMessage(null);

    const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (!res.ok) {
        setStatusMessage({
          type: 'error',
          text: data.error?.message || 'Authentication request failed'
        });
      } else {
        setCurrentUser(data.user);
        setStatusMessage({
          type: 'success',
          text: mode === 'register' ? 'Account registered successfully' : 'Signed in successfully'
        });
        setEmail('');
        setPassword('');
      }
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: 'Unable to reach backend server. Please verify backend is running on port 5000.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    setIsSubmitting(true);
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
      setCurrentUser(null);
      setStatusMessage({ type: 'success', text: 'Signed out successfully' });
    } catch (err) {
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
          {authLoading ? (
            <span className="text-xs text-[#71717A]">Checking session...</span>
          ) : currentUser ? (
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

      {currentUser ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded bg-[#FAFAF9] border border-[#E4E4E7]">
          <div>
            <p className="text-xs text-[#71717A]">Active User Email</p>
            <p className="text-sm font-medium text-[#18181B]">{currentUser.email}</p>
            <p className="text-[11px] text-[#A1A1AA] mt-0.5">User ID: {currentUser.id}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={checkSession}
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
