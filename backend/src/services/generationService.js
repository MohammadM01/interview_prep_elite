import {
  executeKitAnalysis,
  executeKitGeneration,
  generateQuestions,
  generateFlashcards,
  validateAndAssignQuestionIds,
  validateAndAssignFlashcardIds
} from '../pipeline/generation/index.js';

/**
 * Generation Service: Coordinates LLM extraction, role analysis, question generation, and flashcard generation.
 */
export async function runKitAnalysis(params) {
  return executeKitAnalysis(params);
}

export async function runKitGeneration(params) {
  return executeKitGeneration(params);
}

export {
  executeKitAnalysis,
  executeKitGeneration,
  generateQuestions,
  generateFlashcards,
  validateAndAssignQuestionIds,
  validateAndAssignFlashcardIds
};
