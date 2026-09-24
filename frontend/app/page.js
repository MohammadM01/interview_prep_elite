'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import TopContextBar from '@/components/TopContextBar';
import AuthScreen from '@/components/AuthScreen';
import PipelineTracker from '@/components/PipelineTracker';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export default function GuidedHomePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Guided view state: 'create' | 'generating' | 'ready' | 'my-kits'
  const [viewState, setViewState] = useState('create');

  // Form inputs
  const [jd, setJd] = useState('');
  const [companyUrl, setCompanyUrl] = useState('');
  const [daysAvailable, setDaysAvailable] = useState(7);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Active generated kit data
  const [activeKit, setActiveKit] = useState(null);
  const [activeJob, setActiveJob] = useState(null);

  // Existing kits list
  const [userKits, setUserKits] = useState([]);
  const [loadingKits, setLoadingKits] = useState(false);

  // Load kits when authenticated
  useEffect(() => {
    if (!user) return;
    loadUserKits();
  }, [user]);

  async function loadUserKits() {
    try {
      setLoadingKits(true);
      const res = await fetch(`${API_BASE}/api/kits`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUserKits(data.kits || []);
      }
    } catch {
      // Handled silently
    } finally {
      setLoadingKits(false);
    }
  }

  // Poll generation job during 'generating' phase
  useEffect(() => {
    if (viewState !== 'generating' || !activeJob) return;

    const interval = setInterval(async () => {
      try {
        const jobId = activeJob._id || activeJob.id;
        const res = await fetch(`${API_BASE}/api/generation-jobs/${jobId}`, {
          credentials: 'include'
        });
        if (res.ok) {
          const data = await res.json();
          const job = data.job;
          setActiveJob(job);

          if (job?.status === 'completed') {
            // Load the newly generated kit details
            const kitRes = await fetch(`${API_BASE}/api/kits/${job.kit_id}`, {
              credentials: 'include'
            });
            if (kitRes.ok) {
              const kitData = await kitRes.json();
              setActiveKit(kitData.kit);
              setViewState('ready');
            }
          } else if (job?.status === 'failed') {
            setErrorMessage(job.error?.message || 'Generation pipeline failed');
          }
        }
      } catch {
        // Polling network error
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [viewState, activeJob]);

  // Form Submit: Create Kit & Trigger Pipeline
  async function handleCreateKit(e) {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedJd = jd.trim();
    if (!trimmedJd) {
      setErrorMessage('Please provide the job description text.');
      return;
    }

    const trimmedUrl = companyUrl.trim();
    if (!trimmedUrl) {
      setErrorMessage('Please provide the company website URL.');
      return;
    }

    const days = parseInt(daysAvailable, 10);
    if (isNaN(days) || days < 1 || days > 60) {
      setErrorMessage('Days available must be between 1 and 60.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Step 1: Create Kit
      const res = await fetch(`${API_BASE}/api/kits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          jd: trimmedJd,
          company_url: trimmedUrl,
          days_available: days
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to create kit.');
      }

      const kitId = data.kit?.id || data.kit?._id;
      setActiveJob(data.job);
      setActiveKit(data.kit);
      setViewState('generating');

      // Step 2: Trigger Staged Generation sequentially (/start -> /questions -> /flashcards -> /finalize)
      if (kitId) {
        (async () => {
          try {
            // Stage 1: Research, Extraction & Role Analysis
            const res1 = await fetch(`${API_BASE}/api/kits/${kitId}/generate/start`, {
              method: 'POST',
              credentials: 'include'
            });
            if (!res1.ok) {
              const errData = await res1.json().catch(() => ({}));
              throw new Error(errData.error?.message || 'Stage 1 (Research & Extraction) failed');
            }

            // Stage 2: Question Generation
            const res2 = await fetch(`${API_BASE}/api/kits/${kitId}/generate/questions`, {
              method: 'POST',
              credentials: 'include'
            });
            if (!res2.ok) {
              const errData = await res2.json().catch(() => ({}));
              throw new Error(errData.error?.message || 'Stage 2 (Questions) failed');
            }

            // Stage 3: Flashcard Generation
            const res3 = await fetch(`${API_BASE}/api/kits/${kitId}/generate/flashcards`, {
              method: 'POST',
              credentials: 'include'
            });
            if (!res3.ok) {
              const errData = await res3.json().catch(() => ({}));
              throw new Error(errData.error?.message || 'Stage 3 (Flashcards) failed');
            }

            // Stage 4: Coverage Analysis & Preparation Schedule Finalization
            const res4 = await fetch(`${API_BASE}/api/kits/${kitId}/generate/finalize`, {
              method: 'POST',
              credentials: 'include'
            });
            if (!res4.ok) {
              const errData = await res4.json().catch(() => ({}));
              throw new Error(errData.error?.message || 'Stage 4 (Coverage & Schedule) failed');
            }
          } catch (stageErr) {
            console.error('Staged generation pipeline error:', stageErr);
            setErrorMessage(stageErr.message || 'Generation pipeline failed');
          }
        })();
      }
    } catch (err) {
      setErrorMessage(err.message || 'Unable to start kit generation.');
      setIsSubmitting(false);
    }
  }

  // 1. ABSOLUTE RULE — AUTHENTICATION GATE
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center">
        <div className="text-xs font-mono-num text-[var(--text-muted)] animate-pulse">
          VERIFYING SESSION...
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onSuccess={loadUserKits} />;
  }

  // Determine current step for TopContextBar
  const stepInfo = {
    create: { step: '01', label: 'Create' },
    generating: { step: '02', label: 'Generate' },
    ready: { step: '03', label: 'Review' },
    'my-kits': { step: '01', label: 'My Kits' }
  }[viewState] || { step: '01', label: 'Workspace' };

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-main)] flex flex-col justify-between">
      {/* MINIMAL TOP BAR (NO SIDEBAR) */}
      <TopContextBar
        activeStep={stepInfo.step}
        stepLabel={stepInfo.label}
        totalSteps="06"
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-8 py-8 md:py-16">
        {/* ============================================================ */}
        {/* VIEW 1: CREATE YOUR INTERVIEW KIT (FIRST EXPERIENCE AFTER LOGIN) */}
        {/* ============================================================ */}
        {viewState === 'create' && (
          <div className="space-y-12">
            {/* Header / Intro */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
              <div className="md:col-span-5 space-y-4">
                <div className="text-[11px] font-mono-num uppercase tracking-wider text-[var(--accent-primary)] font-semibold">
                  01 / CREATE
                </div>
                <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight text-[var(--text-main)] leading-tight">
                  Create your interview kit.
                </h1>
                <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
                  Turn a job description and company website into a personalized interview preparation system.
                </p>

                <div className="pt-4 space-y-2 text-xs font-mono-num text-[var(--text-muted)]">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--accent-primary)]">✓</span>
                    <span>Robots.txt compliant public research</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--accent-primary)]">✓</span>
                    <span>Deterministic requirement coverage</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--accent-primary)]">✓</span>
                    <span>Structured day-by-day schedule</span>
                  </div>
                </div>

                {userKits.length > 0 && (
                  <div className="pt-6 border-t border-[var(--border-subtle)]">
                    <button
                      onClick={() => setViewState('my-kits')}
                      className="text-xs font-mono-num text-[var(--accent-primary)] hover:underline flex items-center gap-1.5"
                    >
                      <span>View existing kits ({userKits.length})</span>
                      <span>→</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Form Column */}
              <div className="md:col-span-7">
                <form onSubmit={handleCreateKit} className="space-y-6">
                  {/* Job Description */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-mono-num">
                      <label htmlFor="jd-text" className="font-semibold uppercase text-[var(--text-main)]">
                        JOB DESCRIPTION
                      </label>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {jd.length} chars
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Paste the role description, key responsibilities, and requirements.
                    </p>
                    <textarea
                      id="jd-text"
                      rows={6}
                      value={jd}
                      onChange={(e) => setJd(e.target.value)}
                      placeholder="e.g. Senior Full Stack Engineer. Must have 5+ years of experience with Node.js, TypeScript, and MongoDB. Experience designing distributed microservices..."
                      required
                      className="w-full p-3.5 text-xs font-sans rounded-[6px] border border-[var(--border-light)] bg-[var(--bg-surface)] text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-smooth leading-relaxed"
                    />
                  </div>

                  {/* Company URL */}
                  <div className="space-y-1.5">
                    <label htmlFor="comp-url" className="block text-xs font-mono-num font-semibold uppercase text-[var(--text-main)]">
                      COMPANY WEBSITE
                    </label>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Primary corporate address for verified company research.
                    </p>
                    <input
                      id="comp-url"
                      type="url"
                      value={companyUrl}
                      onChange={(e) => setCompanyUrl(e.target.value)}
                      placeholder="https://stripe.com"
                      required
                      className="w-full px-3.5 py-2.5 text-xs font-mono-num rounded-[6px] border border-[var(--border-light)] bg-[var(--bg-surface)] text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-smooth"
                    />
                  </div>

                  {/* Preparation Days */}
                  <div className="space-y-1.5">
                    <label htmlFor="days-count" className="block text-xs font-mono-num font-semibold uppercase text-[var(--text-main)]">
                      PREPARATION PLAN
                    </label>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Days available before your interview (1–60 days).
                    </p>
                    <div className="flex items-center gap-3">
                      <input
                        id="days-count"
                        type="number"
                        min="1"
                        max="60"
                        value={daysAvailable}
                        onChange={(e) => setDaysAvailable(e.target.value)}
                        required
                        className="w-24 px-3.5 py-2 text-xs font-mono-num rounded-[6px] border border-[var(--border-light)] bg-[var(--bg-surface)] text-[var(--text-main)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-smooth"
                      />
                      <span className="text-xs font-mono-num text-[var(--text-muted)]">
                        days (standard 60 min/day schedule)
                      </span>
                    </div>
                  </div>

                  {errorMessage && (
                    <div className="p-3 text-xs font-mono-num text-[var(--accent-rose)] border border-[var(--accent-rose)]/40 bg-rose-500/10 rounded-[6px]">
                      {errorMessage}
                    </div>
                  )}

                  {/* Primary CTA */}
                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full sm:w-auto px-8 py-3 text-xs font-mono-num font-semibold uppercase tracking-wider bg-[var(--text-main)] text-[var(--bg-surface)] hover:bg-[var(--accent-primary)] disabled:opacity-50 rounded-[6px] transition-smooth cursor-pointer"
                    >
                      {isSubmitting ? 'INITIALIZING...' : 'Create interview kit →'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* VIEW 2: DEDICATED GENERATION EXPERIENCE (AFTER CREATE) */}
        {/* ============================================================ */}
        {viewState === 'generating' && (
          <div className="max-w-2xl mx-auto py-8 space-y-8">
            <div>
              <div className="text-[11px] font-mono-num uppercase tracking-wider text-[var(--accent-primary)] font-semibold mb-1">
                02 / GENERATION
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-main)]">
                Building your interview preparation.
              </h1>
              <p className="text-xs text-[var(--text-secondary)] mt-1.5">
                We're researching the role and constructing your targeted interview system.
              </p>
            </div>

            {/* Real Pipeline Stage Tracker */}
            <PipelineTracker
              currentStage={activeJob?.stage || 'queued'}
              error={activeJob?.status === 'failed' ? (activeJob.error?.message || errorMessage) : null}
              onRetry={() => {
                setViewState('create');
              }}
            />
          </div>
        )}

        {/* ============================================================ */}
        {/* VIEW 3: KIT READY TRANSITION */}
        {/* ============================================================ */}
        {viewState === 'ready' && activeKit && (
          <div className="max-w-2xl mx-auto py-12 space-y-8 text-center">
            <div className="space-y-2">
              <div className="text-[11px] font-mono-num uppercase tracking-wider text-[var(--accent-emerald)] font-semibold">
                03 / KIT READY
              </div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-main)]">
                Your interview kit is ready.
              </h1>
              <p className="text-sm text-[var(--text-secondary)]">
                {activeKit.role?.title || 'Analyzed Engineering Role'} · {activeKit.source?.company_url?.replace(/https?:\/\/(www\.)?/, '').split('/')[0] || 'Target Organization'}
              </p>
            </div>

            {/* Metrics Snapshot */}
            <div className="py-6 border-y border-[var(--border-light)] grid grid-cols-2 sm:grid-cols-4 gap-4 text-center font-mono-num">
              <div>
                <div className="text-2xl font-bold text-[var(--accent-emerald)]">
                  {activeKit.coverage?.coverage_percentage || 100}%
                </div>
                <div className="text-[10px] uppercase text-[var(--text-muted)] mt-1">Coverage</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-[var(--text-main)]">
                  {activeKit.questions?.length || 0}
                </div>
                <div className="text-[10px] uppercase text-[var(--text-muted)] mt-1">Questions</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-[var(--text-main)]">
                  {activeKit.flashcards?.length || 0}
                </div>
                <div className="text-[10px] uppercase text-[var(--text-muted)] mt-1">Flashcards</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-[var(--accent-primary)]">
                  {activeKit.schedule?.days?.length || activeKit.schedule?.days_available || 5}
                </div>
                <div className="text-[10px] uppercase text-[var(--text-muted)] mt-1">Days Plan</div>
              </div>
            </div>

            {/* ONE OBVIOUS NEXT ACTION */}
            <div className="pt-4">
              <Link
                href={`/kits/${activeKit._id || activeKit.id}`}
                className="inline-block px-8 py-3.5 text-xs font-mono-num font-semibold uppercase tracking-wider bg-[var(--text-main)] text-[var(--bg-surface)] hover:bg-[var(--accent-primary)] rounded-[6px] transition-smooth cursor-pointer shadow-sm"
              >
                Review your preparation kit →
              </Link>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* VIEW 4: MY INTERVIEW KITS (EDITORIAL LIST) */}
        {/* ============================================================ */}
        {viewState === 'my-kits' && (
          <div className="space-y-8 max-w-3xl mx-auto">
            <div className="flex items-baseline justify-between pb-4 border-b border-[var(--border-light)]">
              <div>
                <div className="text-[11px] font-mono-num uppercase tracking-wider text-[var(--accent-primary)] font-semibold mb-1">
                  01 / WORKSPACE
                </div>
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[var(--text-main)]">
                  My Interview Kits
                </h1>
              </div>
              <button
                onClick={() => setViewState('create')}
                className="px-4 py-2 text-xs font-mono-num font-semibold uppercase tracking-wider bg-[var(--text-main)] text-[var(--bg-surface)] hover:bg-[var(--accent-primary)] rounded-[6px] transition-smooth cursor-pointer"
              >
                + Create another kit
              </button>
            </div>

            {loadingKits ? (
              <div className="py-12 text-center text-xs font-mono-num text-[var(--text-muted)] animate-pulse">
                LOADING KITS...
              </div>
            ) : userKits.length === 0 ? (
              <div className="py-12 text-center text-xs font-mono-num text-[var(--text-muted)]">
                No kits found. Start by creating your first kit above.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-light)] border-b border-[var(--border-light)]">
                {userKits.map((k, idx) => {
                  const kid = k.id || k._id;
                  const company = k.company_url?.replace(/https?:\/\/(www\.)?/, '').split('/')[0]
                    || k.source?.company_url?.replace(/https?:\/\/(www\.)?/, '').split('/')[0]
                    || 'Target Organization';
                  const title = k.role_title || k.role?.title || 'Analyzed Role';
                  const cov = k.coverage?.coverage_percentage !== undefined ? k.coverage.coverage_percentage : null;

                  return (
                    <div
                      key={kid}
                      className="py-5 flex items-center justify-between gap-4 group"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2.5 text-xs font-mono-num">
                          <span className="font-semibold text-[var(--accent-primary)]">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <span className="uppercase text-[var(--text-muted)] tracking-wider">
                            {company}
                          </span>
                        </div>
                        <h2 className="text-sm font-semibold text-[var(--text-main)]">
                          {title}
                        </h2>
                        {cov !== null && (
                          <div className="text-xs font-mono-num text-[var(--accent-emerald)]">
                            {cov}% requirement coverage
                          </div>
                        )}
                      </div>

                      <Link
                        href={`/kits/${kid}`}
                        className="px-4 py-2 text-xs font-mono-num uppercase tracking-wider font-semibold border border-[var(--border-light)] hover:border-[var(--text-main)] text-[var(--text-main)] rounded-[6px] transition-smooth bg-[var(--bg-surface)] shrink-0"
                      >
                        Open kit →
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-[var(--border-light)] py-4 px-4 sm:px-8 text-center text-xs font-mono-num text-[var(--text-muted)]">
        INTERVIEW PREPARATION ELITE · GUIDED WORKSPACE
      </footer>
    </div>
  );
}
