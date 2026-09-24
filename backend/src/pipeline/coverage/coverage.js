import { generateQuestions } from '../generation/questionGeneration.js';

/**
 * Deterministically calculates coverage of requirements by interview questions.
 *
 * Requirements with priority "must" or "should" MUST be covered.
 * Priority "nice" requirements may remain uncovered if unreferenced.
 *
 * @param {Array<Object>} requirements Array of requirement objects ({ id, priority, kind, text })
 * @param {Array<Object>} questions Array of question objects ({ id, requirement_ids, ... })
 * @param {number} [passes=1] Current coverage pass number (1 or 2)
 * @returns {{ uncovered_requirement_ids: string[], covered_requirement_ids: string[], passes: number }}
 */
export function calculateCoverage(requirements = [], questions = [], passes = 1) {
  const reqList = Array.isArray(requirements) ? requirements : [];
  const qList = Array.isArray(questions) ? questions : [];

  // Set of all valid requirement IDs in the role
  const roleReqIdSet = new Set(reqList.map((r) => r.id));

  // Collect all requirement IDs referenced across all questions
  const referencedReqIds = new Set();
  for (const q of qList) {
    if (Array.isArray(q.requirement_ids)) {
      for (const rId of q.requirement_ids) {
        if (roleReqIdSet.has(rId)) {
          referencedReqIds.add(rId);
        }
      }
    }
  }

  const covered_requirement_ids = [];
  const uncovered_requirement_ids = [];

  for (const req of reqList) {
    const isCovered = referencedReqIds.has(req.id);
    if (isCovered) {
      covered_requirement_ids.push(req.id);
    } else {
      // Only "must" and "should" requirements trigger uncovered status.
      // "nice" requirements are optional and can remain uncovered without failing coverage.
      const priority = (req.priority || 'should').toLowerCase();
      if (priority === 'must' || priority === 'should') {
        uncovered_requirement_ids.push(req.id);
      }
    }
  }

  // Ensure deterministic ordering matching the requirements array order
  return {
    uncovered_requirement_ids,
    covered_requirement_ids,
    passes: Math.min(Math.max(Number(passes) || 1, 1), 2)
  };
}

/**
 * Runs the deterministic coverage workflow with up to 2 passes.
 *
 * Pass 1: Evaluate initial questions against requirements.
 * Pass 2: If uncovered must/should requirements exist, generate targeted questions
 *         for specifically those uncovered requirements, merge them with unique sequential IDs,
 *         and recalculate coverage.
 *
 * @param {Object} params
 * @param {Object} params.role Role object with requirements array
 * @param {Object} [params.companyBrief] Company intelligence brief
 * @param {string} [params.jdText] Raw JD text
 * @param {Array<Object>} params.existingQuestions Initial questions from Step 6
 * @param {Object} [params.options] Generation options (provider, timeoutMs)
 * @returns {Promise<{ questions: Array<Object>, coverage: { uncovered_requirement_ids: string[], passes: number } }>}
 */
export async function runCoveragePipeline({
  role,
  companyBrief = {},
  jdText = '',
  existingQuestions = [],
  options = {}
}) {
  const requirements = Array.isArray(role?.requirements) ? role.requirements : [];

  // Pass 1: Check initial coverage
  const pass1 = calculateCoverage(requirements, existingQuestions, 1);

  // If all must/should requirements are already covered, pass 1 is complete!
  if (pass1.uncovered_requirement_ids.length === 0) {
    return {
      questions: existingQuestions,
      coverage: {
        uncovered_requirement_ids: [],
        passes: 1
      }
    };
  }

  // Pass 2: Target specifically the uncovered must/should requirements
  const uncoveredSet = new Set(pass1.uncovered_requirement_ids);
  const targetUncoveredRequirements = requirements.filter((r) => uncoveredSet.has(r.id));

  let secondPassQuestions = [];
  try {
    secondPassQuestions = await generateQuestions({
      role,
      companyBrief,
      jdText,
      targetRequirements: targetUncoveredRequirements,
      startCounter: existingQuestions.length + 1,
      options
    });
  } catch (err) {
    // If second pass generation fails, preserve existing questions and record pass 2 failure
    return {
      questions: existingQuestions,
      coverage: {
        uncovered_requirement_ids: pass1.uncovered_requirement_ids,
        passes: 2
      }
    };
  }

  // Append new questions to existing questions (do NOT replace)
  const combinedQuestions = [...existingQuestions, ...secondPassQuestions];

  // Recalculate coverage deterministically after Pass 2
  const pass2 = calculateCoverage(requirements, combinedQuestions, 2);

  return {
    questions: combinedQuestions,
    coverage: {
      uncovered_requirement_ids: pass2.uncovered_requirement_ids,
      passes: 2
    }
  };
}
