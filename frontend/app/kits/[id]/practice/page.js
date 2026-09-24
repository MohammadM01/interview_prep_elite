'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

function PracticeContent() {
  const { id: kitId } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = searchParams.get('mode') === 'flashcards' ? 'flashcards' : 'questions';

  const { user, loading: authLoading } = useAuth();

  const [mode, setMode] = useState(initialMode); // 'questions' | 'flashcards'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [practiceData, setPracticeData] = useState(null);

  // Practice session state
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
    if (!user) {
      router.push('/');
      return;
    }
    fetchPracticeData();
  }, [user, authLoading, fetchPracticeData, router]);

  // Sync mode with URL search params if changed externally
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

  // Initialize selected values from existing saved state whenever currentItem changes
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

  // Save rating for the current item to backend
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
        // Update local practice map
        setPracticeData((prev) => ({
          ...prev,
          practice: updated.practice,
          stats: updated.stats
        }));
      }
    } catch {
      // Graceful fallback for network issues
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

  const handleRestartSession = async () => {
    await fetchPracticeData();
    setCurrentIndex(0);
    setIsRevealed(false);
    setSessionCompleted(false);
  };

  const handleSwitchMode = (newMode) => {
    setMode(newMode);
    setCurrentIndex(0);
    setIsRevealed(false);
    setSessionCompleted(false);
    router.replace(`/kits/${kitId}/practice${newMode === 'flashcards' ? '?mode=flashcards' : ''}`);
  };

  // Find linked requirement texts
  const linkedRequirements = useMemo(() => {
    if (!currentItem || !Array.isArray(currentItem.requirement_ids)) return [];
    return currentItem.requirement_ids
      .map((rId) => requirements.find((r) => r.id === rId))
      .filter(Boolean);
  }, [currentItem, requirements]);

  // Loading & Error States
  if (loading || authLoading) {
    return (
      <main className="min-h-screen bg-[#FAFAF9] text-[#18181B] p-8 md:p-12">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="h-6 w-36 bg-zinc-200 animate-pulse rounded"></div>
          <div className="h-10 w-80 bg-zinc-200 animate-pulse rounded"></div>
          <div className="h-64 bg-white rounded-lg border border-[#E4E4E7] animate-pulse p-6"></div>
        </div>
      </main>
    );
  }

  if (error || !practiceData) {
    return (
      <main className="min-h-screen bg-[#FAFAF9] text-[#18181B] p-8 md:p-12">
        <div className="max-w-md mx-auto p-6 rounded-lg bg-white border border-[#E4E4E7] text-center space-y-4 shadow-xs">
          <h2 className="text-sm font-semibold text-rose-700">Unable to Start Practice</h2>
          <p className="text-xs text-[#71717A]">{error || 'Interview kit not found.'}</p>
          <Link
            href="/"
            className="inline-block px-4 py-2 text-xs font-medium rounded bg-[#18181B] text-white hover:bg-zinc-800 transition-colors"
          >
            Return to Kits
          </Link>
        </div>
      </main>
    );
  }

  const totalItems = items.length;
  const progressPercent = totalItems > 0 ? Math.round(((currentIndex + (sessionCompleted ? 1 : 0)) / totalItems) * 100) : 0;

  return (
    <main className="min-h-screen bg-[#FAFAF9] text-[#18181B] pb-24">
      {/* Header bar */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-[#E4E4E7] px-6 py-3.5 shadow-xs">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href={`/kits/${kitId}`}
              className="text-xs font-medium text-[#71717A] hover:text-[#18181B] flex items-center gap-1 transition-colors"
            >
              <span>←</span>
              <span>Kit Builder</span>
            </Link>
            <span className="text-[#E4E4E7]">|</span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold tracking-tight text-[#18181B]">
                  {practiceData.company} · Practice Mode
                </h1>
                <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-100 text-zinc-700 border border-zinc-200">
                  {practiceData.role}
                </span>
              </div>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center gap-2 bg-[#FAFAF9] p-1 rounded-lg border border-[#E4E4E7] text-xs font-medium">
            <button
              onClick={() => handleSwitchMode('questions')}
              className={`px-3 py-1 rounded transition-colors ${
                mode === 'questions'
                  ? 'bg-white text-[#18181B] shadow-xs border border-[#E4E4E7]'
                  : 'text-[#71717A] hover:text-[#18181B]'
              }`}
            >
              Questions ({questions.length})
            </button>
            <button
              onClick={() => handleSwitchMode('flashcards')}
              className={`px-3 py-1 rounded transition-colors ${
                mode === 'flashcards'
                  ? 'bg-white text-[#18181B] shadow-xs border border-[#E4E4E7]'
                  : 'text-[#71717A] hover:text-[#18181B]'
              }`}
            >
              Flashcards ({flashcards.length})
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 mt-8 space-y-6">
        {/* Progress Bar & Header Details */}
        <div className="bg-white p-5 rounded-lg border border-[#E4E4E7] shadow-xs">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-semibold text-[#18181B]">
              {mode === 'questions' ? 'Interview Questions Practice' : 'Flashcard Study Deck'}
            </span>
            <span className="font-mono text-[#71717A]">
              {totalItems === 0
                ? '0 items'
                : sessionCompleted
                ? `Completed ${totalItems} of ${totalItems}`
                : `${mode === 'questions' ? 'Question' : 'Card'} ${currentIndex + 1} of ${totalItems}`}
            </span>
          </div>
          <div className="w-full bg-[#FAFAF9] h-2 rounded-full overflow-hidden border border-[#E4E4E7]">
            <div
              className="bg-[#18181B] h-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
          <div className="flex items-center justify-between text-[11px] text-[#A1A1AA] mt-2">
            <span>Deterministic least-confidence review queue</span>
            <span>{isSaving ? 'Saving progress...' : 'Progress saved'}</span>
          </div>
        </div>

        {/* Empty States */}
        {totalItems === 0 ? (
          <div className="p-12 text-center bg-white rounded-lg border border-[#E4E4E7] space-y-4">
            <h3 className="text-sm font-semibold text-[#18181B]">
              No {mode === 'questions' ? 'questions' : 'flashcards'} available to practice
            </h3>
            <p className="text-xs text-[#71717A] max-w-sm mx-auto">
              This kit currently has no {mode === 'questions' ? 'interview questions' : 'flashcards'}. You can add them in Builder Mode or run generation.
            </p>
            <Link
              href={`/kits/${kitId}`}
              className="inline-block px-4 py-2 text-xs font-medium rounded bg-[#18181B] text-white hover:bg-zinc-800"
            >
              Open Builder Mode
            </Link>
          </div>
        ) : sessionCompleted ? (
          /* Session Completed Summary Card */
          <div className="p-8 bg-white rounded-lg border border-[#E4E4E7] shadow-xs space-y-6 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto text-xl font-bold border border-emerald-200">
              ✓
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#18181B]">Practice Session Completed</h2>
              <p className="text-xs text-[#71717A] mt-1">
                You practiced all {totalItems} {mode === 'questions' ? 'questions' : 'flashcards'} in this session.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-lg mx-auto text-xs">
              <div className="p-3 rounded bg-[#FAFAF9] border border-[#E4E4E7]">
                <p className="text-[#71717A] text-[11px]">Total Items</p>
                <p className="text-base font-semibold text-[#18181B] mt-0.5">{totalItems}</p>
              </div>
              <div className="p-3 rounded bg-rose-50/60 border border-rose-100">
                <p className="text-rose-700 text-[11px]">Low Confidence</p>
                <p className="text-base font-semibold text-rose-800 mt-0.5">
                  {Object.values(mode === 'questions' ? practiceMap.questions : practiceMap.flashcards).filter((i) => i.confidence === 'low').length}
                </p>
              </div>
              <div className="p-3 rounded bg-amber-50/60 border border-amber-100">
                <p className="text-amber-700 text-[11px]">Medium Confidence</p>
                <p className="text-base font-semibold text-amber-800 mt-0.5">
                  {Object.values(mode === 'questions' ? practiceMap.questions : practiceMap.flashcards).filter((i) => i.confidence === 'medium').length}
                </p>
              </div>
              <div className="p-3 rounded bg-emerald-50/60 border border-emerald-100">
                <p className="text-emerald-700 text-[11px]">High Confidence</p>
                <p className="text-base font-semibold text-emerald-800 mt-0.5">
                  {Object.values(mode === 'questions' ? practiceMap.questions : practiceMap.flashcards).filter((i) => i.confidence === 'high').length}
                </p>
              </div>
            </div>

            <p className="text-[11px] text-[#71717A]">
              Next session will automatically sort items with lower confidence to the front.
            </p>

            <div className="flex justify-center gap-3 pt-2">
              <button
                onClick={handleRestartSession}
                className="px-4 py-2 text-xs font-medium rounded bg-[#18181B] text-white hover:bg-zinc-800 transition-colors shadow-xs"
              >
                Practice Again (Least Confidence First)
              </button>
              <Link
                href={`/kits/${kitId}`}
                className="px-4 py-2 text-xs font-medium rounded bg-white text-[#18181B] border border-[#E4E4E7] hover:bg-zinc-50 transition-colors"
              >
                Return to Kit
              </Link>
            </div>
          </div>
        ) : (
          /* ==================================================== */
          /* ONE ITEM AT A TIME PRACTICE CARD */
          /* ==================================================== */
          <div className="p-6 md:p-8 rounded-lg bg-white border border-[#E4E4E7] shadow-xs space-y-6">
            {/* Top Badge Info */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#F4F4F5]">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-zinc-100 text-zinc-800 border border-zinc-200">
                  {currentItem.id}
                </span>
                {mode === 'questions' && currentItem.category && (
                  <span className="px-2 py-0.5 text-[11px] font-medium rounded bg-zinc-100 text-zinc-700 capitalize">
                    {currentItem.category.replace('_', ' ')}
                  </span>
                )}
                {mode === 'questions' && currentItem.difficulty && (
                  <span className="px-2 py-0.5 text-[11px] font-medium rounded bg-[#FAFAF9] border border-[#E4E4E7] text-zinc-600">
                    Difficulty Level {currentItem.difficulty}
                  </span>
                )}
              </div>

              {/* Navigation Back / Next shortcuts */}
              <div className="flex items-center gap-1.5 text-xs text-[#71717A]">
                <button
                  onClick={handlePrev}
                  disabled={currentIndex === 0}
                  className="px-2 py-1 rounded border border-[#E4E4E7] hover:bg-zinc-50 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  ← Prev
                </button>
                <button
                  onClick={handleNext}
                  className="px-2 py-1 rounded border border-[#E4E4E7] hover:bg-zinc-50"
                >
                  Next →
                </button>
              </div>
            </div>

            {/* Prompt / Front Area */}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[#71717A] font-semibold mb-2">
                {mode === 'questions' ? 'Interview Question' : 'Flashcard Front'}
              </p>
              <h2 className="text-base md:text-lg font-medium text-[#18181B] leading-relaxed">
                {mode === 'questions' ? currentItem.prompt : currentItem.front}
              </h2>
            </div>

            {/* Linked Requirements */}
            {linkedRequirements.length > 0 && (
              <div className="pt-2">
                <p className="text-[11px] text-[#71717A] font-medium mb-1.5">
                  Requirement(s) Targeted:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {linkedRequirements.map((r) => (
                    <span
                      key={r.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[#FAFAF9] border border-[#E4E4E7] text-zinc-700"
                    >
                      <span className="font-semibold text-zinc-900">{r.id}:</span>
                      <span className="truncate max-w-xs">{r.text}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Reveal Answer Section */}
            {!isRevealed ? (
              <div className="pt-4 border-t border-[#F4F4F5]">
                <button
                  onClick={() => setIsRevealed(true)}
                  className="w-full py-3 text-xs font-semibold rounded-lg bg-[#18181B] text-white hover:bg-zinc-800 transition-colors shadow-xs"
                >
                  Reveal Answer Outline
                </button>
              </div>
            ) : (
              <div className="space-y-6 pt-4 border-t border-[#F4F4F5]">
                {/* Answer Content */}
                <div className="p-4 rounded-lg bg-[#FAFAF9] border border-[#E4E4E7] space-y-2">
                  <p className="text-[11px] uppercase tracking-wider text-[#71717A] font-semibold">
                    {mode === 'questions' ? 'Answer Outline & Key Points' : 'Flashcard Back'}
                  </p>
                  <p className="text-xs text-[#18181B] leading-relaxed whitespace-pre-line font-normal">
                    {mode === 'questions' ? currentItem.answer_outline : currentItem.back}
                  </p>
                </div>

                {/* Rating Controls: Confidence Selection */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-[#18181B]">
                    How confident are you with this answer?
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => handleSelectConfidence('low')}
                      className={`py-2 px-3 rounded-lg text-xs font-medium border transition-colors flex items-center justify-center gap-1.5 ${
                        selectedConfidence === 'low'
                          ? 'bg-rose-50 text-rose-800 border-rose-300 ring-1 ring-rose-200 font-semibold'
                          : 'bg-white text-zinc-700 border-[#E4E4E7] hover:bg-zinc-50'
                      }`}
                    >
                      <span>Low</span>
                      {selectedConfidence === 'low' && <span>✓</span>}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSelectConfidence('medium')}
                      className={`py-2 px-3 rounded-lg text-xs font-medium border transition-colors flex items-center justify-center gap-1.5 ${
                        selectedConfidence === 'medium'
                          ? 'bg-amber-50 text-amber-800 border-amber-300 ring-1 ring-amber-200 font-semibold'
                          : 'bg-white text-zinc-700 border-[#E4E4E7] hover:bg-zinc-50'
                      }`}
                    >
                      <span>Medium</span>
                      {selectedConfidence === 'medium' && <span>✓</span>}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSelectConfidence('high')}
                      className={`py-2 px-3 rounded-lg text-xs font-medium border transition-colors flex items-center justify-center gap-1.5 ${
                        selectedConfidence === 'high'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-1 ring-emerald-200 font-semibold'
                          : 'bg-white text-zinc-700 border-[#E4E4E7] hover:bg-zinc-50'
                      }`}
                    >
                      <span>High</span>
                      {selectedConfidence === 'high' && <span>✓</span>}
                    </button>
                  </div>
                </div>

                {/* Coverage Selection (For Questions Mode) */}
                {mode === 'questions' && (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-[#18181B]">
                      Coverage Status for this requirement:
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => handleSelectCovered(true)}
                        className={`py-2 px-3 rounded-lg text-xs font-medium border transition-colors flex items-center justify-center gap-1.5 ${
                          selectedCovered === true
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-1 ring-emerald-200 font-semibold'
                            : 'bg-white text-zinc-700 border-[#E4E4E7] hover:bg-zinc-50'
                        }`}
                      >
                        <span>Covered</span>
                        {selectedCovered === true && <span>✓</span>}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSelectCovered(false)}
                        className={`py-2 px-3 rounded-lg text-xs font-medium border transition-colors flex items-center justify-center gap-1.5 ${
                          selectedCovered === false
                            ? 'bg-zinc-100 text-zinc-800 border-zinc-300 ring-1 ring-zinc-200 font-semibold'
                            : 'bg-white text-zinc-700 border-[#E4E4E7] hover:bg-zinc-50'
                        }`}
                      >
                        <span>Uncovered</span>
                        {selectedCovered === false && <span>✓</span>}
                      </button>
                    </div>
                  </div>
                )}

                {/* Next Question Button */}
                <div className="pt-2 flex justify-end">
                  <button
                    onClick={handleNext}
                    className="px-6 py-2.5 text-xs font-semibold rounded-lg bg-[#18181B] text-white hover:bg-zinc-800 transition-colors shadow-xs flex items-center gap-2"
                  >
                    <span>{currentIndex + 1 < totalItems ? 'Next Question →' : 'Finish Session →'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function PracticePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center p-8">
          <p className="text-xs text-[#71717A] animate-pulse">Loading Practice Session...</p>
        </div>
      }
    >
      <PracticeContent />
    </Suspense>
  );
}
