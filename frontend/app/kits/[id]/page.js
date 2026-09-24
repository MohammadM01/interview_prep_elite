'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

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

const REQUIREMENT_KINDS = [
  { value: 'technical', label: 'Technical' },
  { value: 'system_design', label: 'System Design' },
  { value: 'behavioral', label: 'Behavioral' },
  { value: 'domain', label: 'Domain' },
  { value: 'experience', label: 'Experience' },
  { value: 'education', label: 'Education' },
  { value: 'other', label: 'Other' }
];

const PRIORITIES = [
  { value: 'must', label: 'Must Have', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  { value: 'should', label: 'Should Have', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'nice', label: 'Nice to Have', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
];

export default function KitBuilderPage() {
  const { id: kitId } = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [kit, setKit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  // Editable local state
  const [requirements, setRequirements] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [flashcards, setFlashcards] = useState([]);

  // Save / UX status
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [activeTab, setActiveTab] = useState('questions'); // 'questions' | 'flashcards' | 'requirements' | 'schedule'

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
    if (!user) {
      router.push('/');
      return;
    }
    fetchKit();
  }, [user, authLoading, fetchKit, router]);

  // Check for unsaved changes
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
      next[index] = {
        ...currentQ,
        [field]: value,
        state: nextState
      };
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

  function handleToggleQuestionRequirement(qIndex, rId) {
    setQuestions((prev) => {
      const next = [...prev];
      const current = next[qIndex];
      const currentIds = current.requirement_ids || [];
      let newIds;
      if (currentIds.includes(rId)) {
        // Must keep at least 1 requirement linked
        if (currentIds.length <= 1) return prev;
        newIds = currentIds.filter((id) => id !== rId);
      } else {
        newIds = [...currentIds, rId];
      }
      const nextState = current.state === 'pinned' ? 'pinned' : 'edited';
      next[qIndex] = {
        ...current,
        requirement_ids: newIds,
        state: nextState
      };
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
    setQuestions((prev) => prev.filter((_, idx) => idx !== index));
    setSaveSuccess(false);
  }

  function handleAddQuestion() {
    // Generate stable unique ID
    let counter = 1;
    const existingIds = new Set(questions.map((q) => q.id));
    while (existingIds.has(`q_manual_${String(counter).padStart(3, '0')}`)) {
      counter++;
    }
    const newId = `q_manual_${String(counter).padStart(3, '0')}`;

    const defaultReqId = requirements[0]?.id || 'r1';

    const newQuestion = {
      id: newId,
      category: 'technical',
      prompt: 'New interview question prompt...',
      answer_outline: 'Key points and expected technical depth for the answer...',
      difficulty: 2,
      requirement_ids: [defaultReqId],
      state: 'edited'
    };

    setQuestions((prev) => [...prev, newQuestion]);
    setSaveSuccess(false);
  }

  // ==========================================
  // Flashcard Handlers
  // ==========================================
  function handleFlashcardChange(index, field, value) {
    setFlashcards((prev) => {
      const next = [...prev];
      const current = next[index];
      const nextState = current.state === 'pinned' ? 'pinned' : 'edited';
      next[index] = {
        ...current,
        [field]: value,
        state: nextState
      };
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

  function handleToggleFlashcardRequirement(fIndex, rId) {
    setFlashcards((prev) => {
      const next = [...prev];
      const current = next[fIndex];
      const currentIds = current.requirement_ids || [];
      let newIds;
      if (currentIds.includes(rId)) {
        if (currentIds.length <= 1) return prev;
        newIds = currentIds.filter((id) => id !== rId);
      } else {
        newIds = [...currentIds, rId];
      }
      const nextState = current.state === 'pinned' ? 'pinned' : 'edited';
      next[fIndex] = {
        ...current,
        requirement_ids: newIds,
        state: nextState
      };
      return next;
    });
    setSaveSuccess(false);
  }

  function handleMoveFlashcard(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= flashcards.length) return;
    setFlashcards((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
    setSaveSuccess(false);
  }

  function handleDeleteFlashcard(index) {
    setFlashcards((prev) => prev.filter((_, idx) => idx !== index));
    setSaveSuccess(false);
  }

  function handleAddFlashcard() {
    let counter = 1;
    const existingIds = new Set(flashcards.map((f) => f.id));
    while (existingIds.has(`f_manual_${String(counter).padStart(3, '0')}`)) {
      counter++;
    }
    const newId = `f_manual_${String(counter).padStart(3, '0')}`;
    const defaultReqId = requirements[0]?.id || 'r1';

    const newCard = {
      id: newId,
      front: 'Concept or question front...',
      back: 'Detailed explanation or answer back...',
      requirement_ids: [defaultReqId],
      state: 'edited'
    };

    setFlashcards((prev) => [...prev, newCard]);
    setSaveSuccess(false);
  }

  // ==========================================
  // Requirements Handlers
  // ==========================================
  function handleRequirementChange(index, field, value) {
    setRequirements((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
    setSaveSuccess(false);
  }

  function handleAddRequirement() {
    let counter = requirements.length + 1;
    const existingIds = new Set(requirements.map((r) => r.id));
    while (existingIds.has(`r${counter}`)) {
      counter++;
    }
    const newReq = {
      id: `r${counter}`,
      text: 'New role requirement description...',
      kind: 'technical',
      priority: 'should'
    };
    setRequirements((prev) => [...prev, newReq]);
    setSaveSuccess(false);
  }

  function handleDeleteRequirement(index) {
    if (requirements.length <= 1) {
      alert('At least one requirement must remain in the kit');
      return;
    }
    const reqToDelete = requirements[index];
    // Check if any question or flashcard relies solely on this requirement
    const isSoleReq =
      questions.some((q) => (q.requirement_ids || []).length === 1 && q.requirement_ids[0] === reqToDelete.id) ||
      flashcards.some((f) => (f.requirement_ids || []).length === 1 && f.requirement_ids[0] === reqToDelete.id);

    if (isSoleReq) {
      alert(`Cannot delete "${reqToDelete.id}" because some questions or flashcards link only to it. Re-link them first.`);
      return;
    }

    setRequirements((prev) => prev.filter((_, idx) => idx !== index));
    // Prune deleted requirement ID from questions & flashcards
    setQuestions((prev) =>
      prev.map((q) => ({
        ...q,
        requirement_ids: (q.requirement_ids || []).filter((id) => id !== reqToDelete.id)
      }))
    );
    setFlashcards((prev) =>
      prev.map((f) => ({
        ...f,
        requirement_ids: (f.requirement_ids || []).filter((id) => id !== reqToDelete.id)
      }))
    );
    setSaveSuccess(false);
  }

  // ==========================================
  // Save Handler
  // ==========================================
  async function handleSaveChanges() {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const payload = {
        role: {
          requirements
        },
        questions,
        flashcards
      };

      const res = await fetch(`${API_BASE}/api/kits/${kitId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to save changes');
      }

      const updatedKit = data.kit;
      setKit(updatedKit);
      setRequirements(updatedKit.role?.requirements || []);
      setQuestions(updatedKit.questions || []);
      setFlashcards(updatedKit.flashcards || []);

      const snapshot = JSON.stringify({
        reqs: updatedKit.role?.requirements || [],
        qs: updatedKit.questions || [],
        fs: updatedKit.flashcards || []
      });
      setCleanSnapshot(snapshot);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  // ==========================================
  // Render Loading & Error States
  // ==========================================
  if (loading || authLoading) {
    return (
      <main className="min-h-screen bg-[#FAFAF9] text-[#18181B] p-8 md:p-12">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="h-6 w-32 bg-zinc-200 animate-pulse rounded"></div>
          <div className="h-10 w-96 bg-zinc-200 animate-pulse rounded"></div>
          <div className="h-64 bg-white rounded-lg border border-[#E4E4E7] animate-pulse p-6"></div>
        </div>
      </main>
    );
  }

  if (fetchError || !kit) {
    return (
      <main className="min-h-screen bg-[#FAFAF9] text-[#18181B] p-8 md:p-12">
        <div className="max-w-2xl mx-auto p-6 rounded-lg bg-white border border-[#E4E4E7] text-center space-y-4">
          <h2 className="text-base font-semibold text-rose-700">Unable to Load Kit</h2>
          <p className="text-xs text-[#71717A]">{fetchError || 'Interview kit not found.'}</p>
          <Link
            href="/"
            className="inline-block px-4 py-2 text-xs font-medium rounded bg-[#18181B] text-white hover:bg-zinc-800"
          >
            Return to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  const companyBrief = kit.company_brief || {};
  const schedule = kit.schedule;

  return (
    <main className="min-h-screen bg-[#FAFAF9] text-[#18181B] pb-24">
      {/* Top sticky bar */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-[#E4E4E7] px-6 py-3.5 shadow-xs">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-xs font-medium text-[#71717A] hover:text-[#18181B] flex items-center gap-1 transition-colors"
            >
              <span>←</span>
              <span>Back to Kits</span>
            </Link>
            <span className="text-[#E4E4E7]">|</span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold tracking-tight text-[#18181B]">
                  {companyBrief.company || kit.source?.company_url || 'Target Role'} · Builder Mode
                </h1>
                <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-100 text-zinc-700 border border-zinc-200">
                  {kit.role?.title || 'Engineer'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Unsaved indicator */}
            {hasUnsavedChanges ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                Unsaved changes
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-50 text-zinc-500 border border-zinc-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                All changes saved
              </span>
            )}

            <button
              onClick={handleSaveChanges}
              disabled={!hasUnsavedChanges || isSaving}
              className="px-4 py-1.5 text-xs font-medium rounded bg-[#18181B] text-white hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2 shadow-xs"
            >
              {isSaving ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>

            <Link
              href={`/kits/${kitId}/practice`}
              className="px-3 py-1.5 text-xs font-medium rounded border border-[#E4E4E7] bg-white hover:bg-zinc-50 text-[#18181B] transition-colors shadow-xs"
            >
              Practice Mode →
            </Link>
          </div>
        </div>
      </header>

      {/* Save feedback notices */}
      {saveSuccess && (
        <div className="max-w-6xl mx-auto px-6 mt-4">
          <div className="p-3 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold">✓</span>
              <span>All changes saved successfully. Edits and pinned content are safely persisted.</span>
            </div>
            <button
              onClick={() => setSaveSuccess(false)}
              className="text-emerald-700 hover:text-emerald-950 font-medium ml-4"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {saveError && (
        <div className="max-w-6xl mx-auto px-6 mt-4">
          <div className="p-3 rounded-lg bg-rose-50 text-rose-800 border border-rose-200 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold">✕</span>
              <span>Save failed: {saveError}</span>
            </div>
            <button
              onClick={() => setSaveError(null)}
              className="text-rose-700 hover:text-rose-950 font-medium ml-4"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-6 mt-6 space-y-6">
        {/* A. COMPANY BRIEF SECTION */}
        <section className="p-6 rounded-lg bg-white border border-[#E4E4E7] shadow-xs">
          <div className="flex items-center justify-between border-b border-[#E4E4E7] pb-3 mb-4">
            <div>
              <h2 className="text-xs uppercase tracking-wider text-[#71717A] font-semibold">
                Company Brief
              </h2>
              <p className="text-sm font-semibold text-[#18181B] mt-0.5">
                {companyBrief.company || 'Grounded Company Profile'}
              </p>
            </div>
            <span className="px-2 py-0.5 text-[11px] font-medium rounded bg-zinc-100 text-zinc-700 border border-zinc-200">
              Seniority: {companyBrief.seniority || kit.role?.seniority || 'Mid-Senior'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <p className="text-[11px] font-medium text-[#71717A] uppercase tracking-wider mb-1">
                Company Summary
              </p>
              <p className="text-[#18181B] leading-relaxed bg-[#FAFAF9] p-3 rounded border border-[#E4E4E7]">
                {companyBrief.company_summary || 'No company summary available.'}
              </p>
            </div>

            <div>
              <p className="text-[11px] font-medium text-[#71717A] uppercase tracking-wider mb-1">
                What They Do
              </p>
              <p className="text-[#18181B] leading-relaxed bg-[#FAFAF9] p-3 rounded border border-[#E4E4E7]">
                {companyBrief.what_they_do || 'No description available.'}
              </p>
            </div>
          </div>

          {Array.isArray(companyBrief.sources) && companyBrief.sources.length > 0 && (
            <div className="mt-4 pt-3 border-t border-[#E4E4E7]">
              <p className="text-[11px] font-medium text-[#71717A] mb-1.5">
                Verified Research Sources:
              </p>
              <div className="flex flex-wrap gap-2">
                {companyBrief.sources.map((src, idx) => (
                  <a
                    key={idx}
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 bg-blue-50/60 border border-blue-100 px-2 py-0.5 rounded font-mono"
                  >
                    <span>↗</span>
                    <span>{src}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#E4E4E7] gap-6 text-xs font-medium">
          <button
            onClick={() => setActiveTab('questions')}
            className={`pb-3 border-b-2 transition-colors ${
              activeTab === 'questions'
                ? 'border-[#18181B] text-[#18181B]'
                : 'border-transparent text-[#71717A] hover:text-[#18181B]'
            }`}
          >
            Questions ({questions.length})
          </button>
          <button
            onClick={() => setActiveTab('flashcards')}
            className={`pb-3 border-b-2 transition-colors ${
              activeTab === 'flashcards'
                ? 'border-[#18181B] text-[#18181B]'
                : 'border-transparent text-[#71717A] hover:text-[#18181B]'
            }`}
          >
            Flashcards ({flashcards.length})
          </button>
          <button
            onClick={() => setActiveTab('requirements')}
            className={`pb-3 border-b-2 transition-colors ${
              activeTab === 'requirements'
                ? 'border-[#18181B] text-[#18181B]'
                : 'border-transparent text-[#71717A] hover:text-[#18181B]'
            }`}
          >
            Requirements ({requirements.length})
          </button>
          <button
            onClick={() => setActiveTab('schedule')}
            className={`pb-3 border-b-2 transition-colors ${
              activeTab === 'schedule'
                ? 'border-[#18181B] text-[#18181B]'
                : 'border-transparent text-[#71717A] hover:text-[#18181B]'
            }`}
          >
            Study Schedule ({schedule?.days?.length || 0} Days)
          </button>
        </div>

        {/* ==================================================== */}
        {/* C. QUESTIONS TAB */}
        {/* ==================================================== */}
        {activeTab === 'questions' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#18181B]">Interview Questions</h3>
                <p className="text-xs text-[#71717A]">
                  Edit prompts, answer outlines, difficulty, categories, and requirement links. Pinned questions are protected from future regeneration.
                </p>
              </div>
              <button
                onClick={handleAddQuestion}
                className="px-3 py-1.5 text-xs font-medium rounded border border-[#E4E4E7] bg-white hover:bg-zinc-50 text-[#18181B] shadow-xs flex items-center gap-1.5 transition-colors"
              >
                <span>+</span>
                <span>Add Question</span>
              </button>
            </div>

            {questions.length === 0 ? (
              <div className="p-8 text-center bg-white rounded-lg border border-[#E4E4E7]">
                <p className="text-xs text-[#71717A] mb-3">No questions in this kit.</p>
                <button
                  onClick={handleAddQuestion}
                  className="px-3 py-1 text-xs font-medium rounded bg-[#18181B] text-white"
                >
                  Create First Question
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {questions.map((q, idx) => {
                  const isPinned = q.state === 'pinned';
                  const isEdited = q.state === 'edited';

                  return (
                    <div
                      key={q.id || idx}
                      className={`p-5 rounded-lg bg-white border transition-all ${
                        isPinned
                          ? 'border-purple-300 ring-1 ring-purple-100'
                          : isEdited
                          ? 'border-blue-300'
                          : 'border-[#E4E4E7]'
                      } shadow-xs`}
                    >
                      {/* Top Bar for Question Card */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-[#F4F4F5]">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-zinc-100 text-zinc-800 border border-zinc-200">
                            {q.id}
                          </span>
                          <span className="text-xs text-[#71717A]">#{idx + 1}</span>

                          {/* State pill */}
                          {isPinned ? (
                            <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                              <span>📌</span>
                              <span>Pinned</span>
                            </span>
                          ) : isEdited ? (
                            <span className="px-2 py-0.5 text-[11px] font-medium rounded bg-blue-50 text-blue-700 border border-blue-200">
                              Edited
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-[11px] font-medium rounded bg-zinc-100 text-zinc-600 border border-zinc-200">
                              Generated
                            </span>
                          )}
                        </div>

                        {/* Controls: Reorder, Pin, Delete */}
                        <div className="flex items-center gap-2 text-xs">
                          {/* Move Up / Down */}
                          <div className="inline-flex rounded border border-[#E4E4E7] bg-[#FAFAF9] overflow-hidden">
                            <button
                              onClick={() => handleMoveQuestion(idx, -1)}
                              disabled={idx === 0}
                              title="Move Up"
                              className="px-2 py-1 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
                            >
                              ▲
                            </button>
                            <span className="w-px bg-[#E4E4E7]"></span>
                            <button
                              onClick={() => handleMoveQuestion(idx, 1)}
                              disabled={idx === questions.length - 1}
                              title="Move Down"
                              className="px-2 py-1 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
                            >
                              ▼
                            </button>
                          </div>

                          {/* Pin / Unpin Button */}
                          <button
                            onClick={() => handleTogglePinQuestion(idx)}
                            className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                              isPinned
                                ? 'bg-purple-100 text-purple-800 border-purple-300 hover:bg-purple-200'
                                : 'bg-white text-zinc-700 border-[#E4E4E7] hover:bg-zinc-50'
                            }`}
                          >
                            {isPinned ? '📌 Pinned (Keep)' : 'Pin Content'}
                          </button>

                          {/* Delete Question */}
                          <button
                            onClick={() => handleDeleteQuestion(idx)}
                            title="Delete question"
                            className="px-2 py-1 rounded text-xs text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      {/* Question Fields */}
                      <div className="space-y-3 text-xs">
                        {/* Prompt */}
                        <div>
                          <label className="block text-[11px] font-medium text-[#71717A] mb-1">
                            Question Prompt
                          </label>
                          <textarea
                            rows={2}
                            value={q.prompt}
                            onChange={(e) => handleQuestionChange(idx, 'prompt', e.target.value)}
                            className="w-full px-3 py-2 text-xs rounded border border-[#E4E4E7] bg-white text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#18181B]"
                          />
                        </div>

                        {/* Answer Outline */}
                        <div>
                          <label className="block text-[11px] font-medium text-[#71717A] mb-1">
                            Answer Outline
                          </label>
                          <textarea
                            rows={3}
                            value={q.answer_outline}
                            onChange={(e) => handleQuestionChange(idx, 'answer_outline', e.target.value)}
                            className="w-full px-3 py-2 text-xs rounded border border-[#E4E4E7] bg-white text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#18181B]"
                          />
                        </div>

                        {/* Category & Difficulty */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                          <div>
                            <label className="block text-[11px] font-medium text-[#71717A] mb-1">
                              Category
                            </label>
                            <select
                              value={q.category}
                              onChange={(e) => handleQuestionChange(idx, 'category', e.target.value)}
                              className="w-full px-3 py-1.5 text-xs rounded border border-[#E4E4E7] bg-white text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#18181B]"
                            >
                              {CATEGORIES.map((cat) => (
                                <option key={cat.value} value={cat.value}>
                                  {cat.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-[#71717A] mb-1">
                              Difficulty (1: Foundational, 2: Applied, 3: Senior)
                            </label>
                            <div className="flex gap-2">
                              {[1, 2, 3].map((level) => (
                                <button
                                  key={level}
                                  type="button"
                                  onClick={() => handleQuestionChange(idx, 'difficulty', level)}
                                  className={`flex-1 py-1.5 rounded text-xs font-medium border transition-colors ${
                                    q.difficulty === level
                                      ? 'bg-[#18181B] text-white border-[#18181B]'
                                      : 'bg-white text-zinc-700 border-[#E4E4E7] hover:bg-zinc-50'
                                  }`}
                                >
                                  Level {level}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Linked Requirements */}
                        <div className="pt-2 border-t border-[#F4F4F5]">
                          <label className="block text-[11px] font-medium text-[#71717A] mb-1.5">
                            Linked Requirements (click to toggle):
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {requirements.map((r) => {
                              const isLinked = (q.requirement_ids || []).includes(r.id);
                              return (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={() => handleToggleQuestionRequirement(idx, r.id)}
                                  className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors flex items-center gap-1 ${
                                    isLinked
                                      ? 'bg-zinc-900 text-white border-zinc-900'
                                      : 'bg-[#FAFAF9] text-zinc-600 border-[#E4E4E7] hover:bg-zinc-100'
                                  }`}
                                >
                                  <span>{isLinked ? '✓' : '+'}</span>
                                  <span>{r.id}: {r.text.slice(0, 28)}{r.text.length > 28 ? '...' : ''}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* D. FLASHCARDS TAB */}
        {/* ==================================================== */}
        {activeTab === 'flashcards' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#18181B]">Study Flashcards</h3>
                <p className="text-xs text-[#71717A]">
                  Edit front prompt, back answer, requirement links, and pin cards for deterministic retention.
                </p>
              </div>
              <button
                onClick={handleAddFlashcard}
                className="px-3 py-1.5 text-xs font-medium rounded border border-[#E4E4E7] bg-white hover:bg-zinc-50 text-[#18181B] shadow-xs flex items-center gap-1.5 transition-colors"
              >
                <span>+</span>
                <span>Add Flashcard</span>
              </button>
            </div>

            {flashcards.length === 0 ? (
              <div className="p-8 text-center bg-white rounded-lg border border-[#E4E4E7]">
                <p className="text-xs text-[#71717A] mb-3">No flashcards in this kit.</p>
                <button
                  onClick={handleAddFlashcard}
                  className="px-3 py-1 text-xs font-medium rounded bg-[#18181B] text-white"
                >
                  Create First Flashcard
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {flashcards.map((f, idx) => {
                  const isPinned = f.state === 'pinned';
                  const isEdited = f.state === 'edited';

                  return (
                    <div
                      key={f.id || idx}
                      className={`p-5 rounded-lg bg-white border transition-all ${
                        isPinned
                          ? 'border-purple-300 ring-1 ring-purple-100'
                          : isEdited
                          ? 'border-blue-300'
                          : 'border-[#E4E4E7]'
                      } shadow-xs flex flex-col justify-between`}
                    >
                      <div>
                        {/* Header */}
                        <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#F4F4F5]">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-zinc-100 text-zinc-800 border border-zinc-200">
                              {f.id}
                            </span>
                            {isPinned ? (
                              <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                                <span>📌</span>
                                <span>Pinned</span>
                              </span>
                            ) : isEdited ? (
                              <span className="px-2 py-0.5 text-[11px] font-medium rounded bg-blue-50 text-blue-700 border border-blue-200">
                                Edited
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 text-[11px] font-medium rounded bg-zinc-100 text-zinc-600 border border-zinc-200">
                                Generated
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleMoveFlashcard(idx, -1)}
                              disabled={idx === 0}
                              className="px-1.5 py-0.5 text-xs text-zinc-500 hover:text-zinc-900 disabled:opacity-20"
                            >
                              ▲
                            </button>
                            <button
                              onClick={() => handleMoveFlashcard(idx, 1)}
                              disabled={idx === flashcards.length - 1}
                              className="px-1.5 py-0.5 text-xs text-zinc-500 hover:text-zinc-900 disabled:opacity-20"
                            >
                              ▼
                            </button>
                            <button
                              onClick={() => handleTogglePinFlashcard(idx)}
                              className={`px-2 py-0.5 text-[11px] rounded font-medium border ${
                                isPinned
                                  ? 'bg-purple-100 text-purple-800 border-purple-300'
                                  : 'bg-white text-zinc-600 border-[#E4E4E7]'
                              }`}
                            >
                              {isPinned ? 'Pinned' : 'Pin'}
                            </button>
                            <button
                              onClick={() => handleDeleteFlashcard(idx)}
                              className="text-xs text-rose-600 hover:text-rose-800 px-1.5 py-0.5"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        {/* Front & Back */}
                        <div className="space-y-3 text-xs">
                          <div>
                            <label className="block text-[11px] font-medium text-[#71717A] mb-1">
                              Front (Prompt / Term)
                            </label>
                            <textarea
                              rows={2}
                              value={f.front}
                              onChange={(e) => handleFlashcardChange(idx, 'front', e.target.value)}
                              className="w-full px-3 py-2 text-xs rounded border border-[#E4E4E7] bg-white text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#18181B]"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-[#71717A] mb-1">
                              Back (Definition / Answer)
                            </label>
                            <textarea
                              rows={3}
                              value={f.back}
                              onChange={(e) => handleFlashcardChange(idx, 'back', e.target.value)}
                              className="w-full px-3 py-2 text-xs rounded border border-[#E4E4E7] bg-white text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#18181B]"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Linked requirements */}
                      <div className="pt-3 mt-3 border-t border-[#F4F4F5]">
                        <label className="block text-[11px] font-medium text-[#71717A] mb-1">
                          Linked Requirements:
                        </label>
                        <div className="flex flex-wrap gap-1">
                          {requirements.map((r) => {
                            const isLinked = (f.requirement_ids || []).includes(r.id);
                            return (
                              <button
                                key={r.id}
                                type="button"
                                onClick={() => handleToggleFlashcardRequirement(idx, r.id)}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                  isLinked
                                    ? 'bg-zinc-900 text-white border-zinc-900'
                                    : 'bg-[#FAFAF9] text-zinc-500 border-[#E4E4E7]'
                                }`}
                              >
                                {r.id}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* B. REQUIREMENTS TAB */}
        {/* ==================================================== */}
        {activeTab === 'requirements' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#18181B]">Extracted Role Requirements</h3>
                <p className="text-xs text-[#71717A]">
                  Edit requirement description text, domain kind, and priority weighting.
                </p>
              </div>
              <button
                onClick={handleAddRequirement}
                className="px-3 py-1.5 text-xs font-medium rounded border border-[#E4E4E7] bg-white hover:bg-zinc-50 text-[#18181B] shadow-xs flex items-center gap-1.5 transition-colors"
              >
                <span>+</span>
                <span>Add Requirement</span>
              </button>
            </div>

            <div className="space-y-3">
              {requirements.map((req, idx) => (
                <div
                  key={req.id || idx}
                  className="p-4 rounded-lg bg-white border border-[#E4E4E7] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 md:w-32 shrink-0">
                    <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-zinc-100 text-zinc-800 border border-zinc-200">
                      {req.id}
                    </span>
                    <button
                      onClick={() => handleDeleteRequirement(idx)}
                      className="text-xs text-rose-600 hover:text-rose-800"
                    >
                      Delete
                    </button>
                  </div>

                  <div className="flex-1">
                    <input
                      type="text"
                      value={req.text}
                      onChange={(e) => handleRequirementChange(idx, 'text', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded border border-[#E4E4E7] bg-white text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#18181B]"
                    />
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <select
                      value={req.kind}
                      onChange={(e) => handleRequirementChange(idx, 'kind', e.target.value)}
                      className="px-2.5 py-1 text-xs rounded border border-[#E4E4E7] bg-white text-[#18181B]"
                    >
                      {REQUIREMENT_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={req.priority}
                      onChange={(e) => handleRequirementChange(idx, 'priority', e.target.value)}
                      className="px-2.5 py-1 text-xs rounded border border-[#E4E4E7] bg-white text-[#18181B]"
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* E. SCHEDULE TAB (READ ONLY) */}
        {/* ==================================================== */}
        {activeTab === 'schedule' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#18181B]">Study Schedule (Read-Only)</h3>
                <p className="text-xs text-[#71717A]">
                  Deterministic study plan generated according to question priority, difficulty, and timeline. Manual editing is locked in this step.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded text-xs font-medium bg-zinc-100 text-zinc-700 border border-zinc-200">
                Total Days: {schedule?.days?.length || 0}
              </span>
            </div>

            {!schedule || !Array.isArray(schedule.days) || schedule.days.length === 0 ? (
              <div className="p-8 text-center bg-white rounded-lg border border-[#E4E4E7]">
                <p className="text-xs text-[#71717A]">
                  No study schedule has been generated yet for this kit. Run &quot;Generate Kit&quot; from the dashboard.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {schedule.days.map((day) => {
                  const scheduledQuestions = questions.filter((q) =>
                    (day.question_ids || []).includes(q.id)
                  );

                  return (
                    <div
                      key={day.day}
                      className="p-4 rounded-lg bg-white border border-[#E4E4E7] shadow-xs"
                    >
                      <div className="flex items-center justify-between pb-2 mb-3 border-b border-[#F4F4F5]">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-zinc-900 text-white">
                            Day {day.day}
                          </span>
                          <span className="text-xs font-medium text-[#18181B]">{day.focus}</span>
                        </div>
                        <span className="text-xs font-mono text-[#71717A]">
                          {day.minutes} minutes study target
                        </span>
                      </div>

                      {scheduledQuestions.length === 0 ? (
                        <p className="text-[11px] text-[#A1A1AA] italic">
                          No active questions assigned to this day.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {scheduledQuestions.map((sq) => (
                            <div
                              key={sq.id}
                              className="text-xs flex items-center justify-between p-2 rounded bg-[#FAFAF9] border border-[#E4E4E7]"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[11px] font-semibold text-zinc-700">
                                  {sq.id}
                                </span>
                                <span className="text-[#18181B] truncate max-w-lg">
                                  {sq.prompt}
                                </span>
                              </div>
                              <span className="text-[11px] px-2 py-0.5 rounded bg-white border border-[#E4E4E7] text-zinc-600">
                                Level {sq.difficulty}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
