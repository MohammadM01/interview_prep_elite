import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database.js';
import {
  UpdatePracticeInputSchema,
  getNextPracticeOrder,
  getNextFlashcardPracticeOrder
} from '../pipeline/practice/index.js';

/**
 * Retrieves the practice state and deterministically ordered practice queues for an interview kit.
 *
 * @param {string|ObjectId} kitId
 * @param {string|ObjectId} userId
 * @returns {Promise<Object>}
 */
export async function getPracticeState(kitId, userId) {
  const db = getDatabase();
  let kitObjectId;
  let userObjectId;

  try {
    kitObjectId = typeof kitId === 'string' ? new ObjectId(kitId) : kitId;
    userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
  } catch {
    const err = new Error('Interview kit not found');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  // 1. Verify kit existence and ownership
  const kit = await db.collection('kits').findOne({
    _id: kitObjectId,
    user_id: userObjectId
  });

  if (!kit) {
    const err = new Error('Interview kit not found or unauthorized');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  // 2. Fetch practice document from kit_practices
  const practiceDoc = await db.collection('kit_practices').findOne({
    kit_id: kitObjectId,
    user_id: userObjectId
  });

  const practiceQuestionsMap = practiceDoc?.questions || {};
  const practiceFlashcardsMap = practiceDoc?.flashcards || {};

  const rawQuestions = kit.questions || [];
  const rawFlashcards = kit.flashcards || [];
  const requirements = kit.role?.requirements || [];

  // 3. Deterministically order questions (least confidence first)
  const orderedQuestions = getNextPracticeOrder(rawQuestions, practiceQuestionsMap, requirements);

  // 4. Deterministically order flashcards (least confidence first)
  const orderedFlashcards = getNextFlashcardPracticeOrder(rawFlashcards, practiceFlashcardsMap, requirements);

  const practicedQuestionsCount = Object.values(practiceQuestionsMap).filter((q) => q.practiced).length;
  const practicedFlashcardsCount = Object.values(practiceFlashcardsMap).filter((f) => f.practiced).length;

  return {
    kit_id: kitObjectId.toString(),
    company: kit.company_brief?.company || kit.input?.company_url || kit.source?.company_url || 'Target Company',
    role: kit.role?.title || 'Engineer',
    seniority: kit.role?.seniority || kit.company_brief?.seniority || 'Mid-Senior',
    requirements,
    questions: orderedQuestions,
    flashcards: orderedFlashcards,
    practice: {
      questions: practiceQuestionsMap,
      flashcards: practiceFlashcardsMap
    },
    stats: {
      total_questions: rawQuestions.length,
      practiced_questions: practicedQuestionsCount,
      total_flashcards: rawFlashcards.length,
      practiced_flashcards: practicedFlashcardsCount
    }
  };
}

/**
 * Updates practice state for a question or flashcard.
 *
 * @param {string|ObjectId} kitId
 * @param {string|ObjectId} userId
 * @param {Object} updateData
 * @returns {Promise<Object>}
 */
export async function updatePracticeItem(kitId, userId, updateData) {
  const db = getDatabase();
  let kitObjectId;
  let userObjectId;

  try {
    kitObjectId = typeof kitId === 'string' ? new ObjectId(kitId) : kitId;
    userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
  } catch {
    const err = new Error('Interview kit not found');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  // 1. Verify kit existence and ownership
  const kit = await db.collection('kits').findOne({
    _id: kitObjectId,
    user_id: userObjectId
  });

  if (!kit) {
    const err = new Error('Interview kit not found or unauthorized');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  // 2. Validate updateData against Zod schema
  const validation = UpdatePracticeInputSchema.safeParse(updateData);
  if (!validation.success) {
    const message = validation.error.issues
      .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
      .join('; ');
    const err = new Error(`Validation failed: ${message}`);
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    err.issues = validation.error.issues;
    throw err;
  }

  const { question_id, flashcard_id, confidence, covered } = validation.data;
  const now = new Date();

  // 3. Verify target item exists in kit
  if (question_id) {
    const questionExists = (kit.questions || []).some((q) => q.id === question_id);
    if (!questionExists) {
      const err = new Error(`Question "${question_id}" does not exist in this kit`);
      err.status = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const setFields = {
      updated_at: now,
      [`questions.${question_id}.practiced`]: true,
      [`questions.${question_id}.updated_at`]: now
    };

    if (confidence !== undefined) {
      setFields[`questions.${question_id}.confidence`] = confidence;
    }
    if (covered !== undefined) {
      setFields[`questions.${question_id}.covered`] = covered;
    }

    await db.collection('kit_practices').updateOne(
      { kit_id: kitObjectId, user_id: userObjectId },
      {
        $set: setFields,
        $setOnInsert: {
          created_at: now,
          kit_id: kitObjectId,
          user_id: userObjectId
        }
      },
      { upsert: true }
    );
  } else if (flashcard_id) {
    const flashcardExists = (kit.flashcards || []).some((f) => f.id === flashcard_id);
    if (!flashcardExists) {
      const err = new Error(`Flashcard "${flashcard_id}" does not exist in this kit`);
      err.status = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const setFields = {
      updated_at: now,
      [`flashcards.${flashcard_id}.practiced`]: true,
      [`flashcards.${flashcard_id}.updated_at`]: now
    };

    if (confidence !== undefined) {
      setFields[`flashcards.${flashcard_id}.confidence`] = confidence;
    }

    await db.collection('kit_practices').updateOne(
      { kit_id: kitObjectId, user_id: userObjectId },
      {
        $set: setFields,
        $setOnInsert: {
          created_at: now,
          kit_id: kitObjectId,
          user_id: userObjectId
        }
      },
      { upsert: true }
    );
  }

  // 4. Return refreshed practice state
  return getPracticeState(kitId, userId);
}
