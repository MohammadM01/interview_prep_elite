/**
 * Deterministic Practice Ordering Helpers.
 * Pure deterministic algorithms - NO LLM / Gemini involvement.
 *
 * Rules:
 * Priority 1: Least confidence (low: 1, medium: 2, high: 3, never practiced: 4)
 * Priority 2 (Tie-breaker 1): Higher requirement priority (must: 1, should: 2, nice: 3, none: 4)
 * Priority 3 (Tie-breaker 2): Higher difficulty first (Level 3 > Level 2 > Level 1)
 * Priority 4 (Tie-breaker 3): Stable question ID ascending
 */

const CONFIDENCE_RANK = {
  low: 1,
  medium: 2,
  high: 3
};

const REQUIREMENT_PRIORITY_RANK = {
  must: 1,
  should: 2,
  nice: 3
};

/**
 * Returns the highest requirement priority rank among the requirement IDs linked to an item.
 *
 * @param {Array<string>} [requirementIds=[]]
 * @param {Map<string, Object>} reqMap
 * @returns {number} 1 (must) to 4 (none/unspecified)
 */
function getBestRequirementRank(requirementIds = [], reqMap) {
  if (!Array.isArray(requirementIds) || requirementIds.length === 0) {
    return 4;
  }

  let bestRank = 4;
  for (const rId of requirementIds) {
    const req = reqMap.get(rId);
    if (req && req.priority && REQUIREMENT_PRIORITY_RANK[req.priority]) {
      const rank = REQUIREMENT_PRIORITY_RANK[req.priority];
      if (rank < bestRank) {
        bestRank = rank;
      }
    }
  }

  return bestRank;
}

/**
 * Computes deterministic next session practice order for interview questions.
 *
 * @param {Array<Object>} questions
 * @param {Object} [practiceMap={}] Dictionary mapping questionId -> { confidence, covered, practiced }
 * @param {Array<Object>} [requirements=[]]
 * @returns {Array<Object>} Deterministically ordered questions
 */
export function getNextPracticeOrder(questions = [], practiceMap = {}, requirements = []) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return [];
  }

  const reqMap = new Map();
  if (Array.isArray(requirements)) {
    for (const r of requirements) {
      if (r && r.id) {
        reqMap.set(r.id, r);
      }
    }
  }

  const itemsWithSortKeys = questions.map((q) => {
    const practiceEntry = practiceMap[q.id];
    const isPracticed = Boolean(practiceEntry && practiceEntry.practiced);
    const confidence = practiceEntry?.confidence;

    // 1. Confidence rank: low (1), medium (2), high (3), never practiced (4)
    let confRank = 4;
    if (isPracticed && confidence && CONFIDENCE_RANK[confidence]) {
      confRank = CONFIDENCE_RANK[confidence];
    }

    // 2. Requirement priority rank (must: 1, should: 2, nice: 3, other: 4)
    const reqRank = getBestRequirementRank(q.requirement_ids, reqMap);

    // 3. Difficulty (1 to 3). Higher difficulty comes first, so we invert or compare descending
    const difficulty = typeof q.difficulty === 'number' ? q.difficulty : 1;

    // 4. Stable ID
    const id = String(q.id || '');

    return {
      question: q,
      confRank,
      reqRank,
      difficulty,
      id
    };
  });

  itemsWithSortKeys.sort((a, b) => {
    // 1. Least confidence first
    if (a.confRank !== b.confRank) {
      return a.confRank - b.confRank;
    }

    // 2. Higher requirement priority first
    if (a.reqRank !== b.reqRank) {
      return a.reqRank - b.reqRank;
    }

    // 3. Higher difficulty first (e.g. 3 before 2 before 1)
    if (a.difficulty !== b.difficulty) {
      return b.difficulty - a.difficulty;
    }

    // 4. Stable question ID ascending (natural alphanumeric)
    return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
  });

  return itemsWithSortKeys.map((item) => item.question);
}

/**
 * Computes deterministic next session practice order for flashcards.
 *
 * @param {Array<Object>} flashcards
 * @param {Object} [practiceMap={}] Dictionary mapping flashcardId -> { confidence, practiced }
 * @param {Array<Object>} [requirements=[]]
 * @returns {Array<Object>} Deterministically ordered flashcards
 */
export function getNextFlashcardPracticeOrder(flashcards = [], practiceMap = {}, requirements = []) {
  if (!Array.isArray(flashcards) || flashcards.length === 0) {
    return [];
  }

  const reqMap = new Map();
  if (Array.isArray(requirements)) {
    for (const r of requirements) {
      if (r && r.id) {
        reqMap.set(r.id, r);
      }
    }
  }

  const itemsWithSortKeys = flashcards.map((f) => {
    const practiceEntry = practiceMap[f.id];
    const isPracticed = Boolean(practiceEntry && practiceEntry.practiced);
    const confidence = practiceEntry?.confidence;

    let confRank = 4;
    if (isPracticed && confidence && CONFIDENCE_RANK[confidence]) {
      confRank = CONFIDENCE_RANK[confidence];
    }

    const reqRank = getBestRequirementRank(f.requirement_ids, reqMap);
    const id = String(f.id || '');

    return {
      flashcard: f,
      confRank,
      reqRank,
      id
    };
  });

  itemsWithSortKeys.sort((a, b) => {
    if (a.confRank !== b.confRank) {
      return a.confRank - b.confRank;
    }

    if (a.reqRank !== b.reqRank) {
      return a.reqRank - b.reqRank;
    }

    return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
  });

  return itemsWithSortKeys.map((item) => item.flashcard);
}
