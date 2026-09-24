import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import app from '../src/app.js';
import { connectToDatabase, getDatabase } from '../src/config/database.js';
import { getNextPracticeOrder, getNextFlashcardPracticeOrder } from '../src/pipeline/practice/order.js';
import { MockLlmProvider } from '../src/providers/mockProvider.js';
import { setDefaultProvider } from '../src/providers/llmProvider.js';

test('Step 9 Practice Mode Suite', async (t) => {
  let db;
  let cookieUserA;
  let cookieUserB;
  let userAId;
  let userBId;
  let kitIdUserA;

  await t.test('Setup: register User A & B, create seed kit with questions and flashcards', async () => {
    await connectToDatabase();
    db = getDatabase();
    setDefaultProvider(new MockLlmProvider());

    const emailA = `step9_userA_${Date.now()}@example.com`;
    const resA = await request(app)
      .post('/api/auth/register')
      .send({ email: emailA, password: 'password123' });
    assert.equal(resA.status, 201);
    cookieUserA = resA.headers['set-cookie'][0];
    userAId = resA.body.user.id;

    const emailB = `step9_userB_${Date.now()}@example.com`;
    const resB = await request(app)
      .post('/api/auth/register')
      .send({ email: emailB, password: 'password123' });
    assert.equal(resB.status, 201);
    cookieUserB = resB.headers['set-cookie'][0];
    userBId = resB.body.user.id;

    // Seed kit with 4 questions of different requirements and difficulties
    const kitDoc = {
      user_id: new ObjectId(userAId),
      status: 'ready',
      source: { company_url: 'https://practice-corp.com' },
      input: { jd: 'Senior Platform Engineer', company_url: 'https://practice-corp.com', days_available: 5 },
      company_brief: {
        company: 'Practice Corp',
        role: 'Senior Platform Engineer',
        seniority: 'Senior',
        company_summary: 'Platform engineering firm',
        what_they_do: 'Cloud orchestration',
        sources: ['https://practice-corp.com']
      },
      role: {
        title: 'Senior Platform Engineer',
        seniority: 'Senior',
        responsibilities: ['Build cloud infra'],
        requirements: [
          { id: 'r1', priority: 'must', kind: 'technical', text: 'Kubernetes orchestration' },
          { id: 'r2', priority: 'should', kind: 'technical', text: 'Distributed tracing' },
          { id: 'r3', priority: 'nice', kind: 'behavioral', text: 'Mentorship' }
        ]
      },
      questions: [
        {
          id: 'q1',
          category: 'technical',
          prompt: 'Explain Kubernetes Ingress Controllers',
          answer_outline: 'L7 routing, envoy, nginx, service mesh.',
          difficulty: 2,
          requirement_ids: ['r1']
        },
        {
          id: 'q2',
          category: 'technical',
          prompt: 'How to implement distributed tracing with OpenTelemetry?',
          answer_outline: 'Context propagation, baggage, trace ID generation.',
          difficulty: 3,
          requirement_ids: ['r2']
        },
        {
          id: 'q3',
          category: 'technical',
          prompt: 'Explain etcd consensus mechanism in K8s',
          answer_outline: 'Raft consensus, leader election, log replication.',
          difficulty: 3,
          requirement_ids: ['r1']
        },
        {
          id: 'q4',
          category: 'behavioral',
          prompt: 'Describe a time you mentored a junior engineer',
          answer_outline: 'Situation, task, mentoring action, result.',
          difficulty: 1,
          requirement_ids: ['r3']
        }
      ],
      flashcards: [
        {
          id: 'f1',
          front: 'What is Raft?',
          back: 'A consensus algorithm designed to be easy to understand.',
          requirement_ids: ['r1']
        },
        {
          id: 'f2',
          front: 'What is OpenTelemetry Collector?',
          back: 'A proxy that receives, processes and exports telemetry data.',
          requirement_ids: ['r2']
        }
      ],
      created_at: new Date(),
      updated_at: new Date()
    };

    const insertRes = await db.collection('kits').insertOne(kitDoc);
    kitIdUserA = insertRes.insertedId.toString();
  });

  // 1. authenticated user can load practice state
  await t.test('1. authenticated user can load practice state', async () => {
    const res = await request(app)
      .get(`/api/kits/${kitIdUserA}/practice`)
      .set('Cookie', cookieUserA);

    assert.equal(res.status, 200);
    assert.equal(res.body.kit_id, kitIdUserA);
    assert.equal(res.body.company, 'Practice Corp');
    assert.equal(res.body.questions.length, 4);
    assert.equal(res.body.flashcards.length, 2);
    assert.ok(res.body.practice);
    assert.deepEqual(res.body.practice.questions, {});
  });

  // 2. unauthenticated user is rejected
  await t.test('2. unauthenticated user is rejected', async () => {
    const res = await request(app)
      .get(`/api/kits/${kitIdUserA}/practice`);

    assert.equal(res.status, 401);
  });

  // 3. user cannot access another user's practice state
  await t.test('3. user cannot access another user practice state', async () => {
    const res = await request(app)
      .get(`/api/kits/${kitIdUserA}/practice`)
      .set('Cookie', cookieUserB);

    assert.equal(res.status, 404);
  });

  // 4. confidence validation
  await t.test('4. confidence validation allows low/medium/high and rejects invalid', async () => {
    // Valid confidence 'low'
    const resLow = await request(app)
      .patch(`/api/kits/${kitIdUserA}/practice`)
      .set('Cookie', cookieUserA)
      .send({
        question_id: 'q1',
        confidence: 'low'
      });
    assert.equal(resLow.status, 200);
    assert.equal(resLow.body.practice.questions['q1'].confidence, 'low');

    // Invalid confidence 'super_high'
    const resBad = await request(app)
      .patch(`/api/kits/${kitIdUserA}/practice`)
      .set('Cookie', cookieUserA)
      .send({
        question_id: 'q1',
        confidence: 'super_high'
      });
    assert.equal(resBad.status, 400);
    assert.equal(resBad.body.error.code, 'VALIDATION_ERROR');
  });

  // 5. covered/uncovered validation
  await t.test('5. covered/uncovered validation allows boolean and rejects invalid', async () => {
    // Valid covered true
    const resCovered = await request(app)
      .patch(`/api/kits/${kitIdUserA}/practice`)
      .set('Cookie', cookieUserA)
      .send({
        question_id: 'q1',
        covered: true
      });
    assert.equal(resCovered.status, 200);
    assert.equal(resCovered.body.practice.questions['q1'].covered, true);

    // Invalid non-boolean covered
    const resBadCovered = await request(app)
      .patch(`/api/kits/${kitIdUserA}/practice`)
      .set('Cookie', cookieUserA)
      .send({
        question_id: 'q1',
        covered: 'yes_covered'
      });
    assert.equal(resBadCovered.status, 400);
    assert.equal(resBadCovered.body.error.code, 'VALIDATION_ERROR');
  });

  // 6. invalid question ID rejected
  await t.test('6. invalid question ID rejected', async () => {
    const res = await request(app)
      .patch(`/api/kits/${kitIdUserA}/practice`)
      .set('Cookie', cookieUserA)
      .send({
        question_id: 'q999_nonexistent',
        confidence: 'high'
      });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /does not exist/i);
  });

  // 7. practice state persists
  await t.test('7. practice state persists for question', async () => {
    const patchRes = await request(app)
      .patch(`/api/kits/${kitIdUserA}/practice`)
      .set('Cookie', cookieUserA)
      .send({
        question_id: 'q2',
        confidence: 'medium',
        covered: false
      });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.practice.questions['q2'].confidence, 'medium');
    assert.equal(patchRes.body.practice.questions['q2'].covered, false);
    assert.equal(patchRes.body.practice.questions['q2'].practiced, true);
  });

  // 8. practice state survives reload/API re-fetch
  await t.test('8. practice state survives API re-fetch', async () => {
    const getRes = await request(app)
      .get(`/api/kits/${kitIdUserA}/practice`)
      .set('Cookie', cookieUserA);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.practice.questions['q1'].confidence, 'low');
    assert.equal(getRes.body.practice.questions['q1'].covered, true);
    assert.equal(getRes.body.practice.questions['q2'].confidence, 'medium');
    assert.equal(getRes.body.practice.questions['q2'].covered, false);
  });

  // 9. least-confidence ordering: low > medium > high > never practiced
  await t.test('9. least-confidence ordering places lower confidence earlier', async () => {
    // Set q3 to 'high'
    await request(app)
      .patch(`/api/kits/${kitIdUserA}/practice`)
      .set('Cookie', cookieUserA)
      .send({
        question_id: 'q3',
        confidence: 'high',
        covered: true
      });

    // Currently:
    // q1: confidence 'low'
    // q2: confidence 'medium'
    // q3: confidence 'high'
    // q4: never practiced
    const getRes = await request(app)
      .get(`/api/kits/${kitIdUserA}/practice`)
      .set('Cookie', cookieUserA);

    const orderedIds = getRes.body.questions.map((q) => q.id);
    assert.equal(orderedIds[0], 'q1', 'Low confidence must come first');
    assert.equal(orderedIds[1], 'q2', 'Medium confidence must come second');
    assert.equal(orderedIds[2], 'q3', 'High confidence must come third');
    assert.equal(orderedIds[3], 'q4', 'Never practiced must come last');
  });

  // 10. deterministic tie-breaking (requirement priority > difficulty > ID)
  await t.test('10. deterministic tie-breaking within same confidence level', async () => {
    const testQuestions = [
      { id: 'q_tie1', difficulty: 2, requirement_ids: ['r_must'] },
      { id: 'q_tie2', difficulty: 3, requirement_ids: ['r_must'] },
      { id: 'q_tie3', difficulty: 3, requirement_ids: ['r_should'] },
      { id: 'q_tie4', difficulty: 3, requirement_ids: ['r_must'] }
    ];

    const testRequirements = [
      { id: 'r_must', priority: 'must' },
      { id: 'r_should', priority: 'should' }
    ];

    // All set to 'low' confidence
    const practiceMap = {
      q_tie1: { confidence: 'low', practiced: true },
      q_tie2: { confidence: 'low', practiced: true },
      q_tie3: { confidence: 'low', practiced: true },
      q_tie4: { confidence: 'low', practiced: true }
    };

    const ordered = getNextPracticeOrder(testQuestions, practiceMap, testRequirements);
    const orderedIds = ordered.map((q) => q.id);

    // Priority tie-breaker:
    // r_must questions must precede r_should (q_tie3 is r_should, so it must be after all r_must)
    assert.equal(orderedIds[3], 'q_tie3');

    // Among r_must:
    // Difficulty 3 before Difficulty 2: q_tie2 and q_tie4 (diff 3) before q_tie1 (diff 2)
    assert.equal(orderedIds[2], 'q_tie1');

    // Between q_tie2 and q_tie4 (both must, diff 3):
    // Stable ID ascending: q_tie2 comes before q_tie4
    assert.equal(orderedIds[0], 'q_tie2');
    assert.equal(orderedIds[1], 'q_tie4');
  });

  // 11. never-practiced ordering
  await t.test('11. never-practiced items follow deterministic priority and difficulty', () => {
    const questions = [
      { id: 'q_np1', difficulty: 1, requirement_ids: ['r1'] },
      { id: 'q_np2', difficulty: 3, requirement_ids: ['r1'] },
      { id: 'q_np3', difficulty: 2, requirement_ids: ['r2'] }
    ];
    const requirements = [
      { id: 'r1', priority: 'must' },
      { id: 'r2', priority: 'should' }
    ];

    // None practiced
    const ordered = getNextPracticeOrder(questions, {}, requirements);
    const ids = ordered.map((q) => q.id);
    // r1 (must) before r2 (should)
    // Between q_np2 (diff 3) and q_np1 (diff 1): q_np2 comes first
    assert.equal(ids[0], 'q_np2');
    assert.equal(ids[1], 'q_np1');
    assert.equal(ids[2], 'q_np3');
  });

  // 12. flashcard practice state & least-confidence ordering
  await t.test('12. flashcard practice state persists and orders by least confidence', async () => {
    // Update f2 to 'low', f1 to 'high'
    const patchF2 = await request(app)
      .patch(`/api/kits/${kitIdUserA}/practice`)
      .set('Cookie', cookieUserA)
      .send({
        flashcard_id: 'f2',
        confidence: 'low'
      });
    assert.equal(patchF2.status, 200);
    assert.equal(patchF2.body.practice.flashcards['f2'].confidence, 'low');

    const patchF1 = await request(app)
      .patch(`/api/kits/${kitIdUserA}/practice`)
      .set('Cookie', cookieUserA)
      .send({
        flashcard_id: 'f1',
        confidence: 'high'
      });
    assert.equal(patchF1.status, 200);
    assert.equal(patchF1.body.practice.flashcards['f1'].confidence, 'high');

    // f2 ('low') must come before f1 ('high')
    const getRes = await request(app)
      .get(`/api/kits/${kitIdUserA}/practice`)
      .set('Cookie', cookieUserA);
    const fIds = getRes.body.flashcards.map((f) => f.id);
    assert.equal(fIds[0], 'f2', 'f2 (low confidence) must be first');
    assert.equal(fIds[1], 'f1', 'f1 (high confidence) must be second');
  });

  // 13. another user's practice data is isolated
  await t.test('13. another user practice data is isolated', async () => {
    // Create kit for User B
    const kitResB = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserB)
      .send({
        jd: 'Backend Engineer. Go and microservices.',
        company_url: 'https://example-b.com',
        days_available: 3
      });
    assert.equal(kitResB.status, 201);
    const kitBId = kitResB.body.kit.id;

    // User B fetches their practice state
    const practiceB = await request(app)
      .get(`/api/kits/${kitBId}/practice`)
      .set('Cookie', cookieUserB);
    assert.equal(practiceB.status, 200);
    // User B's practice questions must be completely empty, having none of User A's data
    assert.deepEqual(practiceB.body.practice.questions, {});

    // User B cannot patch User A's kit
    const patchUnauthorized = await request(app)
      .patch(`/api/kits/${kitIdUserA}/practice`)
      .set('Cookie', cookieUserB)
      .send({
        question_id: 'q1',
        confidence: 'high'
      });
    assert.equal(patchUnauthorized.status, 404);
  });
});
