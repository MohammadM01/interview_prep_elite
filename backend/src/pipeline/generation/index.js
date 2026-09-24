import { ObjectId } from 'mongodb';
import { getDatabase } from '../../config/database.js';
import { extractRequirementsFromJd, normalizeRequirementIds } from './requirementExtraction.js';
import { generateCompanyBrief } from './companyBrief.js';
import { analyzeRole } from './roleAnalysis.js';
import { generateQuestions, validateAndAssignQuestionIds } from './questionGeneration.js';
import { generateFlashcards, validateAndAssignFlashcardIds } from './flashcardGeneration.js';
import { Step5KitAnalysisSchema, Step6KitSchema, QuestionItemSchema, FlashcardItemSchema } from './schemas.js';
import { GENERATION_STAGES, STAGE_PROGRESS } from './types.js';

export { extractRequirementsFromJd, normalizeRequirementIds } from './requirementExtraction.js';
export { generateCompanyBrief, validateAndFilterSources } from './companyBrief.js';
export { analyzeRole } from './roleAnalysis.js';
export { generateQuestions, validateAndAssignQuestionIds } from './questionGeneration.js';
export { generateFlashcards, validateAndAssignFlashcardIds } from './flashcardGeneration.js';
export { Step5KitAnalysisSchema, Step6KitSchema, QuestionItemSchema, FlashcardItemSchema } from './schemas.js';
export { GENERATION_STAGES, STAGE_PROGRESS } from './types.js';

/**
 * Executes Step 5 extraction and analysis:
 * - Requirements Extraction
 * - Company Brief
 * - Role Analysis
 * Updates job progress and persists intermediate structures to MongoDB kit.
 *
 * @param {Object} params
 * @param {string|ObjectId} params.kitId
 * @param {string|ObjectId} [params.jobId]
 * @param {string|ObjectId} params.userId
 * @param {Object} [params.options]
 * @param {Object} [params.options.provider] Custom provider instance (e.g. mock for tests)
 * @returns {Promise<{ kit: Object, job: Object }>}
 */
export async function executeKitAnalysis({ kitId, jobId, userId, options = {} }) {
  const db = getDatabase();
  const kitObjectId = typeof kitId === 'string' ? new ObjectId(kitId) : kitId;
  const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
  const { provider, timeoutMs } = options;

  // STEP A: Load kit and verify ownership
  const kit = await db.collection('kits').findOne({
    _id: kitObjectId,
    user_id: userObjectId
  });

  if (!kit) {
    const error = new Error('Interview kit not found or unauthorized');
    error.code = 'NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Find linked generation job
  let jobObjectId = null;
  if (jobId) {
    jobObjectId = typeof jobId === 'string' ? new ObjectId(jobId) : jobId;
  } else {
    const foundJob = await db.collection('generation_jobs').findOne({
      kit_id: kitObjectId,
      user_id: userObjectId
    });
    if (foundJob) {
      jobObjectId = foundJob._id;
    }
  }

  // Helper to update job stage & progress deterministically
  const updateJobProgress = async (stage, progress) => {
    if (!jobObjectId) return;
    await db.collection('generation_jobs').updateOne(
      { _id: jobObjectId, user_id: userObjectId },
      {
        $set: {
          status: 'running',
          stage,
          progress,
          updated_at: new Date()
        }
      }
    );
  };

  try {
    // STEP B: Load research_result
    const researchResult = await db.collection('research_results').findOne({
      kit_id: kitObjectId,
      user_id: userObjectId
    });

    const researchPages = researchResult?.pages || [];
    const targetCompanyUrl = kit.input?.company_url || kit.source?.company_url || '';
    const jdText = kit.input?.jd || '';

    // STEP C: Extract JD requirements
    await updateJobProgress(
      GENERATION_STAGES.REQUIREMENTS_EXTRACTION,
      STAGE_PROGRESS[GENERATION_STAGES.REQUIREMENTS_EXTRACTION]
    );

    const rawRequirements = await extractRequirementsFromJd(jdText, { provider, timeoutMs });

    // STEP F: Normalize generated IDs (r1, r2, ...)
    const normalizedRequirements = normalizeRequirementIds(rawRequirements);

    // STEP D: Generate company brief using research
    await updateJobProgress(
      GENERATION_STAGES.COMPANY_BRIEF,
      STAGE_PROGRESS[GENERATION_STAGES.COMPANY_BRIEF]
    );

    const companyBrief = await generateCompanyBrief(researchPages, {
      companyUrl: targetCompanyUrl,
      provider,
      timeoutMs
    });

    // STEP E: Generate role analysis using JD + normalized requirements
    await updateJobProgress(
      GENERATION_STAGES.ROLE_ANALYSIS,
      STAGE_PROGRESS[GENERATION_STAGES.ROLE_ANALYSIS]
    );

    const roleAnalysis = await analyzeRole(jdText, normalizedRequirements, {
      provider,
      timeoutMs
    });

    // STEP G: Validate the complete intermediate structure
    const validatedData = Step5KitAnalysisSchema.parse({
      company_brief: companyBrief,
      role: roleAnalysis
    });

    const now = new Date();

    // STEP H: Persist intermediate structure to kit
    await db.collection('kits').updateOne(
      { _id: kitObjectId, user_id: userObjectId },
      {
        $set: {
          'source.role': validatedData.role.title,
          company_brief: validatedData.company_brief,
          role: validatedData.role,
          questions: kit.questions || [],
          flashcards: kit.flashcards || [],
          schedule: kit.schedule || null,
          coverage: kit.coverage || null,
          updated_at: now
        }
      }
    );

    // Mark job stage as analysis_completed (progress: 75, status remains running)
    await updateJobProgress(
      GENERATION_STAGES.ANALYSIS_COMPLETED,
      STAGE_PROGRESS[GENERATION_STAGES.ANALYSIS_COMPLETED]
    );

    const updatedKit = await db.collection('kits').findOne({ _id: kitObjectId });
    const updatedJob = jobObjectId
      ? await db.collection('generation_jobs').findOne({ _id: jobObjectId })
      : null;

    return {
      kit: {
        id: updatedKit._id.toString(),
        status: updatedKit.status,
        company_brief: updatedKit.company_brief,
        role: updatedKit.role,
        source: updatedKit.source,
        created_at: updatedKit.created_at,
        updated_at: updatedKit.updated_at
      },
      job: updatedJob
        ? {
            id: updatedJob._id.toString(),
            status: updatedJob.status,
            stage: updatedJob.stage,
            progress: updatedJob.progress,
            updated_at: updatedJob.updated_at
          }
        : null
    };
  } catch (error) {
    if (jobObjectId) {
      await db.collection('generation_jobs').updateOne(
        { _id: jobObjectId, user_id: userObjectId },
        {
          $set: {
            status: 'failed',
            stage: 'analysis_failed',
            error: {
              code: error.code || 'LLM_ANALYSIS_FAILED',
              message: error.message
            },
            updated_at: new Date()
          }
        }
      );
    }
    throw error;
  }
}

/**
 * Executes full Step 6 generation pipeline:
 * - Ensures Step 5 analysis exists (runs if missing)
 * - Stage 1: Question Generation (q1, q2...)
 * - Stage 2: Flashcard Generation (f1, f2...)
 * Updates job progress deterministically and persists questions & flashcards to kit.
 *
 * @param {Object} params
 * @param {string|ObjectId} params.kitId
 * @param {string|ObjectId} [params.jobId]
 * @param {string|ObjectId} params.userId
 * @param {Object} [params.options]
 * @returns {Promise<{ kit: Object, job: Object }>}
 */
export async function executeKitGeneration({ kitId, jobId, userId, options = {} }) {
  const db = getDatabase();
  const kitObjectId = typeof kitId === 'string' ? new ObjectId(kitId) : kitId;
  const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
  const { provider, timeoutMs } = options;

  // STEP 1: Verify kit ownership
  let kit = await db.collection('kits').findOne({
    _id: kitObjectId,
    user_id: userObjectId
  });

  if (!kit) {
    const error = new Error('Interview kit not found or unauthorized');
    error.code = 'NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Find linked job
  let jobObjectId = null;
  if (jobId) {
    jobObjectId = typeof jobId === 'string' ? new ObjectId(jobId) : jobId;
  } else {
    const foundJob = await db.collection('generation_jobs').findOne({
      kit_id: kitObjectId,
      user_id: userObjectId
    });
    if (foundJob) {
      jobObjectId = foundJob._id;
    }
  }

  const updateJobProgress = async (stage, progress, extraStatus = 'running') => {
    if (!jobObjectId) return;
    await db.collection('generation_jobs').updateOne(
      { _id: jobObjectId, user_id: userObjectId },
      {
        $set: {
          status: extraStatus,
          stage,
          progress,
          updated_at: new Date()
        }
      }
    );
  };

  // STEP 2: Ensure Step 5 analysis is complete
  if (!kit.role || !kit.role.requirements || kit.role.requirements.length === 0 || !kit.company_brief) {
    const analysisRes = await executeKitAnalysis({ kitId, jobId, userId, options });
    kit = await db.collection('kits').findOne({ _id: kitObjectId });
  }

  const role = kit.role;
  const companyBrief = kit.company_brief;
  const jdText = kit.input?.jd || '';

  let generatedQuestions = kit.questions || [];

  // STEP 3: Question Generation Stage
  try {
    await updateJobProgress(
      GENERATION_STAGES.QUESTION_GENERATION,
      STAGE_PROGRESS[GENERATION_STAGES.QUESTION_GENERATION]
    );

    generatedQuestions = await generateQuestions({
      role,
      companyBrief,
      jdText,
      options: { provider, timeoutMs }
    });

    // Persist intermediate questions immediately so earlier data is preserved
    await db.collection('kits').updateOne(
      { _id: kitObjectId, user_id: userObjectId },
      {
        $set: {
          questions: generatedQuestions,
          updated_at: new Date()
        }
      }
    );
  } catch (err) {
    if (jobObjectId) {
      await db.collection('generation_jobs').updateOne(
        { _id: jobObjectId, user_id: userObjectId },
        {
          $set: {
            status: 'failed',
            stage: 'question_generation_failed',
            error: {
              code: err.code || 'QUESTION_GENERATION_FAILED',
              message: err.message
            },
            updated_at: new Date()
          }
        }
      );
    }
    throw err;
  }

  // STEP 4: Flashcard Generation Stage
  let generatedFlashcards = [];
  try {
    await updateJobProgress(
      GENERATION_STAGES.FLASHCARD_GENERATION,
      STAGE_PROGRESS[GENERATION_STAGES.FLASHCARD_GENERATION]
    );

    generatedFlashcards = await generateFlashcards({
      requirements: role.requirements,
      questions: generatedQuestions,
      companyBrief,
      role,
      options: { provider, timeoutMs }
    });
  } catch (err) {
    if (jobObjectId) {
      await db.collection('generation_jobs').updateOne(
        { _id: jobObjectId, user_id: userObjectId },
        {
          $set: {
            status: 'failed',
            stage: 'flashcard_generation_failed',
            error: {
              code: err.code || 'FLASHCARD_GENERATION_FAILED',
              message: err.message
            },
            updated_at: new Date()
          }
        }
      );
    }
    throw err;
  }

  // STEP 5: Validate and Persist Complete Step 6 Kit
  const validatedStep6 = Step6KitSchema.parse({
    company_brief: companyBrief,
    role,
    questions: generatedQuestions,
    flashcards: generatedFlashcards
  });

  const now = new Date();
  await db.collection('kits').updateOne(
    { _id: kitObjectId, user_id: userObjectId },
    {
      $set: {
        questions: validatedStep6.questions,
        flashcards: validatedStep6.flashcards,
        // Leave schedule and coverage untouched / empty as per Step 6 requirements
        schedule: kit.schedule || null,
        coverage: kit.coverage || null,
        status: 'ready',
        updated_at: now
      }
    }
  );

  // Mark job as completed
  await updateJobProgress(
    GENERATION_STAGES.GENERATION_COMPLETED,
    STAGE_PROGRESS[GENERATION_STAGES.GENERATION_COMPLETED],
    'completed'
  );

  const finalKit = await db.collection('kits').findOne({ _id: kitObjectId });
  const finalJob = jobObjectId
    ? await db.collection('generation_jobs').findOne({ _id: jobObjectId })
    : null;

  return {
    kit: {
      id: finalKit._id.toString(),
      status: finalKit.status,
      source: finalKit.source,
      company_brief: finalKit.company_brief,
      role: finalKit.role,
      questions: finalKit.questions,
      flashcards: finalKit.flashcards,
      schedule: finalKit.schedule,
      coverage: finalKit.coverage,
      created_at: finalKit.created_at,
      updated_at: finalKit.updated_at
    },
    job: finalJob
      ? {
          id: finalJob._id.toString(),
          status: finalJob.status,
          stage: finalJob.stage,
          progress: finalJob.progress,
          updated_at: finalJob.updated_at
        }
      : null
  };
}

