import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { connectToDatabase, getDatabase } from '../src/config/database.js';

test('Kit Creation and Generation Job Test Suite', async (t) => {
  await connectToDatabase();
  const db = getDatabase();

  const userAEmail = `kit.user.a.${Date.now()}@example.com`;
  const userBEmail = `kit.user.b.${Date.now()}@example.com`;
  const userPassword = 'TestPassword123!';

  let cookieUserA = null;
  let cookieUserB = null;
  let createdKitIdUserA = null;
  let createdJobIdUserA = null;

  t.after(async () => {
    if (db) {
      try {
        await db.collection('users').deleteMany({ email: { $regex: /^kit\.user\./ } });
        await db.collection('kits').deleteMany({});
        await db.collection('generation_jobs').deleteMany({});
        await db.collection('sessions').deleteMany({});
      } catch {}
    }
  });

  // Setup User A and User B
  await t.test('Setup: register User A and User B', async () => {
    const resA = await request(app)
      .post('/api/auth/register')
      .send({ email: userAEmail, password: userPassword });
    assert.equal(resA.status, 201);
    cookieUserA = resA.headers['set-cookie'][0];

    const resB = await request(app)
      .post('/api/auth/register')
      .send({ email: userBEmail, password: userPassword });
    assert.equal(resB.status, 201);
    cookieUserB = resB.headers['set-cookie'][0];
  });

  await t.test('1. unauthenticated POST /api/kits returns 401', async () => {
    const res = await request(app)
      .post('/api/kits')
      .send({
        jd: 'Senior Software Engineer role description',
        company_url: 'https://acme.com',
        days_available: 5
      });

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  await t.test('2. authenticated valid kit creation returns 201 with kit and job', async () => {
    const res = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: 'Staff Backend Engineer. Required: Node.js, Distributed Systems, MongoDB.',
        company_url: 'https://stripe.com',
        days_available: 7
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.kit);
    assert.ok(res.body.kit.id);
    assert.equal(res.body.kit.status, 'queued');
    assert.ok(res.body.job);
    assert.ok(res.body.job.id);
    assert.equal(res.body.job.status, 'queued');
    assert.equal(res.body.job.progress, 0);

    createdKitIdUserA = res.body.kit.id;
    createdJobIdUserA = res.body.job.id;

    // Verify stored directly in MongoDB
    const storedKit = await db.collection('kits').findOne({ _id: new (await import('mongodb')).ObjectId(createdKitIdUserA) });
    assert.ok(storedKit);
    assert.equal(storedKit.input.days_available, 7);
    assert.equal(storedKit.source.company_url, 'https://stripe.com/');

    const storedJob = await db.collection('generation_jobs').findOne({ _id: new (await import('mongodb')).ObjectId(createdJobIdUserA) });
    assert.ok(storedJob);
    assert.equal(storedJob.stage, 'created');
  });

  await t.test('3. invalid empty JD is rejected with 400 validation error', async () => {
    const res = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: '   ',
        company_url: 'https://github.com',
        days_available: 5
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  await t.test('4. invalid URL (localhost / SSRF / non-http) is rejected with 400', async () => {
    const resLocalhost = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: 'Some valid job description',
        company_url: 'http://localhost:8080',
        days_available: 5
      });
    assert.equal(resLocalhost.status, 400);
    assert.equal(resLocalhost.body.error.code, 'VALIDATION_ERROR');

    const resPrivateIp = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: 'Some valid job description',
        company_url: 'http://192.168.1.1/careers',
        days_available: 5
      });
    assert.equal(resPrivateIp.status, 400);
    assert.equal(resPrivateIp.body.error.code, 'VALIDATION_ERROR');

    const resLoopback = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: 'Some valid job description',
        company_url: 'http://127.0.0.1:3000',
        days_available: 5
      });
    assert.equal(resLoopback.status, 400);
    assert.equal(resLoopback.body.error.code, 'VALIDATION_ERROR');
  });

  await t.test('5. invalid days_available (non-integer, 0, or negative) is rejected with 400', async () => {
    const resZero = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: 'Some valid job description',
        company_url: 'https://example.com',
        days_available: 0
      });
    assert.equal(resZero.status, 400);
    assert.equal(resZero.body.error.code, 'VALIDATION_ERROR');

    const resFloat = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: 'Some valid job description',
        company_url: 'https://example.com',
        days_available: 3.5
      });
    assert.equal(resFloat.status, 400);
    assert.equal(resFloat.body.error.code, 'VALIDATION_ERROR');
  });

  await t.test('6. days_available = 1 accepted', async () => {
    const res = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: 'Fast 1-day prep required for interview tomorrow',
        company_url: 'https://example.com',
        days_available: 1
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.kit.status, 'queued');
  });

  await t.test('7. days_available = 60 accepted', async () => {
    const res = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: 'Comprehensive 60-day deep prep for principal engineer',
        company_url: 'https://example.com',
        days_available: 60
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.kit.status, 'queued');
  });

  await t.test('8. days_available = 61 rejected with 400', async () => {
    const res = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: 'Too long prep timeline',
        company_url: 'https://example.com',
        days_available: 61
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  await t.test('9. GET /api/kits returns only current user kits', async () => {
    // User A has kits created above
    const resA = await request(app)
      .get('/api/kits')
      .set('Cookie', cookieUserA);

    assert.equal(resA.status, 200);
    assert.ok(Array.isArray(resA.body.kits));
    assert.ok(resA.body.kits.length >= 3);

    // User B has not created any kits yet
    const resB = await request(app)
      .get('/api/kits')
      .set('Cookie', cookieUserB);

    assert.equal(resB.status, 200);
    assert.equal(resB.body.kits.length, 0);
  });

  await t.test("10. GET another user's kit returns 404/not found", async () => {
    // User B attempts to access User A's kit
    const res = await request(app)
      .get(`/api/kits/${createdKitIdUserA}`)
      .set('Cookie', cookieUserB);

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  await t.test('11. GET own kit works and returns kit details', async () => {
    const res = await request(app)
      .get(`/api/kits/${createdKitIdUserA}`)
      .set('Cookie', cookieUserA);

    assert.equal(res.status, 200);
    assert.ok(res.body.kit);
    assert.equal(res.body.kit.id, createdKitIdUserA);
    assert.equal(res.body.kit.status, 'queued');
    assert.equal(res.body.kit.input.days_available, 7);
  });

  await t.test('12. GET own generation job works and returns job status', async () => {
    const res = await request(app)
      .get(`/api/generation-jobs/${createdJobIdUserA}`)
      .set('Cookie', cookieUserA);

    assert.equal(res.status, 200);
    assert.ok(res.body.job);
    assert.equal(res.body.job.id, createdJobIdUserA);
    assert.equal(res.body.job.status, 'queued');
    assert.equal(res.body.job.stage, 'created');
    assert.equal(res.body.job.progress, 0);
  });

  await t.test("13. GET another user's generation job returns 404/not found", async () => {
    // User B attempts to access User A's generation job
    const res = await request(app)
      .get(`/api/generation-jobs/${createdJobIdUserA}`)
      .set('Cookie', cookieUserB);

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
});
