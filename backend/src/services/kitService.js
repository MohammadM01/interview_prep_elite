import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database.js';

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
    days_available: k.input?.days_available || 1,
    jd_chars: k.source?.jd_chars || k.input?.jd?.length || 0,
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
