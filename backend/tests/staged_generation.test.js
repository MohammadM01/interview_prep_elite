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

    const unauthContent = await request(app).post(`/api/kits/${kitId}/generate/content`);
    assert.equal(unauthContent.status, 401);

    const unauthFinalize = await request(app).post(`/api/kits/${kitId}/generate/finalize`);
    assert.equal(unauthFinalize.status, 401);
  });

  // 7. Backward compatibility wrapper: POST /api/kits/:id/generate non-blocking default
  await t.test('7. POST /api/kits/:id/generate acts as non-blocking start wrapper by default', async () => {
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

  // 8. End-to-end full staged generation creates valid Appendix A kit
  await t.test('8. Full sequential staged generation produces a valid Appendix A kit', async () => {
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

    // Stage 1
    const s1 = await request(app)
      .post(`/api/kits/${e2eKitId}/generate/start`)
      .set('Cookie', cookieUserA);
    assert.equal(s1.status, 200);

    // Stage 2
    const s2 = await request(app)
      .post(`/api/kits/${e2eKitId}/generate/content`)
      .set('Cookie', cookieUserA);
    assert.equal(s2.status, 200);

    // Stage 3
    const s3 = await request(app)
      .post(`/api/kits/${e2eKitId}/generate/finalize`)
      .set('Cookie', cookieUserA);
    assert.equal(s3.status, 200);
    assert.equal(s3.body.kit.status, 'ready');

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
