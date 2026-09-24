/**
 * Deterministically merges existing user-edited and pinned content with newly generated content.
 * Ensures USER EDITS AND PINNED CONTENT SURVIVE REGENERATION.
 *
 * Rules:
 * - pinned: Content explicitly pinned by the user. MUST ALWAYS be preserved.
 * - edited: Content manually edited by the user. PRESERVED during regeneration.
 * - generated: Normal AI-generated content. Can be refreshed/replaced by new generation.
 *
 * @param {Object} params
 * @param {Array<Object>} [params.existingQuestions=[]]
 * @param {Array<Object>} [params.newQuestions=[]]
 * @param {Array<Object>} [params.existingFlashcards=[]]
 * @param {Array<Object>} [params.newFlashcards=[]]
 * @returns {{ questions: Array<Object>, flashcards: Array<Object> }}
 */
export function mergeGeneratedContent({
  existingQuestions = [],
  newQuestions = [],
  existingFlashcards = [],
  newFlashcards = []
}) {
  // 1. Process Questions
  const preservedQuestions = [];
  const existingPreservedIds = new Set();
  const existingPreservedPrompts = new Set();

  for (const q of existingQuestions) {
    if (q.state === 'pinned' || q.state === 'edited') {
      preservedQuestions.push(q);
      existingPreservedIds.add(q.id);
      if (q.prompt) {
        existingPreservedPrompts.add(q.prompt.trim().toLowerCase());
      }
    }
  }

  // Determine highest existing ID counter to avoid collisions
  let maxQNum = 0;
  for (const q of [...existingQuestions, ...newQuestions]) {
    const match = String(q.id || '').match(/^q(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxQNum) maxQNum = num;
    }
  }

  const mergedQuestions = [...preservedQuestions];

  for (const newQ of newQuestions) {
    const promptClean = (newQ.prompt || '').trim().toLowerCase();
    // Skip if identical prompt is already preserved
    if (existingPreservedPrompts.has(promptClean)) {
      continue;
    }

    let finalId = newQ.id;
    // If ID collides with a preserved question, allocate a fresh sequential ID
    if (existingPreservedIds.has(finalId)) {
      maxQNum++;
      finalId = `q${maxQNum}`;
    }

    existingPreservedIds.add(finalId);
    mergedQuestions.push({
      ...newQ,
      id: finalId,
      state: newQ.state || 'generated'
    });
  }

  // 2. Process Flashcards
  const preservedFlashcards = [];
  const existingPreservedFIds = new Set();
  const existingPreservedFronts = new Set();

  for (const f of existingFlashcards) {
    if (f.state === 'pinned' || f.state === 'edited') {
      preservedFlashcards.push(f);
      existingPreservedFIds.add(f.id);
      if (f.front) {
        existingPreservedFronts.add(f.front.trim().toLowerCase());
      }
    }
  }

  let maxFNum = 0;
  for (const f of [...existingFlashcards, ...newFlashcards]) {
    const match = String(f.id || '').match(/^f(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxFNum) maxFNum = num;
    }
  }

  const mergedFlashcards = [...preservedFlashcards];

  for (const newF of newFlashcards) {
    const frontClean = (newF.front || '').trim().toLowerCase();
    if (existingPreservedFronts.has(frontClean)) {
      continue;
    }

    let finalId = newF.id;
    if (existingPreservedFIds.has(finalId)) {
      maxFNum++;
      finalId = `f${maxFNum}`;
    }

    existingPreservedFIds.add(finalId);
    mergedFlashcards.push({
      ...newF,
      id: finalId,
      state: newF.state || 'generated'
    });
  }

  return {
    questions: mergedQuestions,
    flashcards: mergedFlashcards
  };
}
