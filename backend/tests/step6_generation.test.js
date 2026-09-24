import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../src/app.js';
import { connectToDatabase, getDatabase } from '../src/config/database.js';
import { MockLlmProvider } from '../src/providers/mockProvider.js';
import { LlmError, LLM_ERROR_CODES } from '../src/providers/gemini.js';
import {
  generateQuestions,
  validateAndAssignQuestionIds
} from '../src/pipeline/generation/questionGeneration.js';
import {
  generateFlashcards,
  validateAndAssignFlashcardIds
} from '../src/pipeline/generation/flashcardGeneration.js';
import { executeKitGeneration } from '../src/pipeline/generation/index.js';
import { setDefaultProvider } from '../src/providers/llmProvider.js';

test('Step 6 Question & Flashcard Generation Test Suite', async (t) => {
  await connectToDatabase();
  const db = getDatabase();
  setDefaultProvider(new MockLlmProvider());

  const userAEmail = `step6.user.a.${Date.now()}@example.com`;
  const userBEmail = `step6.user.b.${Date.now()}@example.com`;
  const userPassword = 'TestPassword123!';

  let cookieUserA = null;
  let cookieUserB = null;
  let createdKitIdUserA = null;
  let createdJobIdUserA = null;

  t.after(async () => {
    setDefaultProvider(null);
    if (db) {
      try {
        await db.collection('users').deleteMany({ email: { $regex: /^step6\.user\./ } });
        await db.collection('kits').deleteMany({ _id: new ObjectId(createdKitIdUserA) });
        await db.collection('generation_jobs').deleteMany({});
        await db.collection('sessions').deleteMany({});
      } catch {}
    }
  });

  // Setup: Users & Kit
  await t.test('Setup: register User A and User B and create test kit', async () => {
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

    const kitRes = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: 'Seeking Senior Software Engineer with strong Node.js, MongoDB performance tuning, and cross-team communication skills.',
        company_url: 'https://example-enterprise.org',
        days_available: 7
      });
    assert.equal(kitRes.status, 201);
    createdKitIdUserA = kitRes.body.kit.id;
    createdJobIdUserA = kitRes.body.job.id;
  });

  const sampleRole = {
    title: 'Senior Backend Engineer',
    seniority: 'Senior',
    responsibilities: ['Build distributed systems', 'Tune database queries'],
    requirements: [
      { id: 'r1', text: 'Deep expertise in Node.js backend runtime', kind: 'technical', priority: 'must' },
      { id: 'r2', text: 'MongoDB schema design and indexing optimization', kind: 'technical', priority: 'must' },
      { id: 'r3', text: 'Effective cross-functional communication and mentorship', kind: 'behavioral', priority: 'should' }
    ]
  };

  const sampleCompany = {
    summary: 'A fast-growing fintech company scaling real-time transaction processing.',
    what_they_do: 'Processes payments and provides developer APIs.'
  };

  // 1. Question generation returns valid questions
  await t.test('1. question generation returns valid questions matching Appendix A shape', async () => {
    const mock = new MockLlmProvider();
    const questions = await generateQuestions({
      role: sampleRole,
      companyBrief: sampleCompany,
      options: { provider: mock }
    });

    assert.ok(Array.isArray(questions));
    assert.ok(questions.length >= 1);

    for (const q of questions) {
      assert.ok(typeof q.id === 'string' && /^q\d+$/.test(q.id));
      assert.ok(Array.isArray(q.requirement_ids) && q.requirement_ids.length > 0);
      assert.ok(['technical', 'behavioral', 'role_specific', 'domain', 'company', 'experience'].includes(q.category));
      assert.ok(typeof q.prompt === 'string' && q.prompt.length >= 5);
      assert.ok(typeof q.answer_outline === 'string' && q.answer_outline.length >= 5);
      assert.ok([1, 2, 3].includes(q.difficulty));
    }
  });

  // 2. Deterministic sequential q IDs are assigned (q1, q2...)
  await t.test('2. deterministic sequential q IDs are assigned by backend regardless of model IDs', () => {
    const validReqs = new Set(['r1', 'r2']);
    const untrustedModelQuestions = [
      { id: 'model_random_xyz', requirement_ids: ['r1'], category: 'technical', prompt: 'Question one text here', answer_outline: 'Answer outline one', difficulty: 2 },
      { id: 'model_random_abc', requirement_ids: ['r2'], category: 'technical', prompt: 'Question two text here', answer_outline: 'Answer outline two', difficulty: 3 }
    ];

    const normalized = validateAndAssignQuestionIds(untrustedModelQuestions, validReqs);
    assert.equal(normalized[0].id, 'q1');
    assert.equal(normalized[1].id, 'q2');
  });

  // 3. Every requirement_id exists in valid requirements
  await t.test('3. every requirement_id in generated questions references a real requirement', async () => {
    const mock = new MockLlmProvider();
    const questions = await generateQuestions({
      role: sampleRole,
      companyBrief: sampleCompany,
      options: { provider: mock }
    });

    const validReqIds = new Set(sampleRole.requirements.map((r) => r.id));
    for (const q of questions) {
      for (const reqId of q.requirement_ids) {
        assert.ok(validReqIds.has(reqId), `requirement_id "${reqId}" must exist in role requirements`);
      }
    }
  });

  // 4. Invalid difficulty is rejected
  await t.test('4. invalid difficulty is rejected with structured error', () => {
    const validReqs = new Set(['r1']);
    const badDiffQuestions = [
      { requirement_ids: ['r1'], category: 'technical', prompt: 'Valid question text here', answer_outline: 'Valid answer outline here', difficulty: 5 }
    ];

    assert.throws(
      () => validateAndAssignQuestionIds(badDiffQuestions, validReqs),
      (err) => err.code === LLM_ERROR_CODES.SCHEMA_INVALID && err.message.includes('difficulty')
    );
  });

  // 5. Missing prompt is rejected
  await t.test('5. missing prompt is rejected with structured error', () => {
    const validReqs = new Set(['r1']);
    const missingPromptQuestions = [
      { requirement_ids: ['r1'], category: 'technical', prompt: '', answer_outline: 'Valid answer outline', difficulty: 2 }
    ];

    assert.throws(
      () => validateAndAssignQuestionIds(missingPromptQuestions, validReqs),
      (err) => err.code === LLM_ERROR_CODES.SCHEMA_INVALID && err.message.includes('prompt')
    );
  });

  // 6. Flashcard generation returns valid cards
  await t.test('6. flashcard generation returns valid cards matching Appendix A shape', async () => {
    const mock = new MockLlmProvider();
    const flashcards = await generateFlashcards({
      requirements: sampleRole.requirements,
      role: sampleRole,
      companyBrief: sampleCompany,
      options: { provider: mock }
    });

    assert.ok(Array.isArray(flashcards));
    assert.ok(flashcards.length >= 1);

    for (const f of flashcards) {
      assert.ok(typeof f.id === 'string' && /^f\d+$/.test(f.id));
      assert.ok(typeof f.front === 'string' && f.front.length >= 3);
      assert.ok(typeof f.back === 'string' && f.back.length >= 3);
      assert.ok(Array.isArray(f.requirement_ids) && f.requirement_ids.length > 0);
    }
  });

  // 7. Deterministic sequential f IDs are assigned (f1, f2...)
  await t.test('7. deterministic sequential f IDs are assigned by backend regardless of model IDs', () => {
    const validReqs = new Set(['r1', 'r2']);
    const untrustedModelFlashcards = [
      { id: 'random_flashcard_99', front: 'Front of card 1', back: 'Back of card 1', requirement_ids: ['r1'] },
      { id: 'random_flashcard_88', front: 'Front of card 2', back: 'Back of card 2', requirement_ids: ['r2'] }
    ];

    const normalized = validateAndAssignFlashcardIds(untrustedModelFlashcards, validReqs);
    assert.equal(normalized[0].id, 'f1');
    assert.equal(normalized[1].id, 'f2');
  });

  // 8. Invalid requirement IDs are rejected
  await t.test('8. invalid requirement IDs are rejected in questions and flashcards', () => {
    const validReqs = new Set(['r1']);

    const questionWithFakeReq = [
      { requirement_ids: ['r99_non_existent'], category: 'technical', prompt: 'Prompt text here', answer_outline: 'Outline here', difficulty: 2 }
    ];
    assert.throws(
      () => validateAndAssignQuestionIds(questionWithFakeReq, validReqs),
      (err) => err.code === LLM_ERROR_CODES.SCHEMA_INVALID && err.message.includes('non-existent requirement_id')
    );

    const flashcardWithFakeReq = [
      { front: 'Front of card', back: 'Back of card', requirement_ids: ['r99_fake'] }
    ];
    assert.throws(
      () => validateAndAssignFlashcardIds(flashcardWithFakeReq, validReqs),
      (err) => err.code === LLM_ERROR_CODES.SCHEMA_INVALID && err.message.includes('non-existent requirement_id')
    );
  });

  // 9. Question generation retries correctly on malformed response
  await t.test('9. question generation retries correctly when first attempt returns malformed JSON', async () => {
    const mock = new MockLlmProvider();
    let callCount = 0;
    mock.setOverrideHandler(() => {
      callCount++;
      if (callCount === 1) {
        return 'Not valid json at all';
      }
      return JSON.stringify({
        questions: [
          {
            requirement_ids: ['r1'],
            category: 'technical',
            prompt: 'Explain JavaScript prototypes.',
            answer_outline: 'Prototypes form an inheritance chain in JS.',
            difficulty: 1
          }
        ]
      });
    });

    const questions = await generateQuestions({
      role: sampleRole,
      companyBrief: sampleCompany,
      options: { provider: mock, maxRetries: 3 }
    });

    assert.equal(callCount, 2);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].id, 'q1');
  });

  // 10. Flashcard generation retries correctly on malformed response
  await t.test('10. flashcard generation retries correctly when first attempt returns malformed JSON', async () => {
    const mock = new MockLlmProvider();
    let callCount = 0;
    mock.setOverrideHandler(() => {
      callCount++;
      if (callCount === 1) {
        return '{ invalid json string';
      }
      return JSON.stringify({
        flashcards: [
          {
            front: 'What is prototypal inheritance?',
            back: 'Objects inheriting properties directly from other objects via prototype chain.',
            requirement_ids: ['r1']
          }
        ]
      });
    });

    const flashcards = await generateFlashcards({
      requirements: sampleRole.requirements,
      role: sampleRole,
      companyBrief: sampleCompany,
      options: { provider: mock, maxRetries: 3 }
    });

    assert.equal(callCount, 2);
    assert.equal(flashcards.length, 1);
    assert.equal(flashcards[0].id, 'f1');
  });

  // 11. Thin data does not cause fabricated company facts or crash
  await t.test('11. thin data generates grounded questions without hallucinating requirements', async () => {
    const thinRole = {
      title: 'Junior Developer',
      seniority: 'Junior',
      responsibilities: ['Write clean code'],
      requirements: [
        { id: 'r1', text: 'Basic JavaScript syntax knowledge', kind: 'technical', priority: 'must' }
      ]
    };

    const mock = new MockLlmProvider();
    mock.setOverrideHandler(() => {
      return JSON.stringify({
        questions: [
          {
            requirement_ids: ['r1'],
            category: 'technical',
            prompt: 'What are the primitive data types in JavaScript?',
            answer_outline: 'Number, string, boolean, undefined, null, symbol, bigint.',
            difficulty: 1
          }
        ]
      });
    });

    const questions = await generateQuestions({
      role: thinRole,
      companyBrief: { summary: 'Thin summary', what_they_do: 'Thin domain' },
      options: { provider: mock }
    });

    assert.equal(questions.length, 1);
    assert.equal(questions[0].id, 'q1');
    assert.deepEqual(questions[0].requirement_ids, ['r1']);
  });

  // 12. Full Step 6 pipeline persists questions & flashcards to MongoDB kit
  await t.test('12. full Step 6 pipeline persists questions and flashcards into kit document', async () => {
    const mock = new MockLlmProvider();

    const genResult = await executeKitGeneration({
      kitId: createdKitIdUserA,
      jobId: createdJobIdUserA,
      userId: (await db.collection('kits').findOne({ _id: new ObjectId(createdKitIdUserA) })).user_id,
      options: { provider: mock }
    });

    assert.ok(genResult.kit);
    assert.ok(Array.isArray(genResult.kit.questions) && genResult.kit.questions.length >= 1);
    assert.ok(Array.isArray(genResult.kit.flashcards) && genResult.kit.flashcards.length >= 1);

    // Verify in database
    const persistedKit = await db.collection('kits').findOne({ _id: new ObjectId(createdKitIdUserA) });
    assert.ok(persistedKit.questions.length >= 1);
    assert.equal(persistedKit.questions[0].id, 'q1');
    assert.ok(persistedKit.flashcards.length >= 1);
    assert.equal(persistedKit.flashcards[0].id, 'f1');
    assert.equal(persistedKit.status, 'ready');

    // Verify job completion
    const completedJob = await db.collection('generation_jobs').findOne({ _id: new ObjectId(createdJobIdUserA) });
    assert.equal(completedJob.status, 'completed');
    assert.equal(completedJob.stage, 'generation_completed');
    assert.equal(completedJob.progress, 100);
  });

  // 13. Schedule and coverage remain untouched
  await t.test('13. schedule and coverage remain untouched/empty as Step 7 is not started', async () => {
    const kit = await db.collection('kits').findOne({ _id: new ObjectId(createdKitIdUserA) });
    assert.equal(kit.schedule, null);
    assert.equal(kit.coverage, null);
  });

  // 14. Multi-tenant ownership isolation: User B cannot trigger generation on User A kit
  await t.test('14. multi-tenant isolation: User B cannot trigger generation on User A kit', async () => {
    const res = await request(app)
      .post(`/api/kits/${createdKitIdUserA}/generate`)
      .set('Cookie', cookieUserB);

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // 15. Controller integration: POST /api/kits/:id/generate
  await t.test('15. POST /api/kits/:id/generate succeeds for kit owner', async () => {
    const res = await request(app)
      .post(`/api/kits/${createdKitIdUserA}/generate`)
      .set('Cookie', cookieUserA);

    assert.equal(res.status, 200);
    assert.ok(res.body.kit);
    assert.ok(res.body.kit.questions.length >= 1);
    assert.ok(res.body.kit.flashcards.length >= 1);
  });
});
