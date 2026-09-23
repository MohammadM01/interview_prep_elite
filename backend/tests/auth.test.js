import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app, { sessionStore } from '../src/app.js';
import { connectToDatabase, getDatabase, closeDatabaseConnection } from '../src/config/database.js';

test('Authentication API Test Suite', async (t) => {
  await connectToDatabase();
  const db = getDatabase();

  const testEmail = `test.user.${Date.now()}@example.com`;
  const testPassword = 'StrongPassword123!';
  let sessionCookie = null;

  t.after(async () => {
    // Clean up test user created during the test run
    if (db) {
      try {
        await db.collection('users').deleteMany({ email: { $regex: /^test\.user\./ } });
        await db.collection('sessions').deleteMany({});
      } catch {}
    }
  });

  await t.test('1. register success creates user and returns safe user data with session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: testEmail, password: testPassword });

    assert.equal(res.status, 201);
    assert.ok(res.body.user);
    assert.equal(res.body.user.email, testEmail.toLowerCase());
    assert.ok(res.body.user.id);
    assert.equal(res.body.user.password_hash, undefined, 'password_hash must never be returned');

    // Verify session cookie was set
    const cookies = res.headers['set-cookie'];
    assert.ok(cookies && cookies.length > 0, 'Session cookie must be set');
    sessionCookie = cookies[0];

    // Verify user exists in MongoDB and has argon2 password_hash
    const storedUser = await db.collection('users').findOne({ email: testEmail.toLowerCase() });
    assert.ok(storedUser, 'User must exist in database');
    assert.ok(storedUser.password_hash.startsWith('$argon2'), 'Password must be stored as an Argon2 hash');
  });

  await t.test('2. duplicate registration rejects with 409 conflict', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: testEmail, password: testPassword });

    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EMAIL_ALREADY_EXISTS');
  });

  await t.test('3. invalid registration input rejects with 400 validation error', async () => {
    const resShortPassword = await request(app)
      .post('/api/auth/register')
      .send({ email: 'valid@example.com', password: '123' });

    assert.equal(resShortPassword.status, 400);
    assert.equal(resShortPassword.body.error.code, 'VALIDATION_ERROR');

    const resInvalidEmail = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'ValidPassword123' });

    assert.equal(resInvalidEmail.status, 400);
    assert.equal(resInvalidEmail.body.error.code, 'VALIDATION_ERROR');
  });

  await t.test('4. login success with valid credentials returns safe user and session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: testPassword });

    assert.equal(res.status, 200);
    assert.ok(res.body.user);
    assert.equal(res.body.user.email, testEmail.toLowerCase());
    assert.equal(res.body.user.password_hash, undefined);

    const cookies = res.headers['set-cookie'];
    assert.ok(cookies && cookies.length > 0);
    sessionCookie = cookies[0];
  });

  await t.test('5. login fails with wrong password with 401 invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: 'WrongPassword999!' });

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  await t.test('6. unauthenticated GET /api/auth/me returns 401', async () => {
    const res = await request(app).get('/api/auth/me');

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  await t.test('7. authenticated GET /api/auth/me returns current user profile and persists across requests', async () => {
    assert.ok(sessionCookie.includes('ipe.sid='), 'Session cookie must use ipe.sid name');

    // First request
    const res1 = await request(app)
      .get('/api/auth/me')
      .set('Cookie', sessionCookie);

    assert.equal(res1.status, 200);
    assert.ok(res1.body.user);
    assert.equal(res1.body.user.email, testEmail.toLowerCase());
    assert.equal(res1.body.user.password_hash, undefined);

    // Second request simulating page reload / subsequent navigation
    const res2 = await request(app)
      .get('/api/auth/me')
      .set('Cookie', sessionCookie);

    assert.equal(res2.status, 200);
    assert.equal(res2.body.user.id, res1.body.user.id);
    assert.equal(res2.body.user.email, testEmail.toLowerCase());
  });

  await t.test('8. logout terminates session, clears ipe.sid cookie, and invalidates subsequent /me requests', async () => {
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', sessionCookie);

    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.body.message, 'Logged out successfully');

    // Verify ipe.sid cookie was cleared
    const cookies = logoutRes.headers['set-cookie'];
    assert.ok(cookies && cookies.length > 0, 'Logout must send set-cookie header');
    const clearedCookie = cookies.find((c) => c.startsWith('ipe.sid='));
    assert.ok(clearedCookie, 'Must clear ipe.sid cookie');
    assert.ok(clearedCookie.includes('Expires=') || clearedCookie.includes('Max-Age=0'), 'Cleared cookie must have expired date');

    // Now request /me with the old cookie
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', sessionCookie);

    assert.equal(meRes.status, 401);
    assert.equal(meRes.body.error.code, 'UNAUTHORIZED');
  });

  await t.test('9. GET /api/health returns 200, ok status and database connectivity', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.database, 'connected');
    assert.ok(typeof res.body.timestamp === 'string');
  });
});
