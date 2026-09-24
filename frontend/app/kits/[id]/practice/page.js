'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import AuthScreen from '@/components/AuthScreen';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

function PracticeStage() {
  const { id: kitId } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = searchParams.get('mode') === 'flashcards' ? 'flashcards' : 'questions';

  const { user, loading: authLoading } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [mode, setMode] = useState(initialMode); // 'questions' | 'flashcards'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [practiceData, setPracticeData] = useState(null);

  // Focus mode session state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const [selectedConfidence, setSelectedConfidence] = useState(null);
  const [selectedCovered, setSelectedCovered] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(false);

  // Load practice state and ordered items from backend
  const fetchPracticeData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE}/api/kits/${kitId}/practice`, {
        credentials: 'include'
      });

      if (!res.ok) {
        if (res.status === 401) {
          router.push('/');
          return;
        }
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to load practice session');
      }

      const data = await res.json();
      setPracticeData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [kitId, router]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    fetchPracticeData();
  }, [user, authLoading, fetchPracticeData]);

  // Sync mode with URL search params
  useEffect(() => {
    const urlMode = searchParams.get('mode') === 'flashcards' ? 'flashcards' : 'questions';
    if (urlMode !== mode) {
      setMode(urlMode);
      setCurrentIndex(0);
      setIsRevealed(false);
      setSelectedConfidence(null);
      setSelectedCovered(null);
      setSessionCompleted(false);
    }
  }, [searchParams, mode]);

  const questions = practiceData?.questions || [];
  const flashcards = practiceData?.flashcards || [];
  const practiceMap = practiceData?.practice || { questions: {}, flashcards: {} };
  const requirements = practiceData?.requirements || [];

  const items = mode === 'questions' ? questions : flashcards;
  const currentItem = items[currentIndex] || null;

  // Sync selected state on item change
  useEffect(() => {
    if (!currentItem) return;
    setIsRevealed(false);

    if (mode === 'questions') {
      const saved = practiceMap.questions?.[currentItem.id];
      setSelectedConfidence(saved?.confidence || null);
      setSelectedCovered(saved?.covered !== undefined ? saved.covered : null);
    } else {
      const saved = practiceMap.flashcards?.[currentItem.id];
      setSelectedConfidence(saved?.confidence || null);
      setSelectedCovered(null);
    }
  }, [currentIndex, currentItem, mode, practiceMap]);

  // Save progress
  const saveProgress = async (confidenceVal, coveredVal) => {
    if (!currentItem) return;

    setIsSaving(true);
    try {
      const payload = mode === 'questions'
        ? {
            question_id: currentItem.id,
            ...(confidenceVal ? { confidence: confidenceVal } : {}),
            ...(coveredVal !== null && coveredVal !== undefined ? { covered: coveredVal } : {})
          }
        : {
            flashcard_id: currentItem.id,
            ...(confidenceVal ? { confidence: confidenceVal } : {})
          };

      const res = await fetch(`${API_BASE}/api/kits/${kitId}/practice`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const updated = await res.json();
        setPracticeData((prev) => ({
          ...prev,
          practice: updated.practice,
          stats: updated.stats
        }));
      }
    } catch {
      // Handled silently
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectConfidence = (level) => {
    setSelectedConfidence(level);
    saveProgress(level, selectedCovered);
  };

  const handleSelectCovered = (coveredState) => {
    setSelectedCovered(coveredState);
    saveProgress(selectedConfidence, coveredState);
  };

  const handleNext = () => {
    if (currentIndex + 1 < items.length) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setSessionCompleted(true);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
      setSessionCompleted(false);
    }
  };

  const handleSwitchMode = (newMode) => {
    setMode(newMode);
    setCurrentIndex(0);
    setIsRevealed(false);
    setSessionCompleted(false);
    router.replace(`/kits/${kitId}/practice${newMode === 'flashcards' ? '?mode=flashcards' : ''}`);
  };

  const linkedRequirements = useMemo(() => {
    if (!currentItem || !Array.isArray(currentItem.requirement_ids)) return [];
    return currentItem.requirement_ids
      .map((rId) => requirements.find((r) => r.id === rId))
      .filter(Boolean);
  }, [currentItem, requirements]);

  // 1. ABSOLUTE RULE — AUTHENTICATION GATE
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center text-xs font-mono-num text-[var(--text-muted)] animate-pulse">
        PREPARING FOCUS MODE...
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onSuccess={fetchPracticeData} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center">
        <div className="text-xs font-mono-num text-[var(--text-muted)] animate-pulse">
          LOADING PRACTICE SESSION...
        </div>
      </div>
    );
  }

  if (error || !practiceData) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] p-8 text-center flex items-center justify-center">
        <div className="max-w-md mx-auto p-6 rounded-[8px] border border-[var(--border-light)] bg-[var(--bg-surface)]">
          <h2 className="text-xs font-mono-num font-semibold text-[var(--accent-rose)] mb-2 uppercase">
            SESSION ERROR
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mb-4">{error || 'Kit not found.'}</p>
          <Link
            href={`/kits/${kitId}`}
            className="text-xs font-mono-num uppercase tracking-wider text-[var(--text-main)] underline"
          >
            ← Return to Kit
          </Link>
        </div>
      </div>
    );
  }

  const roleTitle = practiceData.role?.title || 'Target Role';
  const company = practiceData.company_url?.replace(/https?:\/\/(www\.)?/, '').split('/')[0]
    || practiceData.source?.company_url?.replace(/https?:\/\/(www\.)?/, '').split('/')[0]
    || 'Target Company';
  const totalItems = items.length;
  const progressPercent = totalItems > 0 ? Math.round(((currentIndex + 1) / totalItems) * 100) : 0;

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-main)] flex flex-col justify-between">
      {/* ============================================================ */}
      {/* PRACTICE TOP BAR: REDUCED NAVIGATION, FOCUS MODE */}
      {/* ============================================================ */}
      <header className="h-14 border-b border-[var(--border-light)] px-4 sm:px-8 flex items-center justify-between bg-[var(--bg-surface)]">
        <div className="flex items-center gap-3">
          <Link
            href={`/kits/${kitId}`}
            className="text-xs font-mono-num uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-main)] transition-colors flex items-center gap-1.5"
          >
            <span>←</span>
            <span>Exit Practice</span>
          </Link>
          <span className="text-[var(--border-medium)]">·</span>
          <span className="text-xs font-mono-num uppercase tracking-wider text-[var(--text-muted)] truncate max-w-[140px] sm:max-w-xs">
            {company}
          </span>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center gap-1 p-0.5 bg-[var(--bg-subtle)] rounded-[6px] text-xs font-mono-num">
          <button
            onClick={() => handleSwitchMode('questions')}
            className={`px-3 py-1 rounded-[4px] font-medium transition-smooth ${
              mode === 'questions'
                ? 'bg-[var(--bg-surface)] text-[var(--accent-primary)] shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-main)]'
            }`}
          >
            QUESTIONS
          </button>
          <button
            onClick={() => handleSwitchMode('flashcards')}
            className={`px-3 py-1 rounded-[4px] font-medium transition-smooth ${
              mode === 'flashcards'
                ? 'bg-[var(--bg-surface)] text-[var(--accent-primary)] shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-main)]'
            }`}
          >
            FLASHCARDS
          </button>
        </div>

        <button
          onClick={toggleTheme}
          className="text-xs font-mono-num text-[var(--text-muted)] hover:text-[var(--text-main)]"
        >
          {theme === 'dark' ? 'LIGHT' : 'DARK'}
        </button>
      </header>

      {/* ============================================================ */}
      {/* MAIN STAGE: ONE THING AT A TIME */}
      {/* ============================================================ */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-8 py-8 md:py-16 flex flex-col justify-center">
        {sessionCompleted ? (
          /* COMPLETION STATE WITH ONE OBVIOUS NEXT ACTION */
          <div className="py-8 space-y-6 text-center">
            <div className="text-[11px] font-mono-num uppercase tracking-wider text-[var(--accent-emerald)] font-semibold">
              04 / PRACTICE COMPLETE
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-main)]">
              All {totalItems} items reviewed.
            </h1>
            <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
              Your self-ratings are saved. Weak spots with low confidence are automatically prioritized for your next review.
            </p>

            <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
              {mode === 'questions' ? (
                <button
                  onClick={() => handleSwitchMode('flashcards')}
                  className="px-6 py-2.5 text-xs font-mono-num uppercase tracking-wider font-semibold bg-[var(--text-main)] text-[var(--bg-surface)] hover:bg-[var(--accent-primary)] rounded-[6px] transition-smooth cursor-pointer"
                >
                  Continue to Flashcards →
                </button>
              ) : (
                <Link
                  href={`/kits/${kitId}`}
                  className="px-6 py-2.5 text-xs font-mono-num uppercase tracking-wider font-semibold bg-[var(--text-main)] text-[var(--bg-surface)] hover:bg-[var(--accent-primary)] rounded-[6px] transition-smooth"
                >
                  View Preparation Plan →
                </Link>
              )}

              <button
                onClick={() => {
                  setCurrentIndex(0);
                  setIsRevealed(false);
                  setSessionCompleted(false);
                }}
                className="px-5 py-2.5 text-xs font-mono-num uppercase tracking-wider font-semibold border border-[var(--border-light)] hover:border-[var(--text-main)] text-[var(--text-main)] rounded-[6px] transition-smooth bg-[var(--bg-surface)] cursor-pointer"
              >
                Restart Session
              </button>
            </div>
          </div>
        ) : !currentItem ? (
          <div className="py-12 text-center text-xs font-mono-num text-[var(--text-muted)]">
            No items available in this section.
          </div>
        ) : (
          /* ACTIVE ITEM VIEW: QUESTION DOMINATES SCREEN */
          <div className="space-y-8">
            {/* PROGRESS INDICATOR */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono-num text-[var(--text-muted)]">
                <span className="font-semibold text-[var(--accent-primary)]">
                  {mode === 'questions' ? 'QUESTION' : 'FLASHCARD'} {String(currentIndex + 1).padStart(2, '0')} / {String(totalItems).padStart(2, '0')}
                </span>
                <span>{progressPercent}% Complete</span>
              </div>
              <div className="w-full h-1 bg-[var(--border-light)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--accent-primary)] transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* DOMINATING QUESTION PROMPT */}
            <div className="py-6 border-y border-[var(--border-light)] space-y-4">
              <div className="flex items-center gap-3 text-xs font-mono-num text-[var(--text-muted)]">
                {mode === 'questions' ? (
                  <span className="uppercase tracking-wider">
                    {currentItem.category} · LEVEL {currentItem.difficulty}
                  </span>
                ) : (
                  <span className="uppercase tracking-wider">FLASHCARD RECALL</span>
                )}
                <span className="text-[var(--border-medium)]">·</span>
                <span>{currentItem.id}</span>
              </div>

              <h2 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight text-[var(--text-main)] leading-snug">
                {mode === 'questions' ? currentItem.prompt : currentItem.front}
              </h2>

              {/* Linked Requirement Tag */}
              {linkedRequirements.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-2 text-[11px] font-mono-num text-[var(--text-secondary)]">
                  <span className="text-[var(--text-muted)]">SKILL:</span>
                  {linkedRequirements.map((r) => (
                    <span
                      key={r.id}
                      className="px-2 py-0.5 rounded-[4px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)]"
                    >
                      {r.text}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* REVEAL ANSWER */}
            <div className="space-y-4">
              {!isRevealed ? (
                <button
                  onClick={() => setIsRevealed(true)}
                  className="w-full py-4 text-xs font-mono-num uppercase tracking-wider font-semibold border border-dashed border-[var(--border-medium)] hover:border-[var(--text-main)] text-[var(--text-secondary)] hover:text-[var(--text-main)] rounded-[6px] transition-smooth cursor-pointer"
                >
                  Reveal Answer Outline ↓
                </button>
              ) : (
                <div className="p-5 rounded-[8px] bg-[var(--bg-elevated)] border border-[var(--border-light)] space-y-2">
                  <div className="text-[10px] font-mono-num uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                    {mode === 'questions' ? 'Target Answer Outline' : 'Explanation & Principle'}
                  </div>
                  <p className="text-xs sm:text-sm text-[var(--text-main)] leading-relaxed whitespace-pre-wrap">
                    {mode === 'questions' ? currentItem.answer_outline : currentItem.back}
                  </p>
                </div>
              )}
            </div>

            {/* DECISION & CONFIDENCE CONTROLS */}
            <div className="pt-2 border-t border-[var(--border-light)] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                {/* Confidence Level */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-mono-num uppercase tracking-wider text-[var(--text-muted)] font-medium block">
                    Confidence
                  </span>
                  <div className="flex items-center gap-1.5 font-mono-num text-xs">
                    {['low', 'medium', 'high'].map((lvl) => {
                      const active = selectedConfidence === lvl;
                      return (
                        <button
                          key={lvl}
                          onClick={() => handleSelectConfidence(lvl)}
                          className={`px-3 py-1.5 rounded-[6px] uppercase tracking-wider text-[11px] font-semibold transition-smooth cursor-pointer ${
                            active
                              ? lvl === 'low'
                                ? 'bg-rose-500 text-white'
                                : lvl === 'medium'
                                ? 'bg-amber-500 text-white'
                                : 'bg-emerald-600 text-white'
                              : 'bg-[var(--bg-surface)] border border-[var(--border-light)] text-[var(--text-secondary)] hover:text-[var(--text-main)]'
                          }`}
                        >
                          {lvl}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Covered Status */}
                {mode === 'questions' && (
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono-num uppercase tracking-wider text-[var(--text-muted)] font-medium block">
                      Coverage
                    </span>
                    <div className="flex items-center gap-1.5 font-mono-num text-xs">
                      <button
                        onClick={() => handleSelectCovered(true)}
                        className={`px-3 py-1.5 rounded-[6px] text-[11px] font-semibold uppercase tracking-wider transition-smooth cursor-pointer ${
                          selectedCovered === true
                            ? 'bg-[var(--accent-primary)] text-white'
                            : 'bg-[var(--bg-surface)] border border-[var(--border-light)] text-[var(--text-secondary)] hover:text-[var(--text-main)]'
                        }`}
                      >
                        Covered
                      </button>
                      <button
                        onClick={() => handleSelectCovered(false)}
                        className={`px-3 py-1.5 rounded-[6px] text-[11px] font-semibold uppercase tracking-wider transition-smooth cursor-pointer ${
                          selectedCovered === false
                            ? 'bg-[var(--text-main)] text-[var(--bg-surface)]'
                            : 'bg-[var(--bg-surface)] border border-[var(--border-light)] text-[var(--text-secondary)] hover:text-[var(--text-main)]'
                        }`}
                      >
                        Uncovered
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ONE NEXT ACTION */}
              <div className="pt-4 flex items-center justify-between">
                <button
                  onClick={handlePrev}
                  disabled={currentIndex === 0}
                  className="px-4 py-2 text-xs font-mono-num uppercase tracking-wider font-semibold border border-[var(--border-light)] hover:border-[var(--text-main)] text-[var(--text-main)] disabled:opacity-30 rounded-[6px] transition-smooth bg-[var(--bg-surface)] cursor-pointer"
                >
                  ← Prev
                </button>

                <div className="flex items-center gap-2">
                  {isSaving && (
                    <span className="text-[10px] font-mono-num text-[var(--text-muted)] animate-pulse">
                      Saving...
                    </span>
                  )}
                  <button
                    onClick={handleNext}
                    className="px-6 py-2.5 text-xs font-mono-num uppercase tracking-wider font-semibold bg-[var(--text-main)] text-[var(--bg-surface)] hover:bg-[var(--accent-primary)] rounded-[6px] transition-smooth cursor-pointer shadow-sm"
                  >
                    {currentIndex + 1 === totalItems
                      ? (mode === 'questions' ? 'Finish Questions ✓' : 'Finish Cards ✓')
                      : 'Next question →'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-[var(--border-light)] py-4 px-4 sm:px-8 text-center text-xs font-mono-num text-[var(--text-muted)]">
        INTERVIEW PREPARATION ELITE · FOCUS PRACTICE MODE
      </footer>
    </div>
  );
}

export default function PracticePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center text-xs font-mono-num text-[var(--text-muted)]">
          INITIALIZING...
        </div>
      }
    >
      <PracticeStage />
    </Suspense>
  );
}
