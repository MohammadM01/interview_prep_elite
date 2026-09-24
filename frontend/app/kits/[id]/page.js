'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import TopContextBar from '@/components/TopContextBar';
import AuthScreen from '@/components/AuthScreen';
import PipelineTracker from '@/components/PipelineTracker';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

const CATEGORIES = [
  { value: 'technical', label: 'Technical' },
  { value: 'behavioral', label: 'Behavioral' },
  { value: 'system_design', label: 'System Design' },
  { value: 'coding', label: 'Coding' },
  { value: 'role_specific', label: 'Role Specific' },
  { value: 'domain', label: 'Domain' },
  { value: 'company', label: 'Company' },
  { value: 'experience', label: 'Experience' }
];

export default function KitWorkspacePage() {
  const { id: kitId } = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [kit, setKit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  // Contextual Tabs: 'overview' | 'builder' | 'schedule'
  const [activeTab, setActiveTab] = useState('overview');

  // Builder sub-tabs: 'questions' | 'flashcards' | 'requirements'
  const [builderSubTab, setBuilderSubTab] = useState('questions');

  // Editable local state
  const [requirements, setRequirements] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [flashcards, setFlashcards] = useState([]);

  // Question currently open in inline edit mode
  const [editingQuestionId, setEditingQuestionId] = useState(null);

  // Save / UX status
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Active job & retry state
  const [activeJob, setActiveJob] = useState(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState(null);

  // Snapshot of clean data to detect unsaved changes
  const [cleanSnapshot, setCleanSnapshot] = useState('');

  const fetchKit = useCallback(async () => {
    try {
      setLoading(true);
      setFetchError(null);
      const res = await fetch(`${API_BASE}/api/kits/${kitId}`, {
        credentials: 'include'
      });

      if (!res.ok) {
        if (res.status === 401) {
          router.push('/');
          return;
        }
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to load interview kit');
      }

      const data = await res.json();
      const currentKit = data.kit;
      setKit(currentKit);
      if (data.job || currentKit.job) {
        setActiveJob(data.job || currentKit.job);
      }

      const reqs = currentKit.role?.requirements || [];
      const qs = currentKit.questions || [];
      const fs = currentKit.flashcards || [];

      setRequirements(reqs);
      setQuestions(qs);
      setFlashcards(fs);

      const snapshot = JSON.stringify({ reqs, qs, fs });
      setCleanSnapshot(snapshot);
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setLoading(false);
    }
  }, [kitId, router]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    fetchKit();
  }, [user, authLoading, fetchKit]);

  // Poll generation job during retry or when job is actively running
  useEffect(() => {
    if (!isRetrying && activeJob?.status !== 'running') return;
    const jobId = activeJob?._id || activeJob?.id || kit?.job?.id || kit?.job?._id;
    if (!jobId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/generation-jobs/${jobId}`, {
          credentials: 'include'
        });
        if (res.ok) {
          const data = await res.json();
          const job = data.job;
          setActiveJob(job);

          if (job?.status === 'completed') {
            setIsRetrying(false);
            fetchKit();
          } else if (job?.status === 'failed') {
            setIsRetrying(false);
            setRetryError(job.error?.message || 'Generation pipeline failed');
          }
        }
      } catch {
        // Polling network error
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isRetrying, activeJob?.status, activeJob?.id, activeJob?._id, kit?.job, fetchKit]);

  // Retry Generation Handler
  async function handleRetryGeneration() {
    if (isRetrying) return;
    setIsRetrying(true);
    setRetryError(null);

    try {
      // Optimistically show running tracker
      setActiveJob((prev) => ({
        ...(prev || kit?.job || {}),
        status: 'running',
        stage: 'research',
        progress: 10
      }));

      // Stage 1: Start
      const res1 = await fetch(`${API_BASE}/api/kits/${kitId}/generate/start`, {
        method: 'POST',
        credentials: 'include'
      });
      const data1 = await res1.json();
      if (!res1.ok) {
        if (res1.status === 409) {
          if (data1.job) setActiveJob(data1.job);
          return;
        }
        throw new Error(data1.error?.message || 'Failed at Stage 1 (Research & Extraction)');
      }
      if (data1.job) setActiveJob(data1.job);

      // Stage 2: Content
      const res2 = await fetch(`${API_BASE}/api/kits/${kitId}/generate/content`, {
        method: 'POST',
        credentials: 'include'
      });
      const data2 = await res2.json();
      if (!res2.ok) {
        throw new Error(data2.error?.message || 'Failed at Stage 2 (Questions & Flashcards)');
      }
      if (data2.job) setActiveJob(data2.job);

      // Stage 3: Finalize
      const res3 = await fetch(`${API_BASE}/api/kits/${kitId}/generate/finalize`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res3.json();
      if (!res3.ok) {
        throw new Error(data.error?.message || 'Failed at Stage 3 (Coverage & Schedule)');
      }

      if (data.job) {
        setActiveJob(data.job);
      }

      if (data.kit) {
        setKit(data.kit);
        const reqs = data.kit.role?.requirements || [];
        const qs = data.kit.questions || [];
        const fs = data.kit.flashcards || [];
        setRequirements(reqs);
        setQuestions(qs);
        setFlashcards(fs);
        setCleanSnapshot(JSON.stringify({ reqs, qs, fs }));
      }

      setIsRetrying(false);
      await fetchKit();
    } catch (err) {
      setRetryError(err.message || 'Unable to retry kit generation');
      setIsRetrying(false);
    }
  }

  // Unsaved changes detector
  const currentSnapshot = useMemo(() => {
    return JSON.stringify({
      reqs: requirements,
      qs: questions,
      fs: flashcards
    });
  }, [requirements, questions, flashcards]);

  const hasUnsavedChanges = useMemo(() => {
    return cleanSnapshot !== '' && currentSnapshot !== cleanSnapshot;
  }, [cleanSnapshot, currentSnapshot]);

  // ==========================================
  // Question Handlers
  // ==========================================
  function handleQuestionChange(index, field, value) {
    setQuestions((prev) => {
      const next = [...prev];
      const currentQ = next[index];
      const nextState = currentQ.state === 'pinned' ? 'pinned' : 'edited';
      next[index] = { ...currentQ, [field]: value, state: nextState };
      return next;
    });
    setSaveSuccess(false);
  }

  function handleTogglePinQuestion(index) {
    setQuestions((prev) => {
      const next = [...prev];
      const current = next[index];
      const newState = current.state === 'pinned' ? 'edited' : 'pinned';
      next[index] = { ...current, state: newState };
      return next;
    });
    setSaveSuccess(false);
  }

  function handleMoveQuestion(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= questions.length) return;
    setQuestions((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
    setSaveSuccess(false);
  }

  function handleDeleteQuestion(index) {
    if (questions.length <= 1) {
      alert('A kit must retain at least one interview question.');
      return;
    }
    setQuestions((prev) => prev.filter((_, idx) => idx !== index));
    setSaveSuccess(false);
  }

  function handleAddQuestion() {
    const nextNum = questions.length + 1;
    const firstReqId = requirements[0]?.id || 'r1';
    const newQuestion = {
      id: `q${Date.now().toString().slice(-4)}`,
      requirement_ids: [firstReqId],
      category: 'technical',
      prompt: `New custom question ${nextNum}`,
      answer_outline: 'Outline your structured answer here.',
      difficulty: 2,
      state: 'edited'
    };
    setQuestions((prev) => [...prev, newQuestion]);
    setEditingQuestionId(newQuestion.id);
    setSaveSuccess(false);
  }

  // ==========================================
  // Flashcard Handlers
  // ==========================================
  function handleFlashcardChange(index, field, value) {
    setFlashcards((prev) => {
      const next = [...prev];
      const currentF = next[index];
      const nextState = currentF.state === 'pinned' ? 'pinned' : 'edited';
      next[index] = { ...currentF, [field]: value, state: nextState };
      return next;
    });
    setSaveSuccess(false);
  }

  function handleTogglePinFlashcard(index) {
    setFlashcards((prev) => {
      const next = [...prev];
      const current = next[index];
      const newState = current.state === 'pinned' ? 'edited' : 'pinned';
      next[index] = { ...current, state: newState };
      return next;
    });
    setSaveSuccess(false);
  }

  function handleDeleteFlashcard(index) {
    setFlashcards((prev) => prev.filter((_, idx) => idx !== index));
    setSaveSuccess(false);
  }

  function handleAddFlashcard() {
    const nextNum = flashcards.length + 1;
    const firstReqId = requirements[0]?.id || 'r1';
    const newCard = {
      id: `f${Date.now().toString().slice(-4)}`,
      front: `Concept or term ${nextNum}`,
      back: 'Definition or core principle explanation.',
      requirement_ids: [firstReqId],
      state: 'edited'
    };
    setFlashcards((prev) => [...prev, newCard]);
    setSaveSuccess(false);
  }

  // ==========================================
  // Save Handler
  // ==========================================
  async function handleSave() {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const payload = {
        role: { ...kit.role, requirements },
        questions,
        flashcards
      };

      const res = await fetch(`${API_BASE}/api/kits/${kitId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to update kit');
      }

      setKit(data.kit);
      const reqs = data.kit.role?.requirements || [];
      const qs = data.kit.questions || [];
      const fs = data.kit.flashcards || [];

      setRequirements(reqs);
      setQuestions(qs);
      setFlashcards(fs);

      const snapshot = JSON.stringify({ reqs, qs, fs });
      setCleanSnapshot(snapshot);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  // 1. ABSOLUTE RULE — AUTHENTICATION GATE
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center text-xs font-mono-num text-[var(--text-muted)] animate-pulse">
        LOADING WORKSPACE...
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onSuccess={fetchKit} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center">
        <div className="text-xs font-mono-num text-[var(--text-muted)] animate-pulse">
          INITIALIZING PREPARATION SYSTEM...
        </div>
      </div>
    );
  }

  if (fetchError || !kit) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] p-8 text-center flex items-center justify-center">
        <div className="max-w-md mx-auto p-6 rounded-[8px] border border-[var(--border-light)] bg-[var(--bg-surface)]">
          <h2 className="text-xs font-mono-num font-semibold text-[var(--accent-rose)] mb-2 uppercase">
            WORKSPACE ERROR
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mb-4">{fetchError || 'Kit not found'}</p>
          <Link
            href="/"
            className="text-xs font-mono-num uppercase tracking-wider text-[var(--text-main)] underline"
          >
            ← Return to Workspace
          </Link>
        </div>
      </div>
    );
  }

  const company = kit.source?.company_url?.replace(/https?:\/\/(www\.)?/, '').split('/')[0]
    || kit.company_url?.replace(/https?:\/\/(www\.)?/, '').split('/')[0]
    || kit.input?.company_url?.replace(/https?:\/\/(www\.)?/, '').split('/')[0]
    || 'Target Organization';
  const roleTitle = kit.role?.title || kit.role_title || 'Target Role';
  const coverage = kit.coverage || {};
  const coveragePct = coverage.coverage_percentage !== undefined ? coverage.coverage_percentage : 100;
  const schedule = kit.schedule || { days: [] };
  const daysCount = schedule.days?.length || kit.input?.days_available || 5;

  // Breakdown of requirements by priority
  const mustReqs = requirements.filter((r) => r.priority === 'must');
  const shouldReqs = requirements.filter((r) => r.priority === 'should');
  const niceReqs = requirements.filter((r) => r.priority === 'nice');

  const coveredSet = new Set();
  for (const q of questions) {
    for (const rId of q.requirement_ids || []) {
      coveredSet.add(rId);
    }
  }

  const coveredMust = mustReqs.filter((r) => coveredSet.has(r.id)).length;
  const coveredShould = shouldReqs.filter((r) => coveredSet.has(r.id)).length;
  const coveredNice = niceReqs.filter((r) => coveredSet.has(r.id)).length;

  const isIncomplete = useMemo(() => {
    if (!kit) return false;
    const hasReqs = Array.isArray(kit.role?.requirements) && kit.role.requirements.length > 0;
    const hasQuestions = Array.isArray(kit.questions) && kit.questions.length > 0;
    const hasFlashcards = Array.isArray(kit.flashcards) && kit.flashcards.length > 0;
    const hasCoverage = Boolean(kit.coverage);
    const hasSchedule = Boolean(kit.schedule?.days?.length);
    const isJobFailed = kit.job?.status === 'failed' || activeJob?.status === 'failed';

    return !hasReqs || !hasQuestions || !hasFlashcards || !hasCoverage || !hasSchedule || isJobFailed || kit.status === 'failed' || kit.status === 'queued';
  }, [kit, activeJob]);

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-main)] flex flex-col justify-between">
      {/* MINIMAL TOP CONTEXT BAR (NO SIDEBAR) */}
      <TopContextBar />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-8 py-8 md:py-12">
        {/* ============================================================ */}
        {/* INCOMPLETE / FAILED GENERATION OR RETRY IN PROGRESS VIEW */}
        {/* ============================================================ */}
        {isIncomplete ? (
          isRetrying || activeJob?.status === 'running' ? (
            <div className="max-w-2xl mx-auto py-8 space-y-8">
              <div>
                <div className="text-[11px] font-mono-num uppercase tracking-wider text-[var(--accent-primary)] font-semibold mb-1">
                  GENERATION IN PROGRESS
                </div>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-main)]">
                  Building your interview preparation.
                </h1>
                <p className="text-xs text-[var(--text-secondary)] mt-1.5">
                  Researching the role and constructing your targeted interview system.
                </p>
              </div>

              <PipelineTracker
                currentStage={activeJob?.stage || 'queued'}
                error={activeJob?.status === 'failed' ? (activeJob.error?.message || retryError) : retryError}
                onRetry={handleRetryGeneration}
              />
            </div>
          ) : (
            <div className="max-w-xl mx-auto py-12 space-y-6 text-center">
              <div className="space-y-2">
                <div className="text-[11px] font-mono-num uppercase tracking-wider text-[var(--accent-rose)] font-semibold">
                  GENERATION INCOMPLETE
                </div>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-main)]">
                  Generation failed or incomplete
                </h1>
                <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
                  Your preparation kit was not fully generated.
                </p>
              </div>

              {(retryError || activeJob?.error?.message || kit.job?.error?.message) && (
                <div className="p-3 text-xs font-mono-num text-[var(--accent-rose)] border border-[var(--accent-rose)]/40 bg-rose-500/10 rounded-[6px] max-w-md mx-auto">
                  {retryError || activeJob?.error?.message || kit.job?.error?.message}
                </div>
              )}

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  onClick={handleRetryGeneration}
                  disabled={isRetrying}
                  className="w-full sm:w-auto px-8 py-3 text-xs font-mono-num font-semibold uppercase tracking-wider bg-[var(--text-main)] text-[var(--bg-surface)] hover:bg-[var(--accent-primary)] disabled:opacity-50 rounded-[6px] transition-smooth cursor-pointer"
                >
                  {isRetrying ? 'Starting generation...' : 'Retry generation →'}
                </button>
                <Link
                  href="/"
                  className="text-xs font-mono-num uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-main)] underline"
                >
                  ← Back to workspace
                </Link>
              </div>
            </div>
          )
        ) : (
          <>
            {/* ============================================================ */}
            {/* COMPACT CONTEXT HEADER (REPLACES SIDEBAR) */}
            {/* ============================================================ */}
            <div className="pb-6 border-b border-[var(--border-light)] flex flex-col md:flex-row md:items-end justify-between gap-6">

          <div className="space-y-1">
            <div className="flex items-center gap-2.5 text-xs font-mono-num text-[var(--text-muted)]">
              <span className="uppercase tracking-wider font-semibold text-[var(--accent-primary)]">
                {company}
              </span>
              <span>·</span>
              <span className="uppercase tracking-wider">PREPARATION KIT</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-main)]">
              {roleTitle}
            </h1>

            <div className="flex flex-wrap items-center gap-3 text-xs font-mono-num text-[var(--text-secondary)] pt-0.5">
              <span className="text-[var(--accent-emerald)] font-medium">
                {coveragePct}% Requirement Coverage
              </span>
              <span className="text-[var(--border-medium)]">·</span>
              <span>{daysCount}-Day Plan</span>
              <span className="text-[var(--border-medium)]">·</span>
              <span>{questions.length} Questions</span>
              <span className="text-[var(--border-medium)]">·</span>
              <span>{flashcards.length} Cards</span>
            </div>
          </div>

          {/* Quick Practice Link */}
          <div className="shrink-0">
            <Link
              href={`/kits/${kitId}/practice?mode=questions`}
              className="px-5 py-2.5 text-xs font-mono-num uppercase tracking-wider font-semibold bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white rounded-[6px] transition-smooth inline-flex items-center gap-2"
            >
              <span>Practice Mode →</span>
            </Link>
          </div>
        </div>

        {/* ============================================================ */}
        {/* CONTEXTUAL HORIZONTAL NAVIGATION (UNDER HEADER) */}
        {/* ============================================================ */}
        <div className="border-b border-[var(--border-light)] flex items-center gap-8 overflow-x-auto text-xs font-mono-num pt-4">
          {[
            { id: 'overview', num: '01', label: 'OVERVIEW' },
            { id: 'builder', num: '02', label: 'BUILDER', count: questions.length },
            { id: 'schedule', num: '03', label: 'SCHEDULE', count: daysCount }
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pb-3 font-medium tracking-wider flex items-center gap-2 border-b-2 whitespace-nowrap transition-smooth cursor-pointer ${
                  active
                    ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-main)]'
                }`}
              >
                <span className="text-[10px] text-[var(--text-muted)]">{tab.num}</span>
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-[4px] bg-[var(--bg-subtle)] text-[var(--text-muted)]">
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ============================================================ */}
        {/* STAGE 1: FIRST KIT REVIEW / EDITORIAL OVERVIEW */}
        {/* ============================================================ */}
        {activeTab === 'overview' && (
          <div className="py-8 space-y-12">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
              {/* LEFT COLUMN: Role Brief & Extracted Requirements */}
              <div className="md:col-span-7 space-y-8">
                {/* Company & Role Brief */}
                <div className="space-y-3">
                  <div className="text-[10px] font-mono-num uppercase tracking-wider text-[var(--accent-primary)] font-semibold">
                    01 / VERIFIED COMPANY BRIEF
                  </div>
                  <h2 className="text-lg font-semibold text-[var(--text-main)]">
                    About {company}
                  </h2>
                  <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
                    {kit.company_brief?.summary || 'Leading organization in technology and engineering services.'}
                  </p>
                  {kit.company_brief?.what_they_do && (
                    <p className="text-xs text-[var(--text-muted)] leading-relaxed pt-1">
                      {kit.company_brief.what_they_do}
                    </p>
                  )}
                </div>

                {/* Requirements Breakdown */}
                <div className="pt-6 border-t border-[var(--border-light)] space-y-4">
                  <div className="text-[10px] font-mono-num uppercase tracking-wider text-[var(--accent-primary)] font-semibold">
                    02 / EXTRACTED ROLE REQUIREMENTS ({requirements.length})
                  </div>
                  <div className="space-y-2.5">
                    {requirements.slice(0, 6).map((r) => {
                      const isCovered = coveredSet.has(r.id);
                      return (
                        <div
                          key={r.id}
                          className="py-2 flex items-start justify-between gap-3 text-xs border-b border-[var(--border-subtle)] last:border-none"
                        >
                          <div className="space-y-0.5">
                            <span className="font-mono-num text-[11px] font-semibold text-[var(--text-main)] mr-2">
                              {r.id}
                            </span>
                            <span className="text-[var(--text-secondary)]">{r.text}</span>
                          </div>
                          <span
                            className={`text-[10px] font-mono-num uppercase font-semibold shrink-0 ${
                              isCovered ? 'text-[var(--accent-emerald)]' : 'text-[var(--text-muted)]'
                            }`}
                          >
                            {isCovered ? '✓ Covered' : '○ Pending'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: Preparation Summary & Obvious Next Action */}
              <div className="md:col-span-5 space-y-8 p-6 rounded-[8px] border border-[var(--border-light)] bg-[var(--bg-elevated)]/60">
                <div className="space-y-2">
                  <div className="text-[10px] font-mono-num uppercase tracking-wider text-[var(--accent-primary)] font-semibold">
                    PREPARATION SUMMARY
                  </div>
                  <h3 className="text-xl font-semibold text-[var(--text-main)]">
                    Targeted Prep System
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    All generated questions and flashcards are strictly grounded in your target job requirements.
                  </p>
                </div>

                {/* Coverage Bars */}
                <div className="space-y-3 font-mono-num text-xs pt-2">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--accent-rose)] font-semibold">MUST HAVE</span>
                      <span>{coveredMust} / {mustReqs.length}</span>
                    </div>
                    <div className="h-1 bg-[var(--border-light)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent-rose)]"
                        style={{ width: `${mustReqs.length ? (coveredMust / mustReqs.length) * 100 : 100}%` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--accent-amber)] font-semibold">SHOULD HAVE</span>
                      <span>{coveredShould} / {shouldReqs.length}</span>
                    </div>
                    <div className="h-1 bg-[var(--border-light)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent-amber)]"
                        style={{ width: `${shouldReqs.length ? (coveredShould / shouldReqs.length) * 100 : 100}%` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--accent-emerald)] font-semibold">NICE TO HAVE</span>
                      <span>{coveredNice} / {niceReqs.length}</span>
                    </div>
                    <div className="h-1 bg-[var(--border-light)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent-emerald)]"
                        style={{ width: `${niceReqs.length ? (coveredNice / niceReqs.length) * 100 : 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* ONE OBVIOUS NEXT ACTION */}
                <div className="pt-4 space-y-3">
                  <button
                    onClick={() => setActiveTab('builder')}
                    className="w-full py-3 text-xs font-mono-num font-semibold uppercase tracking-wider bg-[var(--text-main)] text-[var(--bg-surface)] hover:bg-[var(--accent-primary)] rounded-[6px] transition-smooth cursor-pointer text-center block"
                  >
                    Start building your kit →
                  </button>

                  <Link
                    href={`/kits/${kitId}/practice?mode=questions`}
                    className="w-full py-2.5 text-xs font-mono-num uppercase tracking-wider font-semibold border border-[var(--border-light)] hover:border-[var(--text-main)] text-[var(--text-main)] rounded-[6px] transition-smooth bg-[var(--bg-surface)] text-center block"
                  >
                    Jump directly to practice
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* STAGE 2: BUILDER MODE */}
        {/* ============================================================ */}
        {activeTab === 'builder' && (
          <div className="py-8 space-y-8">
            {/* Builder Sub-navigation & Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border-light)]">
              <div className="flex items-center gap-4 text-xs font-mono-num">
                {['questions', 'flashcards', 'requirements'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setBuilderSubTab(st)}
                    className={`uppercase font-medium tracking-wider transition-colors ${
                      builderSubTab === st
                        ? 'text-[var(--accent-primary)] font-semibold underline'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>

              {/* Save changes control */}
              <div className="flex items-center gap-3">
                {hasUnsavedChanges && (
                  <span className="text-[11px] font-mono-num text-[var(--accent-amber)] animate-pulse">
                    Unsaved edits
                  </span>
                )}

                <button
                  onClick={handleSave}
                  disabled={isSaving || !hasUnsavedChanges}
                  className="px-4 py-2 text-xs font-mono-num uppercase tracking-wider font-semibold border border-[var(--border-light)] hover:border-[var(--text-main)] text-[var(--text-main)] disabled:opacity-40 rounded-[6px] transition-smooth bg-[var(--bg-surface)] cursor-pointer"
                >
                  {isSaving ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </div>

            {saveSuccess && (
              <div className="p-3 text-xs font-mono-num text-[var(--accent-emerald)] bg-emerald-500/10 border border-[var(--accent-emerald)]/30 rounded-[6px]">
                ✓ All changes saved successfully.
              </div>
            )}
            {saveError && (
              <div className="p-3 text-xs font-mono-num text-[var(--accent-rose)] bg-rose-500/10 border border-[var(--accent-rose)]/30 rounded-[6px]">
                ✕ {saveError}
              </div>
            )}

            {/* Questions Tab */}
            {builderSubTab === 'questions' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-mono-num uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                    QUESTIONS LIST ({questions.length})
                  </h3>
                  <button
                    onClick={handleAddQuestion}
                    className="text-xs font-mono-num text-[var(--accent-primary)] hover:underline"
                  >
                    + Add Question
                  </button>
                </div>

                <div className="divide-y divide-[var(--border-light)] border-y border-[var(--border-light)]">
                  {questions.map((q, idx) => {
                    const isEditing = editingQuestionId === q.id;
                    const isPinned = q.state === 'pinned';

                    return (
                      <div key={q.id} className="py-6 space-y-3">
                        <div className="flex items-center justify-between text-xs font-mono-num">
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-[var(--accent-primary)]">
                              {String(idx + 1).padStart(2, '0')}
                            </span>
                            <span className="uppercase text-[var(--text-muted)]">
                              {q.category} · LEVEL {q.difficulty}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px]">
                            {isPinned && (
                              <span className="text-[var(--accent-primary)] font-medium">★ PINNED</span>
                            )}
                            <span className="text-[var(--text-muted)]">{q.id}</span>
                          </div>
                        </div>

                        {isEditing ? (
                          <div className="space-y-3 pt-1">
                            <textarea
                              rows={3}
                              value={q.prompt}
                              onChange={(e) => handleQuestionChange(idx, 'prompt', e.target.value)}
                              className="w-full p-2.5 text-xs rounded-[6px] border border-[var(--border-light)] bg-[var(--bg-surface)] text-[var(--text-main)]"
                            />
                            <textarea
                              rows={3}
                              value={q.answer_outline}
                              onChange={(e) => handleQuestionChange(idx, 'answer_outline', e.target.value)}
                              className="w-full p-2.5 text-xs rounded-[6px] border border-[var(--border-light)] bg-[var(--bg-surface)] text-[var(--text-main)]"
                            />
                            <div className="flex justify-end">
                              <button
                                onClick={() => setEditingQuestionId(null)}
                                className="px-3 py-1 text-xs font-mono-num bg-[var(--text-main)] text-[var(--bg-surface)] rounded-[4px]"
                              >
                                Done
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <h4 className="text-base font-semibold text-[var(--text-main)] leading-snug">
                              {q.prompt}
                            </h4>
                            <div className="p-3 rounded-[6px] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] leading-relaxed">
                              {q.answer_outline}
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-1 text-xs font-mono-num">
                          <div className="flex items-center gap-4">
                            <button
                              onClick={() => setEditingQuestionId(isEditing ? null : q.id)}
                              className="text-[var(--text-secondary)] hover:text-[var(--text-main)] underline"
                            >
                              {isEditing ? 'Close' : 'Edit'}
                            </button>
                            <button
                              onClick={() => handleTogglePinQuestion(idx)}
                              className={isPinned ? 'text-[var(--accent-primary)] font-semibold' : 'text-[var(--text-secondary)]'}
                            >
                              {isPinned ? '★ Pinned' : '☆ Pin'}
                            </button>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleMoveQuestion(idx, -1)}
                              disabled={idx === 0}
                              className="text-[var(--text-secondary)] disabled:opacity-30"
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => handleMoveQuestion(idx, 1)}
                              disabled={idx === questions.length - 1}
                              className="text-[var(--text-secondary)] disabled:opacity-30"
                            >
                              ↓
                            </button>
                            <button
                              onClick={() => handleDeleteQuestion(idx)}
                              className="text-[var(--accent-rose)] hover:underline ml-2"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* OBVIOUS NEXT ACTION IN BUILDER */}
                <div className="pt-6 flex items-center justify-between border-t border-[var(--border-light)]">
                  <span className="text-xs font-mono-num text-[var(--text-muted)]">
                    Ready to practice what you customized?
                  </span>
                  <Link
                    href={`/kits/${kitId}/practice?mode=questions`}
                    className="px-6 py-2.5 text-xs font-mono-num font-semibold uppercase tracking-wider bg-[var(--text-main)] text-[var(--bg-surface)] hover:bg-[var(--accent-primary)] rounded-[6px] transition-smooth"
                  >
                    Continue to practice →
                  </Link>
                </div>
              </div>
            )}

            {/* Flashcards Tab */}
            {builderSubTab === 'flashcards' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-mono-num uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                    FLASHCARDS ({flashcards.length})
                  </h3>
                  <button
                    onClick={handleAddFlashcard}
                    className="text-xs font-mono-num text-[var(--accent-primary)] hover:underline"
                  >
                    + Add Card
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {flashcards.map((f, idx) => (
                    <div
                      key={f.id}
                      className="p-4 rounded-[6px] border border-[var(--border-light)] bg-[var(--bg-surface)] space-y-3"
                    >
                      <div className="text-[10px] font-mono-num text-[var(--text-muted)] flex justify-between">
                        <span>{f.id}</span>
                        <button
                          onClick={() => handleTogglePinFlashcard(idx)}
                          className={f.state === 'pinned' ? 'text-[var(--accent-primary)]' : ''}
                        >
                          {f.state === 'pinned' ? '★ Pinned' : '☆ Pin'}
                        </button>
                      </div>
                      <p className="text-xs font-semibold text-[var(--text-main)]">{f.front}</p>
                      <p className="text-xs text-[var(--text-secondary)] pt-1 border-t border-[var(--border-subtle)]">
                        {f.back}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="pt-6 flex justify-end">
                  <Link
                    href={`/kits/${kitId}/practice?mode=flashcards`}
                    className="px-6 py-2.5 text-xs font-mono-num font-semibold uppercase tracking-wider bg-[var(--text-main)] text-[var(--bg-surface)] hover:bg-[var(--accent-primary)] rounded-[6px] transition-smooth"
                  >
                    Practice Flashcards →
                  </Link>
                </div>
              </div>
            )}

            {/* Requirements Tab */}
            {builderSubTab === 'requirements' && (
              <div className="space-y-4">
                <h3 className="text-xs font-mono-num uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                  JOB REQUIREMENTS ({requirements.length})
                </h3>
                <div className="divide-y divide-[var(--border-light)] border-y border-[var(--border-light)]">
                  {requirements.map((r) => (
                    <div key={r.id} className="py-3 flex items-center justify-between gap-4 text-xs font-mono-num">
                      <span className="font-semibold text-[var(--accent-primary)] shrink-0">{r.id}</span>
                      <span className="flex-1 font-sans text-[var(--text-main)]">{r.text}</span>
                      <span className="uppercase text-[var(--text-muted)] shrink-0">{r.priority}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* STAGE 3: SCHEDULE TIMELINE */}
        {/* ============================================================ */}
        {activeTab === 'schedule' && (
          <div className="py-8 space-y-6">
            <div className="pb-4 border-b border-[var(--border-light)] flex items-center justify-between">
              <div>
                <div className="text-[10px] font-mono-num uppercase tracking-wider text-[var(--accent-primary)] font-semibold mb-1">
                  PREPARATION TIMELINE
                </div>
                <h2 className="text-xl font-semibold text-[var(--text-main)]">
                  {daysCount} Days Study Plan
                </h2>
              </div>

              <Link
                href={`/kits/${kitId}/practice?mode=questions`}
                className="px-5 py-2.5 text-xs font-mono-num uppercase tracking-wider font-semibold bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white rounded-[6px] transition-smooth"
              >
                Start Preparation →
              </Link>
            </div>

            {/* Vertical Timeline */}
            <div className="space-y-4 max-w-3xl">
              {schedule.days?.map((day) => {
                const dayQuestions = (day.question_ids || [])
                  .map((qId) => questions.find((q) => q.id === qId))
                  .filter(Boolean);

                return (
                  <div
                    key={day.day}
                    className="p-5 rounded-[6px] border border-[var(--border-light)] bg-[var(--bg-surface)] space-y-2.5"
                  >
                    <div className="flex items-center justify-between text-xs font-mono-num pb-2 border-b border-[var(--border-subtle)]">
                      <div className="flex items-center gap-2.5">
                        <span className="font-semibold text-[var(--accent-primary)]">
                          DAY {String(day.day).padStart(2, '0')}
                        </span>
                        <span className="font-medium uppercase text-[var(--text-main)]">
                          {day.focus}
                        </span>
                      </div>
                      <span className="text-[var(--text-muted)]">{day.minutes} MIN ALLOCATED</span>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      {dayQuestions.map((q) => (
                        <div key={q.id} className="text-xs text-[var(--text-secondary)] flex items-start gap-2">
                          <span className="font-mono-num text-[var(--accent-primary)]">{q.id}:</span>
                          <span className="leading-relaxed">{q.prompt}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>
    )}
  </main>

      <footer className="border-t border-[var(--border-light)] py-4 px-4 sm:px-8 text-center text-xs font-mono-num text-[var(--text-muted)]">
        INTERVIEW PREPARATION ELITE · GUIDED WORKSPACE
      </footer>
    </div>
  );
}
