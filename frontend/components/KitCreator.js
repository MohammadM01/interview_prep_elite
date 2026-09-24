'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export default function KitCreator({ currentUser: propUser }) {
  const { user: contextUser, loading: authLoading } = useAuth();
  const currentUser = propUser != null ? propUser : contextUser;
  const [jd, setJd] = useState('');
  const [companyUrl, setCompanyUrl] = useState('');
  const [daysAvailable, setDaysAvailable] = useState(5);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [createdResult, setCreatedResult] = useState(null);
  const [userKits, setUserKits] = useState([]);
  const [loadingKits, setLoadingKits] = useState(false);
  const [jobStatus, setJobStatus] = useState(null);
  const [checkingJob, setCheckingJob] = useState(false);
  const [researchState, setResearchState] = useState({});

  const [analysisState, setAnalysisState] = useState({});
  const [generationState, setGenerationState] = useState({});

  async function handleTriggerGeneration(kitId) {
    setGenerationState((prev) => ({
      ...prev,
      [kitId]: { status: 'running', stage: 'question_generation', message: 'Generating questions & study flashcards...' }
    }));

    try {
      const res = await fetch(`${API_BASE}/api/kits/${kitId}/generate`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();

      if (!res.ok) {
        setGenerationState((prev) => ({
          ...prev,
          [kitId]: {
            status: 'failed',
            message: `Generation failed: ${data.error?.message || 'Error occurred'}`
          }
        }));
      } else {
        const qCount = data.kit?.questions?.length || 0;
        const fCount = data.kit?.flashcards?.length || 0;
        const schedDays = data.kit?.schedule?.days?.length || data.kit?.schedule?.days_available || 0;
        const uncoveredCount = data.kit?.coverage?.uncovered_requirement_ids?.length || 0;
        const coverageMsg = uncoveredCount === 0
          ? 'All required areas covered'
          : `${uncoveredCount} required area(s) need more questions`;

        setGenerationState((prev) => ({
          ...prev,
          [kitId]: {
            status: 'complete',
            stage: 'generation_completed',
            message: `Ready: ${qCount} questions · ${fCount} flashcards · ${coverageMsg} · ${schedDays}-day study plan`,
            data: data.kit
          }
        }));
        await loadKits();
      }
    } catch {
      setGenerationState((prev) => ({
        ...prev,
        [kitId]: { status: 'failed', message: 'Generation failed: Network error' }
      }));
    }
  }

  async function handleTriggerAnalysis(kitId) {
    setAnalysisState((prev) => ({
      ...prev,
      [kitId]: { status: 'running', stage: 'requirements_extraction', message: 'Analyzing job requirements...' }
    }));

    try {
      const res = await fetch(`${API_BASE}/api/kits/${kitId}/analyze`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();

      if (!res.ok) {
        setAnalysisState((prev) => ({
          ...prev,
          [kitId]: {
            status: 'failed',
            message: `Analysis failed: ${data.error?.message || 'Error occurred'}`
          }
        }));
      } else {
        const reqCount = data.kit?.role?.requirements?.length || 0;
        const roleTitle = data.kit?.role?.title || 'Analyzed Role';
        setAnalysisState((prev) => ({
          ...prev,
          [kitId]: {
            status: 'complete',
            stage: 'analysis_completed',
            message: `Analysis completed: ${roleTitle} (${reqCount} requirements)`,
            data: data.kit
          }
        }));
        await loadKits();
      }
    } catch {
      setAnalysisState((prev) => ({
        ...prev,
        [kitId]: { status: 'failed', message: 'Analysis failed: Network error' }
      }));
    }
  }

  async function handleTriggerResearch(kitId) {
    setResearchState((prev) => ({
      ...prev,
      [kitId]: { status: 'running', message: 'Researching company...' }
    }));

    try {
      const res = await fetch(`${API_BASE}/api/kits/${kitId}/research`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();

      if (!res.ok) {
        setResearchState((prev) => ({
          ...prev,
          [kitId]: {
            status: 'failed',
            message: `Research failed: ${data.error?.message || 'Error occurred'}`
          }
        }));
      } else {
        const warningsCount = data.research?.warnings?.length || 0;
        const pagesCount = data.research?.pages_count || data.research?.pages?.length || 0;
        const isPartial = warningsCount > 0;

        setResearchState((prev) => ({
          ...prev,
          [kitId]: {
            status: isPartial ? 'partial' : 'complete',
            message: isPartial
              ? `Research partially completed (${pagesCount} pages, ${warningsCount} warnings)`
              : `Research complete (${pagesCount} pages)`,
            data: data.research
          }
        }));
        await loadKits();
      }
    } catch {
      setResearchState((prev) => ({
        ...prev,
        [kitId]: { status: 'failed', message: 'Research failed: Network error' }
      }));
    }
  }

  useEffect(() => {
    if (authLoading) return;
    if (currentUser) {
      loadKits();
    } else {
      setUserKits([]);
      setCreatedResult(null);
      setJobStatus(null);
    }
  }, [currentUser, authLoading]);

  async function loadKits() {
    try {
      setLoadingKits(true);
      const res = await fetch(`${API_BASE}/api/kits`, {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setUserKits(data.kits || []);
      }
    } catch {
      // Gracefully handle network error
    } finally {
      setLoadingKits(false);
    }
  }

  async function handleCheckJobStatus(jobId) {
    try {
      setCheckingJob(true);
      const res = await fetch(`${API_BASE}/api/generation-jobs/${jobId}`, {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setJobStatus(data.job);
      }
    } catch {
      // Gracefully handle network error
    } finally {
      setCheckingJob(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedJd = jd.trim();
    if (!trimmedJd) {
      setErrorMessage('Job description cannot be empty');
      return;
    }

    const trimmedUrl = companyUrl.trim();
    if (!trimmedUrl) {
      setErrorMessage('Company website URL is required');
      return;
    }

    const days = parseInt(daysAvailable, 10);
    if (isNaN(days) || days < 1 || days > 60) {
      setErrorMessage('Days available must be between 1 and 60');
      return;
    }

    setIsSubmitting(true);

    try {
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
        setErrorMessage(data.error?.message || 'Failed to create interview kit');
      } else {
        setCreatedResult(data);
        setJobStatus(data.job);
        setJd('');
        setCompanyUrl('');
        setDaysAvailable(5);
        await loadKits();
      }
    } catch {
      setErrorMessage('Unable to connect to backend service. Please ensure server is running.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (authLoading) {
    return (
      <div className="mt-8 p-6 rounded-lg bg-white border border-[#E4E4E7] text-center">
        <h3 className="text-sm font-semibold text-[#18181B] mb-1">Create Interview Kit</h3>
        <p className="text-xs text-[#71717A] animate-pulse">
          Loading preparation kits and session...
        </p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="mt-8 p-6 rounded-lg bg-white border border-[#E4E4E7] text-center">
        <h3 className="text-sm font-semibold text-[#18181B] mb-1">Create Interview Kit</h3>
        <p className="text-xs text-[#71717A]">
          Please sign in or register above to create and manage your personalized interview preparation kits.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="p-6 rounded-lg bg-white border border-[#E4E4E7] shadow-sm">
        <div className="border-b border-[#E4E4E7] pb-4 mb-6">
          <h3 className="text-sm font-semibold text-[#18181B]">Create Interview Kit</h3>
          <p className="text-xs text-[#71717A]">
            Enter the target role details and timeline to initialize the generation pipeline.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#18181B] mb-1.5">
              Job Description
            </label>
            <textarea
              rows={5}
              placeholder="Paste the complete job description text here..."
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              required
              className="w-full px-3 py-2 text-xs rounded border border-[#E4E4E7] bg-white text-[#18181B] placeholder-[#A1A1AA] focus:outline-none focus:ring-1 focus:ring-[#18181B]"
            />
            <div className="flex justify-between mt-1 text-[11px] text-[#A1A1AA]">
              <span>Preserves exact posting requirements</span>
              <span>{jd.length} characters</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[#18181B] mb-1.5">
                Company Website URL
              </label>
              <input
                type="url"
                placeholder="https://example.com"
                value={companyUrl}
                onChange={(e) => setCompanyUrl(e.target.value)}
                required
                className="w-full px-3 py-2 text-xs rounded border border-[#E4E4E7] bg-white text-[#18181B] placeholder-[#A1A1AA] focus:outline-none focus:ring-1 focus:ring-[#18181B]"
              />
              <p className="text-[11px] text-[#A1A1AA] mt-1">Must be a public http/https URL</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#18181B] mb-1.5">
                Days Available (1 - 60)
              </label>
              <input
                type="number"
                min={1}
                max={60}
                value={daysAvailable}
                onChange={(e) => setDaysAvailable(e.target.value)}
                required
                className="w-full px-3 py-2 text-xs rounded border border-[#E4E4E7] bg-white text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#18181B]"
              />
              <p className="text-[11px] text-[#A1A1AA] mt-1">Timeline for schedule</p>
            </div>
          </div>

          {errorMessage && (
            <div className="p-3 rounded text-xs bg-rose-50 text-rose-700 border border-rose-200">
              {errorMessage}
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 text-xs font-medium rounded bg-[#18181B] text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? 'Creating Interview Kit...' : 'Create Interview Kit'}
            </button>
          </div>
        </form>
      </div>

      {createdResult && (
        <div className="p-6 rounded-lg bg-[#FAFAF9] border border-emerald-200 shadow-sm">
          <div className="flex items-center justify-between border-b border-[#E4E4E7] pb-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                Interview Kit Initialized
              </h4>
            </div>
            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800 border border-emerald-300">
              Status: {createdResult.kit.status}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-3 rounded bg-white border border-[#E4E4E7]">
              <p className="text-[#71717A] mb-1">Kit Identifier</p>
              <p className="font-mono text-[#18181B]">{createdResult.kit.id}</p>
            </div>
            <div className="p-3 rounded bg-white border border-[#E4E4E7]">
              <p className="text-[#71717A] mb-1">Generation Job Identifier</p>
              <p className="font-mono text-[#18181B]">{createdResult.job.id}</p>
            </div>
          </div>

          {jobStatus && (
            <div className="mt-4 p-3 rounded bg-white border border-[#E4E4E7] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div>
                <span className="text-[#71717A]">Job Stage: </span>
                <span className="font-medium text-[#18181B]">{jobStatus.stage}</span>
                <span className="text-[#71717A] ml-3">Progress: </span>
                <span className="font-medium text-[#18181B]">{jobStatus.progress}%</span>
              </div>
              <button
                onClick={() => handleCheckJobStatus(createdResult.job.id)}
                disabled={checkingJob}
                className="px-3 py-1 text-xs rounded border border-[#E4E4E7] bg-[#FAFAF9] hover:bg-zinc-100 text-[#18181B]"
              >
                {checkingJob ? 'Checking...' : 'Refresh Status'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="p-6 rounded-lg bg-white border border-[#E4E4E7] shadow-sm">
        <div className="flex items-center justify-between border-b border-[#E4E4E7] pb-3 mb-4">
          <h4 className="text-sm font-semibold text-[#18181B]">Your Interview Kits</h4>
          <button
            onClick={loadKits}
            disabled={loadingKits}
            className="text-xs text-[#71717A] hover:text-[#18181B]"
          >
            {loadingKits ? 'Loading...' : 'Refresh List'}
          </button>
        </div>

        {loadingKits ? (
          <p className="text-xs text-[#71717A] py-4 text-center">Loading interview kits...</p>
        ) : userKits.length === 0 ? (
          <p className="text-xs text-[#71717A] py-4 text-center">
            No interview kits created yet. Submit a job description above to get started.
          </p>
        ) : (
          <div className="divide-y divide-[#E4E4E7]">
            {userKits.map((kit) => {
              const rState = researchState[kit.id];
              const aState = analysisState[kit.id];
              const gState = generationState[kit.id];
              return (
                <div key={kit.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-[#18181B]">{kit.company_url || 'Target Company'}</p>
                      {kit.role_title && (
                        <span className="text-[11px] font-medium text-zinc-600 bg-zinc-100 px-1.5 py-0.5 rounded">
                          {kit.role_title}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-[#71717A]">
                      <span>{kit.schedule_days_count > 0 ? `${kit.schedule_days_count}-day study plan` : `${kit.days_available} days schedule`}</span>
                      <span>·</span>
                      <span>{kit.jd_chars} chars</span>
                      {kit.questions_count > 0 && (
                        <>
                          <span>·</span>
                          <span className="font-medium text-[#18181B]">{kit.questions_count} questions</span>
                        </>
                      )}
                      {kit.flashcards_count > 0 && (
                        <>
                          <span>·</span>
                          <span className="font-medium text-[#18181B]">{kit.flashcards_count} flashcards</span>
                        </>
                      )}
                      {kit.coverage && (
                        <>
                          <span>·</span>
                          {kit.coverage.uncovered_requirement_ids?.length === 0 ? (
                            <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded font-medium">
                              All required areas covered
                            </span>
                          ) : (
                            <span className="text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded font-medium">
                              {kit.coverage.uncovered_requirement_ids.length} required area(s) need more questions
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {rState && (
                      <p className={`mt-1 text-[11px] font-medium ${
                        rState.status === 'running' ? 'text-blue-600' :
                        rState.status === 'complete' ? 'text-emerald-700' :
                        rState.status === 'partial' ? 'text-amber-700' :
                        'text-rose-600'
                      }`}>
                        {rState.message}
                      </p>
                    )}
                    {aState && (
                      <p className={`mt-0.5 text-[11px] font-medium ${
                        aState.status === 'running' ? 'text-blue-600' :
                        aState.status === 'complete' ? 'text-emerald-700' :
                        'text-rose-600'
                      }`}>
                        {aState.message}
                      </p>
                    )}
                    {gState && (
                      <p className={`mt-0.5 text-[11px] font-medium ${
                        gState.status === 'running' ? 'text-blue-600' :
                        gState.status === 'complete' ? 'text-emerald-700' :
                        'text-rose-600'
                      }`}>
                        {gState.message}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleTriggerResearch(kit.id)}
                      disabled={rState?.status === 'running'}
                      className="px-2.5 py-1 text-xs rounded border border-[#E4E4E7] bg-white hover:bg-zinc-50 text-[#18181B] disabled:opacity-50 transition-colors"
                    >
                      {rState?.status === 'running' ? 'Researching...' : '1. Research'}
                    </button>
                    <button
                      onClick={() => handleTriggerAnalysis(kit.id)}
                      disabled={aState?.status === 'running'}
                      className="px-2.5 py-1 text-xs rounded border border-[#E4E4E7] bg-white hover:bg-zinc-50 text-[#18181B] disabled:opacity-50 transition-colors"
                    >
                      {aState?.status === 'running' ? 'Analyzing...' : '2. Analyze'}
                    </button>
                    <button
                      onClick={() => handleTriggerGeneration(kit.id)}
                      disabled={gState?.status === 'running'}
                      className="px-2.5 py-1 text-xs rounded border border-[#E4E4E7] bg-[#18181B] hover:bg-zinc-800 text-white disabled:opacity-50 transition-colors"
                    >
                      {gState?.status === 'running' ? 'Generating...' : '3. Generate Kit'}
                    </button>
                    <Link
                      href={`/kits/${kit.id}`}
                      className="px-2.5 py-1 text-xs rounded border border-zinc-300 bg-white hover:bg-zinc-50 text-[#18181B] font-medium transition-colors"
                    >
                      Builder Mode →
                    </Link>
                    <Link
                      href={`/kits/${kit.id}/practice`}
                      className="px-2.5 py-1 text-xs rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-medium transition-colors"
                    >
                      Practice →
                    </Link>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-100 text-zinc-700 border border-zinc-200">
                      {kit.status}
                    </span>
                    <span className="text-[11px] text-[#A1A1AA]">
                      {new Date(kit.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
