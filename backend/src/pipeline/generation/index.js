import { ObjectId } from 'mongodb';
import { getDatabase } from '../../config/database.js';
import { extractRequirementsFromJd, normalizeRequirementIds } from './requirementExtraction.js';
import { generateCompanyBrief } from './companyBrief.js';
import { analyzeRole } from './roleAnalysis.js';
import { Step5KitAnalysisSchema } from './schemas.js';
import { GENERATION_STAGES, STAGE_PROGRESS } from './types.js';

export { extractRequirementsFromJd, normalizeRequirementIds } from './requirementExtraction.js';
export { generateCompanyBrief, validateAndFilterSources } from './companyBrief.js';
export { analyzeRole } from './roleAnalysis.js';
export { Step5KitAnalysisSchema } from './schemas.js';
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
