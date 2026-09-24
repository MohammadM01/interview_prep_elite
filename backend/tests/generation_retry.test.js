import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import app from '../src/app.js';
import { connectToDatabase, getDatabase } from '../src/config/database.js';
import { executeKitGeneration } from '../src/pipeline/generation/index.js';
import { MockLlmProvider } from '../src/providers/mockProvider.js';
import { setDefaultProvider } from '../src/providers/llmProvider.js';

test('Generation Recovery & Retry Suite', async (t) => {
  let db;
  let cookieUserA;
  let cookieUserB;
  let userAId;
  let userBId;
  let incompleteKitId;
  let failedKitId;
  let failedJobId;

  await t.test('Setup: register users and seed incomplete and failed kits', async () => {
    await connectToDatabase();
    db = getDatabase();
    setDefaultProvider(new MockLlmProvider());

    const emailA = `retry_userA_${Date.now()}@example.com`;
    const resA = await request(app)
      .post('/api/auth/register')
      .send({ email: emailA, password: 'password123' });
    assert.equal(resA.status, 201);
    cookieUserA = resA.headers['set-cookie'][0];
    userAId = resA.body.user.id;

    const emailB = `retry_userB_${Date.now()}@example.com`;
    const resB = await request(app)
      .post('/api/auth/register')
      .send({ email: emailB, password: 'password123' });
    assert.equal(resB.status, 201);
    cookieUserB = resB.headers['set-cookie'][0];
    userBId = resB.body.user.id;

    // 1. Seed an incomplete kit for User A (empty questions, flashcards, coverage, schedule)
    const incKitDoc = {
      user_id: new ObjectId(userAId),
      source: {
        company: 'Stripe',
        company_url: 'https://stripe.com',
        role: 'Staff Infrastructure Engineer',
        location: '',
        jd_chars: 120,
        researched_at: new Date(),
        pages_used: ['https://stripe.com']
      },
      input: {
        jd: 'Staff Infrastructure Engineer. Must have 5+ years of experience with distributed systems and Kubernetes. Should know Go and Terraform. Nice to have AWS.',
        company_url: 'https://stripe.com',
        days_available: 5
      },
      status: 'queued',
      created_at: new Date(),
      updated_at: new Date()
    };
    const incInsert = await db.collection('kits').insertOne(incKitDoc);
    incompleteKitId = incInsert.insertedId.toString();

    // 2. Seed a failed kit and failed generation job for User A
    const failedKitDoc = {
      user_id: new ObjectId(userAId),
      source: {
        company: 'Stripe',
        company_url: 'https://stripe.com',
        role: 'Staff Infrastructure Engineer',
        location: '',
        jd_chars: 120,
        researched_at: new Date(),
        pages_used: ['https://stripe.com']
      },
      input: {
        jd: 'Staff Infrastructure Engineer. Must have 5+ years of experience with distributed systems and Kubernetes. Should know Go and Terraform. Nice to have AWS.',
        company_url: 'https://stripe.com',
        days_available: 5
      },
      status: 'failed',
      created_at: new Date(),
      updated_at: new Date()
    };
    const failInsert = await db.collection('kits').insertOne(failedKitDoc);
    failedKitId = failInsert.insertedId.toString();

    const jobDoc = {
      user_id: new ObjectId(userAId),
      kit_id: failInsert.insertedId,
      status: 'failed',
      stage: 'question_generation_failed',
      progress: 30,
      error: {
        code: 'SIMULATED_DISCONNECT',
        message: 'Backend server connection dropped during generation'
      },
      created_at: new Date(),
      updated_at: new Date()
    };
    const jobInsert = await db.collection('generation_jobs').insertOne(jobDoc);
    failedJobId = jobInsert.insertedId.toString();
  });

  // 1. Incomplete kit can retry generation
  await t.test('1. incomplete kit can retry generation via POST /api/kits/:id/generate', async () => {
    const res = await request(app)
      .post(`/api/kits/${incompleteKitId}/generate`)
      .set('Cookie', cookieUserA);

    assert.equal(res.status, 200);
    assert.ok(res.body.kit);
    assert.ok(Array.isArray(res.body.kit.questions) && res.body.kit.questions.length >= 1);
    assert.ok(Array.isArray(res.body.kit.flashcards) && res.body.kit.flashcards.length >= 1);
    assert.ok(res.body.kit.coverage);
    assert.ok(res.body.kit.schedule);
    assert.equal(res.body.kit.status, 'ready');
  });

  // 2. Failed generation can retry
  await t.test('2. failed generation can retry and updates job to completed', async () => {
    // Initial verify that job was failed
    const initialJob = await db.collection('generation_jobs').findOne({ _id: new ObjectId(failedJobId) });
    assert.equal(initialJob.status, 'failed');

    const res = await request(app)
      .post(`/api/kits/${failedKitId}/generate`)
      .set('Cookie', cookieUserA);

    assert.equal(res.status, 200);
    assert.ok(res.body.kit);

    // Verify job in database is now completed
    const updatedJob = await db.collection('generation_jobs').findOne({ _id: new ObjectId(failedJobId) });
    assert.equal(updatedJob.status, 'completed');
    assert.equal(updatedJob.stage, 'generation_completed');
    assert.equal(updatedJob.progress, 100);
    assert.equal(updatedJob.error, null);
  });

  // 3. Successful retry populates the kit
  await t.test('3. successful retry populates the kit document in MongoDB', async () => {
    const kitInDb = await db.collection('kits').findOne({ _id: new ObjectId(failedKitId) });
    assert.equal(kitInDb.status, 'ready');
    assert.ok(kitInDb.role?.requirements?.length >= 1);
    assert.ok(kitInDb.questions?.length >= 1);
    assert.ok(kitInDb.flashcards?.length >= 1);
    assert.ok(kitInDb.coverage?.uncovered_requirement_ids);
    assert.ok(kitInDb.schedule?.days?.length === 5);
  });

  // 4. Duplicate retry requests are prevented
  await t.test('4. duplicate retry requests are prevented while generation is running', async () => {
    // Create another kit to test concurrent generation
    const newKitRes = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: 'Backend Developer. Must know Node.js. Should know SQL. Nice to have Docker.',
        company_url: 'https://example.com',
        days_available: 3
      });
    const newKitId = newKitRes.body.kit.id;

    // Simulate concurrent generation calls
    const promise1 = request(app)
      .post(`/api/kits/${newKitId}/generate`)
      .set('Cookie', cookieUserA);

    const promise2 = request(app)
      .post(`/api/kits/${newKitId}/generate`)
      .set('Cookie', cookieUserA);

    const [res1, res2] = await Promise.all([promise1, promise2]);

    // One succeeds (200) and the duplicate concurrent request is rejected with 409
    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 409]);

    const conflictRes = res1.status === 409 ? res1 : res2;
    assert.equal(conflictRes.body.error.code, 'GENERATION_IN_PROGRESS');
  });

  // 5. Completed kit is not unnecessarily regenerated
  await t.test('5. completed kit is not unnecessarily regenerated', async () => {
    const kitBefore = await db.collection('kits').findOne({ _id: new ObjectId(failedKitId) });
    const originalQuestions = kitBefore.questions;

    const res = await request(app)
      .post(`/api/kits/${failedKitId}/generate`)
      .set('Cookie', cookieUserA);

    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'Kit already fully generated');
    assert.equal(res.body.kit.questions.length, originalQuestions.length);
  });

  // 6. Ownership/security still works
  await t.test('6. ownership and security isolation: non-owner cannot retry kit', async () => {
    const resUnauthorized = await request(app)
      .post(`/api/kits/${incompleteKitId}/generate`);
    assert.equal(resUnauthorized.status, 401);

    const resNonOwner = await request(app)
      .post(`/api/kits/${incompleteKitId}/generate`)
      .set('Cookie', cookieUserB);
    assert.equal(resNonOwner.status, 404);
    assert.equal(resNonOwner.body.error.code, 'NOT_FOUND');
  });
});
