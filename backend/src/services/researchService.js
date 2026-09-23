import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database.js';
import { executeCompanyResearch } from '../pipeline/research/index.js';
import { ERROR_CODES } from '../pipeline/research/types.js';

/**
 * Executes company research for an existing kit and generation job.
 *
 * @param {Object} params
 * @param {string|ObjectId} params.kitId
 * @param {string|ObjectId} params.jobId
 * @param {string|ObjectId} params.userId
 * @param {Object} [params.options]
 * @returns {Promise<Object>}
 */
export async function researchCompany({ kitId, jobId, userId, options = {} }) {
  const db = getDatabase();
  const kitObjectId = typeof kitId === 'string' ? new ObjectId(kitId) : kitId;
  const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;

  // 1. Validate kit existence and ownership
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

  // 2. Validate and identify generation job
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

  // Update initial job state
  if (jobObjectId) {
    await db.collection('generation_jobs').updateOne(
      { _id: jobObjectId, user_id: userObjectId },
      {
        $set: {
          status: 'running',
          stage: 'research_started',
          progress: 10,
          updated_at: new Date()
        }
      }
    );
  }

  const targetUrl = kit.input?.company_url || kit.source?.company_url;

  try {
    // 3. Run research pipeline
    const researchResult = await executeCompanyResearch(targetUrl, {
      ...options,
      onProgress: async ({ stage, progress }) => {
        if (jobObjectId) {
          await db.collection('generation_jobs').updateOne(
            { _id: jobObjectId },
            {
              $set: {
                stage: `research_${stage}`,
                progress,
                updated_at: new Date()
              }
            }
          );
        }
      }
    });

    const now = new Date();

    // 4. Persist research results in research_results collection
    const researchDoc = {
      kit_id: kitObjectId,
      user_id: userObjectId,
      company_url: targetUrl,
      researched_at: new Date(researchResult.researched_at),
      pages: researchResult.pages,
      pages_used: researchResult.pages_used,
      warnings: researchResult.warnings,
      created_at: now,
      updated_at: now
    };

    const insertResult = await db.collection('research_results').insertOne(researchDoc);
    researchDoc._id = insertResult.insertedId;

    // 5. Update kit source metadata
    await db.collection('kits').updateOne(
      { _id: kitObjectId },
      {
        $set: {
          'source.pages_used': researchResult.pages_used,
          'source.researched_at': researchResult.researched_at,
          updated_at: now
        }
      }
    );

    // 6. Update job status to research_completed (progress: 100 for research phase)
    if (jobObjectId) {
      await db.collection('generation_jobs').updateOne(
        { _id: jobObjectId },
        {
          $set: {
            status: 'running',
            stage: 'research_completed',
            progress: 100,
            updated_at: now
          }
        }
      );
    }

    return {
      id: researchDoc._id.toString(),
      kit_id: kitObjectId.toString(),
      company_url: targetUrl,
      pages_count: researchResult.pages.length,
      pages_used: researchResult.pages_used,
      warnings: researchResult.warnings,
      researched_at: researchResult.researched_at
    };
  } catch (error) {
    const errorCode = error.code || ERROR_CODES.PAGE_FETCH_FAILED;

    if (jobObjectId) {
      await db.collection('generation_jobs').updateOne(
        { _id: jobObjectId },
        {
          $set: {
            status: 'failed',
            stage: 'research_failed',
            error: {
              code: errorCode,
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
 * Retrieves the stored research result for a given kit and user.
 *
 * @param {string|ObjectId} kitId
 * @param {string|ObjectId} userId
 * @returns {Promise<Object|null>}
 */
export async function getResearchByKitId(kitId, userId) {
  const db = getDatabase();
  try {
    const kitObjectId = typeof kitId === 'string' ? new ObjectId(kitId) : kitId;
    const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;

    const result = await db.collection('research_results').findOne({
      kit_id: kitObjectId,
      user_id: userObjectId
    });

    if (!result) return null;

    return {
      id: result._id.toString(),
      kit_id: result.kit_id.toString(),
      company_url: result.company_url,
      researched_at: result.researched_at,
      pages: result.pages,
      pages_used: result.pages_used,
      warnings: result.warnings,
      created_at: result.created_at
    };
  } catch {
    return null;
  }
}
