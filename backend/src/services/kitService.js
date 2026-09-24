import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database.js';
import { KitUpdateInputSchema } from '../pipeline/generation/schemas.js';
import { calculateCoverage } from '../pipeline/coverage/index.js';

export async function createKitAndJob({ userId, jd, companyUrl, daysAvailable }) {
  const db = getDatabase();
  const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
  const now = new Date();

  const kitDoc = {
    user_id: userObjectId,
    source: {
      company: '',
      company_url: companyUrl,
      role: '',
      location: '',
      jd_chars: jd.length,
      researched_at: null,
      pages_used: []
    },
    input: {
      jd: jd,
      company_url: companyUrl,
      days_available: daysAvailable
    },
    status: 'queued',
    created_at: now,
    updated_at: now
  };

  const kitInsertResult = await db.collection('kits').insertOne(kitDoc);
  const kitId = kitInsertResult.insertedId;

  const jobDoc = {
    user_id: userObjectId,
    kit_id: kitId,
    status: 'queued',
    stage: 'created',
    progress: 0,
    error: null,
    created_at: now,
    updated_at: now
  };

  const jobInsertResult = await db.collection('generation_jobs').insertOne(jobDoc);
  const jobId = jobInsertResult.insertedId;

  return {
    kit: {
      id: kitId.toString(),
      status: kitDoc.status,
      created_at: kitDoc.created_at
    },
    job: {
      id: jobId.toString(),
      kit_id: kitId.toString(),
      status: jobDoc.status,
      stage: jobDoc.stage,
      progress: jobDoc.progress
    }
  };
}

export async function getKitsForUser(userId) {
  const db = getDatabase();
  const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;

  const kits = await db
    .collection('kits')
    .find({ user_id: userObjectId })
    .sort({ created_at: -1 })
    .toArray();

  return kits.map((k) => ({
    id: k._id.toString(),
    status: k.status,
    company_url: k.input?.company_url || k.source?.company_url || '',
    role_title: k.role?.title || k.source?.role || '',
    days_available: k.input?.days_available || 1,
    jd_chars: k.source?.jd_chars || k.input?.jd?.length || 0,
    questions_count: k.questions?.length || 0,
    flashcards_count: k.flashcards?.length || 0,
    coverage: k.coverage || null,
    schedule_days_count: k.schedule?.days?.length || 0,
    created_at: k.created_at
  }));
}

export async function getKitById(kitId, userId) {
  const db = getDatabase();
  try {
    const kitObjectId = typeof kitId === 'string' ? new ObjectId(kitId) : kitId;
    const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;

    const kit = await db.collection('kits').findOne({
      _id: kitObjectId,
      user_id: userObjectId
    });

    if (!kit) return null;

    const job = await db.collection('generation_jobs').findOne(
      { kit_id: kitObjectId, user_id: userObjectId },
      { sort: { created_at: -1 } }
    );

    return {
      id: kit._id.toString(),
      user_id: kit.user_id.toString(),
      status: kit.status,
      source: kit.source,
      company_brief: kit.company_brief,
      role: kit.role,
      questions: kit.questions || [],
      flashcards: kit.flashcards || [],
      schedule: kit.schedule || null,
      coverage: kit.coverage || null,
      input: kit.input,
      job: job ? {
        id: job._id.toString(),
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        error: job.error || null,
        updated_at: job.updated_at
      } : null,
      created_at: kit.created_at,
      updated_at: kit.updated_at
    };
  } catch {
    return null;
  }
}

export async function getJobById(jobId, userId) {
  const db = getDatabase();
  try {
    const jobObjectId = typeof jobId === 'string' ? new ObjectId(jobId) : jobId;
    const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;

    const job = await db.collection('generation_jobs').findOne({
      _id: jobObjectId,
      user_id: userObjectId
    });

    if (!job) return null;

    return {
      id: job._id.toString(),
      kit_id: job.kit_id.toString(),
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      error: job.error,
      created_at: job.created_at,
      updated_at: job.updated_at
    };
  } catch {
    return null;
  }
}

/**
 * Updates editable parts of an interview kit (requirements, questions, flashcards).
 * Validates unique IDs, requirement references, and preserves schedule integrity.
 *
 * @param {string|ObjectId} kitId
 * @param {string|ObjectId} userId
 * @param {Object} updateData
 * @returns {Promise<Object>}
 */
export async function updateKit(kitId, userId, updateData) {
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

  // 1. Verify kit existence & ownership
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

  // 2. Validate updateData against KitUpdateInputSchema
  const validation = KitUpdateInputSchema.safeParse(updateData);
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

  const { role: newRole, questions: newQuestions, flashcards: newFlashcards } = validation.data;

  // 3. Determine finalRole
  const finalRole = {
    ...kit.role,
    ...(newRole || {})
  };

  // Validate unique requirement IDs
  const reqMap = new Map();
  if (Array.isArray(finalRole.requirements)) {
    for (const r of finalRole.requirements) {
      if (reqMap.has(r.id)) {
        const err = new Error(`Duplicate requirement ID "${r.id}" is not allowed`);
        err.status = 400;
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
      reqMap.set(r.id, r);
    }
  }

  // 4. Determine finalQuestions
  let finalQuestions = Array.isArray(newQuestions) ? newQuestions : (kit.questions || []);

  // Validate unique question IDs
  const qIdSet = new Set();
  for (const q of finalQuestions) {
    if (qIdSet.has(q.id)) {
      const err = new Error(`Duplicate question ID "${q.id}" is not allowed`);
      err.status = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    qIdSet.add(q.id);

    // Validate that every requirement_id exists in finalRole.requirements
    if (Array.isArray(q.requirement_ids)) {
      for (const rId of q.requirement_ids) {
        if (!reqMap.has(rId)) {
          const err = new Error(`Question "${q.id}" references non-existent requirement ID "${rId}"`);
          err.status = 400;
          err.code = 'VALIDATION_ERROR';
          throw err;
        }
      }
    }
  }

  // 5. Determine finalFlashcards
  let finalFlashcards = Array.isArray(newFlashcards) ? newFlashcards : (kit.flashcards || []);

  // Validate unique flashcard IDs
  const fIdSet = new Set();
  for (const f of finalFlashcards) {
    if (fIdSet.has(f.id)) {
      const err = new Error(`Duplicate flashcard ID "${f.id}" is not allowed`);
      err.status = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    fIdSet.add(f.id);

    // Validate that every requirement_id exists in finalRole.requirements
    if (Array.isArray(f.requirement_ids)) {
      for (const rId of f.requirement_ids) {
        if (!reqMap.has(rId)) {
          const err = new Error(`Flashcard "${f.id}" references non-existent requirement ID "${rId}"`);
          err.status = 400;
          err.code = 'VALIDATION_ERROR';
          throw err;
        }
      }
    }
  }

  // 6. Preserve schedule integrity (strip deleted question IDs from schedule days)
  let updatedSchedule = kit.schedule;
  if (kit.schedule && Array.isArray(kit.schedule.days)) {
    updatedSchedule = {
      ...kit.schedule,
      days: kit.schedule.days.map((day) => ({
        ...day,
        question_ids: (day.question_ids || []).filter((qId) => qIdSet.has(qId))
      }))
    };
  }

  // 7. Recalculate coverage if coverage exists
  let updatedCoverage = kit.coverage;
  if (kit.coverage && Array.isArray(finalRole.requirements)) {
    const covResult = calculateCoverage(finalRole.requirements, finalQuestions, kit.coverage.passes || 1);
    updatedCoverage = {
      uncovered_requirement_ids: covResult.uncovered_requirement_ids,
      passes: kit.coverage.passes || 1
    };
  }

  // 8. Persist to MongoDB
  const now = new Date();
  await db.collection('kits').updateOne(
    { _id: kitObjectId, user_id: userObjectId },
    {
      $set: {
        role: finalRole,
        questions: finalQuestions,
        flashcards: finalFlashcards,
        schedule: updatedSchedule,
        coverage: updatedCoverage,
        updated_at: now
      }
    }
  );

  return getKitById(kitId, userId);
}

