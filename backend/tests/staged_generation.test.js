import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../src/app.js';
import { getDatabase } from '../src/config/database.js';
import { MockLlmProvider } from '../src/providers/mockProvider.js';
import { setDefaultProvider } from '../src/providers/llmProvider.js';

test('Bounded Staged Generation Suite', async (t) => {
  let db;
  let cookieUserA;
  let cookieUserB;
  let userAId;
  let userBId;
  let mockProvider;

  const validJd = `Senior Backend Engineer
Must have 5+ years experience in Node.js and distributed systems.
Should have experience with MongoDB and Redis.
Nice to have Docker and Kubernetes.`;

  t.before(async () => {
    db = getDatabase();

    // Register User A
    const resA = await request(app)
      .post('/api/auth/register')
      .send({ email: `stage_usera_${Date.now()}@example.com`, password: 'Password123!' });
    cookieUserA = resA.headers['set-cookie'];
    userAId = resA.body.user.id;

    // Register User B
    const resB = await request(app)
      .post('/api/auth/register')
      .send({ email: `stage_userb_${Date.now()}@example.com`, password: 'Password123!' });
    cookieUserB = resB.headers['set-cookie'];
    userBId = resB.body.user.id;

    mockProvider = new MockLlmProvider();
    setDefaultProvider(mockProvider);
  });

  // 1. Stage 1: POST /api/kits/:id/generate/start persists research, requirements, company brief, role analysis
  let kitId;
  let jobId;

  await t.test('1. Stage 1 /generate/start runs research + extraction + brief + role analysis and persists state', async () => {
    // Create new kit
    const createRes = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: validJd,
        company_url: 'https://example.com',
        days_available: 7
      });

    assert.equal(createRes.status, 201);
    kitId = createRes.body.kit.id;
    jobId = createRes.body.job.id;

    const startRes = await request(app)
      .post(`/api/kits/${kitId}/generate/start`)
      .set('Cookie', cookieUserA);

    assert.equal(startRes.status, 200);
    assert.equal(startRes.body.status, 'success');
    assert.equal(startRes.body.stage, 'analysis_completed');
    assert.ok(startRes.body.kit.company_brief);
    assert.ok(startRes.body.kit.role?.requirements?.length >= 1);

    // Verify DB persistence of intermediate data
    const kitInDb = await db.collection('kits').findOne({ _id: new ObjectId(kitId) });
    assert.ok(kitInDb.company_brief);
    assert.ok(kitInDb.role?.requirements?.length >= 1);

    const jobInDb = await db.collection('generation_jobs').findOne({ _id: new ObjectId(jobId) });
    assert.equal(jobInDb.status, 'running');
    assert.equal(jobInDb.stage, 'analysis_completed');
    assert.equal(jobInDb.progress, 45);
  });

  // 2. Stage 2 prerequisite check: Calling Stage 2 on an unanalyzed kit fails gracefully
  await t.test('2. Stage 2 /generate/content enforces Stage 1 prerequisites', async () => {
    const freshKitRes = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: validJd,
        company_url: 'https://example.com',
        days_available: 5
      });
    const freshKitId = freshKitRes.body.kit.id;

    const contentRes = await request(app)
      .post(`/api/kits/${freshKitId}/generate/content`)
      .set('Cookie', cookieUserA);

    assert.equal(contentRes.status, 400);
    assert.equal(contentRes.body.error.code, 'STAGE_PREREQUISITE_FAILED');
  });

  // 3. Stage 2: POST /api/kits/:id/generate/content persists questions and flashcards
  await t.test('3. Stage 2 /generate/content generates and persists questions and flashcards', async () => {
    const contentRes = await request(app)
      .post(`/api/kits/${kitId}/generate/content`)
      .set('Cookie', cookieUserA);

    assert.equal(contentRes.status, 200);
    assert.equal(contentRes.body.status, 'success');
    assert.equal(contentRes.body.stage, 'content_completed');
    assert.ok(Array.isArray(contentRes.body.kit.questions) && contentRes.body.kit.questions.length >= 1);
    assert.ok(Array.isArray(contentRes.body.kit.flashcards) && contentRes.body.kit.flashcards.length >= 1);

    // Verify DB persistence
    const kitInDb = await db.collection('kits').findOne({ _id: new ObjectId(kitId) });
    assert.ok(kitInDb.questions?.length >= 1);
    assert.ok(kitInDb.flashcards?.length >= 1);

    const jobInDb = await db.collection('generation_jobs').findOne({ _id: new ObjectId(jobId) });
    assert.equal(jobInDb.status, 'running');
    assert.equal(jobInDb.stage, 'content_completed');
    assert.equal(jobInDb.progress, 80);
  });

  // 4. Stage 3 prerequisite check: Calling Stage 3 on a kit without questions/flashcards fails
  await t.test('4. Stage 3 /generate/finalize enforces Stage 2 prerequisites', async () => {
    const uncontentKitRes = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: validJd,
        company_url: 'https://example.com',
        days_available: 5
      });
    const uncontentKitId = uncontentKitRes.body.kit.id;

    // Run Stage 1 only
    await request(app)
      .post(`/api/kits/${uncontentKitId}/generate/start`)
      .set('Cookie', cookieUserA);

    // Attempt Stage 3 directly without Stage 2
    const finalizeRes = await request(app)
      .post(`/api/kits/${uncontentKitId}/generate/finalize`)
      .set('Cookie', cookieUserA);

    assert.equal(finalizeRes.status, 400);
    assert.equal(finalizeRes.body.error.code, 'STAGE_PREREQUISITE_FAILED');
  });

  // 5. Stage 3: POST /api/kits/:id/generate/finalize completes coverage, schedule, and marks job completed
  await t.test('5. Stage 3 /generate/finalize calculates coverage, builds schedule, and marks job completed', async () => {
    const finalizeRes = await request(app)
      .post(`/api/kits/${kitId}/generate/finalize`)
      .set('Cookie', cookieUserA);

    assert.equal(finalizeRes.status, 200);
    assert.equal(finalizeRes.body.status, 'success');
    assert.equal(finalizeRes.body.stage, 'generation_completed');
    assert.equal(finalizeRes.body.kit.status, 'ready');
    assert.ok(finalizeRes.body.kit.coverage);
    assert.ok(finalizeRes.body.kit.schedule);
    assert.equal(finalizeRes.body.kit.schedule.days.length, 7);

    // Verify DB persistence of completed kit & job
    const kitInDb = await db.collection('kits').findOne({ _id: new ObjectId(kitId) });
    assert.equal(kitInDb.status, 'ready');
    assert.ok(kitInDb.coverage?.uncovered_requirement_ids);
    assert.ok(kitInDb.schedule?.days?.length === 7);

    const jobInDb = await db.collection('generation_jobs').findOne({ _id: new ObjectId(jobId) });
    assert.equal(jobInDb.status, 'completed');
    assert.equal(jobInDb.stage, 'generation_completed');
    assert.equal(jobInDb.progress, 100);
    assert.equal(jobInDb.error, null);
  });

  // 6. Ownership & Multi-tenant isolation across all 3 stage endpoints
  await t.test('6. Ownership checks are strictly enforced on /generate/start, /content, and /finalize', async () => {
    // User B attempting User A's kit
    const resStart = await request(app)
      .post(`/api/kits/${kitId}/generate/start`)
      .set('Cookie', cookieUserB);
    assert.equal(resStart.status, 404);
    assert.equal(resStart.body.error.code, 'NOT_FOUND');

    const resContent = await request(app)
      .post(`/api/kits/${kitId}/generate/content`)
      .set('Cookie', cookieUserB);
    assert.equal(resContent.status, 404);
    assert.equal(resContent.body.error.code, 'NOT_FOUND');

    const resFinalize = await request(app)
      .post(`/api/kits/${kitId}/generate/finalize`)
      .set('Cookie', cookieUserB);
    assert.equal(resFinalize.status, 404);
    assert.equal(resFinalize.body.error.code, 'NOT_FOUND');

    // Unauthenticated requests are rejected
    const unauthStart = await request(app).post(`/api/kits/${kitId}/generate/start`);
    assert.equal(unauthStart.status, 401);

    const unauthQuestions = await request(app).post(`/api/kits/${kitId}/generate/questions`);
    assert.equal(unauthQuestions.status, 401);

    const unauthFlashcards = await request(app).post(`/api/kits/${kitId}/generate/flashcards`);
    assert.equal(unauthFlashcards.status, 401);

    const unauthContent = await request(app).post(`/api/kits/${kitId}/generate/content`);
    assert.equal(unauthContent.status, 401);

    const unauthFinalize = await request(app).post(`/api/kits/${kitId}/generate/finalize`);
    assert.equal(unauthFinalize.status, 401);
  });

  // 7. Split Stage 2: POST /api/kits/:id/generate/questions and POST /api/kits/:id/generate/flashcards
  await t.test('7. Dedicated /generate/questions and /generate/flashcards stages execute and persist independently', async () => {
    // Create new kit for dedicated split stage tests
    const kitRes = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: validJd,
        company_url: 'https://example.com',
        days_available: 6
      });
    const splitKitId = kitRes.body.kit.id;
    const splitJobId = kitRes.body.job.id;

    // A. Verify /generate/questions prerequisite: fails if Stage 1 not completed
    const prereqQRes = await request(app)
      .post(`/api/kits/${splitKitId}/generate/questions`)
      .set('Cookie', cookieUserA);
    assert.equal(prereqQRes.status, 400);
    assert.equal(prereqQRes.body.error.code, 'STAGE_PREREQUISITE_FAILED');

    // Run Stage 1 (/start)
    const s1Res = await request(app)
      .post(`/api/kits/${splitKitId}/generate/start`)
      .set('Cookie', cookieUserA);
    assert.equal(s1Res.status, 200);

    // B. Verify /generate/flashcards prerequisite: fails if questions not generated
    const prereqFRes = await request(app)
      .post(`/api/kits/${splitKitId}/generate/flashcards`)
      .set('Cookie', cookieUserA);
    assert.equal(prereqFRes.status, 400);
    assert.equal(prereqFRes.body.error.code, 'STAGE_PREREQUISITE_FAILED');

    // C. Ownership check on /generate/questions and /generate/flashcards
    const userBQ = await request(app)
      .post(`/api/kits/${splitKitId}/generate/questions`)
      .set('Cookie', cookieUserB);
    assert.equal(userBQ.status, 404);
    assert.equal(userBQ.body.error.code, 'NOT_FOUND');

    const userBF = await request(app)
      .post(`/api/kits/${splitKitId}/generate/flashcards`)
      .set('Cookie', cookieUserB);
    assert.equal(userBF.status, 404);
    assert.equal(userBF.body.error.code, 'NOT_FOUND');

    // D. Run /generate/questions: must generate ONLY questions, NOT flashcards
    const qRes = await request(app)
      .post(`/api/kits/${splitKitId}/generate/questions`)
      .set('Cookie', cookieUserA);
    assert.equal(qRes.status, 200);
    assert.equal(qRes.body.status, 'success');
    assert.equal(qRes.body.stage, 'questions_completed');
    assert.ok(Array.isArray(qRes.body.kit.questions) && qRes.body.kit.questions.length >= 1);
    assert.equal(qRes.body.kit.flashcards.length, 0); // MUST NOT generate flashcards

    // Verify DB persistence of questions only
    const kitAfterQ = await db.collection('kits').findOne({ _id: new ObjectId(splitKitId) });
    assert.ok(kitAfterQ.questions?.length >= 1);
    assert.equal(kitAfterQ.flashcards?.length || 0, 0);

    const jobAfterQ = await db.collection('generation_jobs').findOne({ _id: new ObjectId(splitJobId) });
    assert.equal(jobAfterQ.status, 'running');
    assert.equal(jobAfterQ.stage, 'questions_completed');
    assert.equal(jobAfterQ.progress, 65);

    // E. Run /generate/flashcards: must generate ONLY flashcards, questions untouched
    const fRes = await request(app)
      .post(`/api/kits/${splitKitId}/generate/flashcards`)
      .set('Cookie', cookieUserA);
    assert.equal(fRes.status, 200);
    assert.equal(fRes.body.status, 'success');
    assert.equal(fRes.body.stage, 'flashcards_completed');
    assert.ok(Array.isArray(fRes.body.kit.flashcards) && fRes.body.kit.flashcards.length >= 1);
    assert.equal(fRes.body.kit.questions.length, kitAfterQ.questions.length);

    // Verify DB persistence of flashcards
    const kitAfterF = await db.collection('kits').findOne({ _id: new ObjectId(splitKitId) });
    assert.ok(kitAfterF.flashcards?.length >= 1);
    assert.equal(kitAfterF.questions.length, kitAfterQ.questions.length);

    const jobAfterF = await db.collection('generation_jobs').findOne({ _id: new ObjectId(splitJobId) });
    assert.equal(jobAfterF.status, 'running');
    assert.equal(jobAfterF.stage, 'flashcards_completed');
    assert.equal(jobAfterF.progress, 80);

    // F. Finalize Stage 4
    const finalizeRes = await request(app)
      .post(`/api/kits/${splitKitId}/generate/finalize`)
      .set('Cookie', cookieUserA);
    assert.equal(finalizeRes.status, 200);
    assert.equal(finalizeRes.body.kit.status, 'ready');

    const jobAfterFinal = await db.collection('generation_jobs').findOne({ _id: new ObjectId(splitJobId) });
    assert.equal(jobAfterFinal.status, 'completed');
    assert.equal(jobAfterFinal.progress, 100);
  });

  // 8. Failure handling: Failed stage updates generation_jobs to 'failed' and never leaves it 'running'
  await t.test('8. Stage failures persist status: failed and error details in generation_jobs', async () => {
    const failKitRes = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: validJd,
        company_url: 'https://example.com',
        days_available: 5
      });
    const failKitId = failKitRes.body.kit.id;
    const failJobId = failKitRes.body.job.id;

    // Prerequisite failure updates job or returns 400
    const failRes = await request(app)
      .post(`/api/kits/${failKitId}/generate/questions`)
      .set('Cookie', cookieUserA);
    assert.equal(failRes.status, 400);

    // Test pipeline error handling directly with pipeline function
    const { executeKitGenerationQuestions } = await import('../src/pipeline/generation/index.js');
    await assert.rejects(
      async () => {
        await executeKitGenerationQuestions({
          kitId: failKitId,
          jobId: failJobId,
          userId: userAId,
          options: {
            provider: {
              generateJSON: async () => {
                throw new Error('Simulated upstream LLM network failure');
              }
            }
          }
        });
      },
      (err) => err.code === 'STAGE_PREREQUISITE_FAILED'
    );

    // Now run Stage 1 so prerequisite passes, then test question failure persistence
    await request(app)
      .post(`/api/kits/${failKitId}/generate/start`)
      .set('Cookie', cookieUserA);

    await assert.rejects(
      async () => {
        await executeKitGenerationQuestions({
          kitId: failKitId,
          jobId: failJobId,
          userId: userAId,
          options: {
            provider: {
              generateRaw: async () => {
                throw new Error('Simulated upstream LLM network failure');
              }
            }
          }
        });
      },
      /Simulated upstream LLM network failure/
    );

    const failedJobInDb = await db.collection('generation_jobs').findOne({ _id: new ObjectId(failJobId) });
    assert.equal(failedJobInDb.status, 'failed');
    assert.equal(failedJobInDb.stage, 'question_generation_failed');
    assert.ok(failedJobInDb.error);
    assert.match(failedJobInDb.error.message, /Simulated upstream LLM network failure/);
  });

  // 9. Backward compatibility wrapper: POST /api/kits/:id/generate non-blocking default
  await t.test('9. POST /api/kits/:id/generate acts as non-blocking start wrapper by default', async () => {
    const newKitRes = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: validJd,
        company_url: 'https://example.com',
        days_available: 3
      });
    const newKitId = newKitRes.body.kit.id;

    const res = await request(app)
      .post(`/api/kits/${newKitId}/generate`)
      .set('Cookie', cookieUserA);

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'started');
    assert.equal(res.body.stage, 'analysis_completed');
    assert.ok(res.body.job);
    assert.ok(res.body.kit);
  });

  // 10. End-to-end full staged generation creates valid Appendix A kit via /start -> /questions -> /flashcards -> /finalize
  await t.test('10. Full sequential 4-stage generation (/start -> /questions -> /flashcards -> /finalize) produces a valid Appendix A kit', async () => {
    const kitRes = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: validJd,
        company_url: 'https://example.com',
        days_available: 5
      });
    const e2eKitId = kitRes.body.kit.id;
    const e2eJobId = kitRes.body.job.id;

    // Stage 1: /start
    const s1 = await request(app)
      .post(`/api/kits/${e2eKitId}/generate/start`)
      .set('Cookie', cookieUserA);
    assert.equal(s1.status, 200);

    // Stage 2: /questions
    const s2 = await request(app)
      .post(`/api/kits/${e2eKitId}/generate/questions`)
      .set('Cookie', cookieUserA);
    assert.equal(s2.status, 200);

    // Stage 3: /flashcards
    const s3 = await request(app)
      .post(`/api/kits/${e2eKitId}/generate/flashcards`)
      .set('Cookie', cookieUserA);
    assert.equal(s3.status, 200);

    // Stage 4: /finalize
    const s4 = await request(app)
      .post(`/api/kits/${e2eKitId}/generate/finalize`)
      .set('Cookie', cookieUserA);
    assert.equal(s4.status, 200);
    assert.equal(s4.body.kit.status, 'ready');

    // Verify polling endpoint GET /api/generation-jobs/:id returns completed
    const pollRes = await request(app)
      .get(`/api/generation-jobs/${e2eJobId}`)
      .set('Cookie', cookieUserA);
    assert.equal(pollRes.status, 200);
    assert.equal(pollRes.body.job.status, 'completed');
    assert.equal(pollRes.body.job.progress, 100);
  });

  t.after(() => {
    setDefaultProvider(null);
  });
});
