import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import app from '../src/app.js';
import { connectToDatabase, getDatabase } from '../src/config/database.js';
import { calculateCoverage, runCoveragePipeline } from '../src/pipeline/coverage/index.js';
import { generateSchedule } from '../src/pipeline/schedule/index.js';
import { executeKitGeneration } from '../src/pipeline/generation/index.js';
import { MockLlmProvider } from '../src/providers/mockProvider.js';
import { setDefaultProvider } from '../src/providers/llmProvider.js';

test('Step 7 Coverage Checking & Deterministic Schedule Suite', async (t) => {
  let db;
  let cookieUserA;
  let cookieUserB;
  let userAId;
  let userBId;
  let createdKitIdUserA;
  let createdJobIdUserA;

  await t.test('Setup: register User A and User B, create test kit', async () => {
    await connectToDatabase();
    db = getDatabase();
    setDefaultProvider(new MockLlmProvider());

    const emailA = `step7_userA_${Date.now()}@example.com`;
    const resA = await request(app)
      .post('/api/auth/register')
      .send({ email: emailA, password: 'password123' });
    assert.equal(resA.status, 201);
    cookieUserA = resA.headers['set-cookie'][0];
    userAId = resA.body.user.id;

    const emailB = `step7_userB_${Date.now()}@example.com`;
    const resB = await request(app)
      .post('/api/auth/register')
      .send({ email: emailB, password: 'password123' });
    assert.equal(resB.status, 201);
    cookieUserB = resB.headers['set-cookie'][0];
    userBId = resB.body.user.id;

    // Create a kit for User A
    const kitRes = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: 'Senior Distributed Engineer. Must know Node.js and MongoDB high-availability clusters. Should know event streaming. Nice to have Redis caching.',
        company_url: 'https://example.com',
        days_available: 5
      });
    assert.equal(kitRes.status, 201);
    createdKitIdUserA = kitRes.body.kit.id;
    createdJobIdUserA = kitRes.body.job.id;
  });

  // 1. Requirement with matching question is covered
  await t.test('1. requirement with matching question is covered', async () => {
    const requirements = [
      { id: 'r1', priority: 'must', kind: 'technical', text: 'Node.js event loop' },
      { id: 'r2', priority: 'must', kind: 'technical', text: 'MongoDB indexing' }
    ];
    const questions = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'P1', answer_outline: 'A1', difficulty: 2 },
      { id: 'q2', requirement_ids: ['r2'], category: 'technical', prompt: 'P2', answer_outline: 'A2', difficulty: 2 }
    ];

    const result = calculateCoverage(requirements, questions, 1);
    assert.deepEqual(result.covered_requirement_ids.sort(), ['r1', 'r2']);
    assert.deepEqual(result.uncovered_requirement_ids, []);
    assert.equal(result.passes, 1);
  });

  // 2. Requirement without matching question is uncovered
  await t.test('2. requirement without matching question is uncovered', async () => {
    const requirements = [
      { id: 'r1', priority: 'must', kind: 'technical', text: 'Node.js event loop' },
      { id: 'r2', priority: 'must', kind: 'technical', text: 'MongoDB indexing' }
    ];
    const questions = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'P1', answer_outline: 'A1', difficulty: 2 }
    ];

    const result = calculateCoverage(requirements, questions, 1);
    assert.deepEqual(result.covered_requirement_ids, ['r1']);
    assert.deepEqual(result.uncovered_requirement_ids, ['r2']);
    assert.equal(result.passes, 1);
  });

  // 3. must requirement triggers second-pass generation
  await t.test('3. must requirement triggers second-pass generation', async () => {
    const requirements = [
      { id: 'r1', priority: 'must', kind: 'technical', text: 'Node.js streams' },
      { id: 'r2', priority: 'must', kind: 'technical', text: 'MongoDB write concerns' }
    ];
    const questions = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'P1', answer_outline: 'A1', difficulty: 2 }
    ];

    const mock = new MockLlmProvider();
    const result = await runCoveragePipeline({
      role: { requirements, title: 'Engineer' },
      existingQuestions: questions,
      options: { provider: mock }
    });

    assert.equal(result.coverage.passes, 2);
    assert.ok(result.questions.length > questions.length);
    assert.ok(result.questions.some((q) => q.requirement_ids.includes('r2')));
  });

  // 4. should requirement triggers second-pass generation
  await t.test('4. should requirement triggers second-pass generation', async () => {
    const requirements = [
      { id: 'r1', priority: 'must', kind: 'technical', text: 'Node.js' },
      { id: 'r2', priority: 'should', kind: 'behavioral', text: 'Stakeholder communication' }
    ];
    const questions = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'P1', answer_outline: 'A1', difficulty: 2 }
    ];

    const mock = new MockLlmProvider();
    const result = await runCoveragePipeline({
      role: { requirements, title: 'Engineer' },
      existingQuestions: questions,
      options: { provider: mock }
    });

    assert.equal(result.coverage.passes, 2);
    assert.ok(result.questions.some((q) => q.requirement_ids.includes('r2')));
  });

  // 5. nice requirement can remain uncovered
  await t.test('5. nice requirement can remain uncovered', async () => {
    const requirements = [
      { id: 'r1', priority: 'must', kind: 'technical', text: 'Node.js' },
      { id: 'r2', priority: 'nice', kind: 'technical', text: 'GraphQL knowledge' }
    ];
    const questions = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'P1', answer_outline: 'A1', difficulty: 2 }
    ];

    const result = calculateCoverage(requirements, questions, 1);
    // r2 is "nice", so it does NOT fail coverage
    assert.deepEqual(result.uncovered_requirement_ids, []);
    assert.deepEqual(result.covered_requirement_ids, ['r1']);
  });

  // 6. second-pass questions are appended, not replacing existing questions
  await t.test('6. second-pass questions are appended, not replacing existing questions', async () => {
    const requirements = [
      { id: 'r1', priority: 'must', kind: 'technical', text: 'Req 1' },
      { id: 'r2', priority: 'must', kind: 'technical', text: 'Req 2' }
    ];
    const existing = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'Existing Q1', answer_outline: 'A1', difficulty: 2 }
    ];

    const mock = new MockLlmProvider();
    const result = await runCoveragePipeline({
      role: { requirements, title: 'Engineer' },
      existingQuestions: existing,
      options: { provider: mock }
    });

    assert.equal(result.questions[0].id, 'q1');
    assert.equal(result.questions[0].prompt, 'Existing Q1');
    assert.ok(result.questions.length >= 2);
    assert.equal(result.questions[1].id, 'q2'); // sequential q2 appended
  });

  // 7. second pass receives only uncovered requirements
  await t.test('7. second pass receives only uncovered requirements', async () => {
    const requirements = [
      { id: 'r1', priority: 'must', kind: 'technical', text: 'Req 1' },
      { id: 'r2', priority: 'must', kind: 'technical', text: 'Req 2' },
      { id: 'r3', priority: 'must', kind: 'technical', text: 'Req 3' }
    ];
    const existing = [
      { id: 'q1', requirement_ids: ['r1', 'r3'], category: 'technical', prompt: 'Covers r1 and r3', answer_outline: 'A1', difficulty: 2 }
    ];

    const mock = new MockLlmProvider();
    await runCoveragePipeline({
      role: { requirements, title: 'Engineer' },
      existingQuestions: existing,
      options: { provider: mock }
    });

    // Inspect the prompt sent to the mock LLM during second pass
    const secondPassCall = mock.history[0];
    assert.ok(secondPassCall);
    assert.ok(secondPassCall.input.includes('r2'));
    assert.ok(secondPassCall.input.includes('UNCOVERED requirement IDs: r2'));
  });

  // 8. maximum passes is exactly 2
  await t.test('8. maximum passes is exactly 2', async () => {
    const requirements = [
      { id: 'r1', priority: 'must', kind: 'technical', text: 'Req 1' },
      { id: 'r2', priority: 'must', kind: 'technical', text: 'Req 2' }
    ];
    const existing = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'Q1', answer_outline: 'A1', difficulty: 2 }
    ];

    // Mock returns an empty question or fails to cover r2
    const failingMock = new MockLlmProvider();
    failingMock.setOverrideHandler(() => JSON.stringify({
      questions: [
        { requirement_ids: ['r1'], category: 'technical', prompt: 'Duplicate r1', answer_outline: 'A', difficulty: 2 }
      ]
    }));

    const result = await runCoveragePipeline({
      role: { requirements, title: 'Engineer' },
      existingQuestions: existing,
      options: { provider: failingMock }
    });

    assert.equal(result.coverage.passes, 2);
    assert.equal(failingMock.callCount, 1); // exactly 1 second-pass LLM call, never loops further
  });

  // 9. coverage recalculates after second pass
  await t.test('9. coverage recalculates after second pass', async () => {
    const requirements = [
      { id: 'r1', priority: 'must', kind: 'technical', text: 'Req 1' },
      { id: 'r2', priority: 'must', kind: 'technical', text: 'Req 2' }
    ];
    const existing = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'Q1', answer_outline: 'A1', difficulty: 2 }
    ];

    const mock = new MockLlmProvider();
    const result = await runCoveragePipeline({
      role: { requirements, title: 'Engineer' },
      existingQuestions: existing,
      options: { provider: mock }
    });

    assert.equal(result.coverage.passes, 2);
    assert.deepEqual(result.coverage.uncovered_requirement_ids, []);
  });

  // 10. still-uncovered requirement remains listed honestly
  await t.test('10. still-uncovered requirement remains listed honestly', async () => {
    const requirements = [
      { id: 'r1', priority: 'must', kind: 'technical', text: 'Req 1' },
      { id: 'r2', priority: 'must', kind: 'technical', text: 'Unresolvable Must Req' }
    ];
    const existing = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'Q1', answer_outline: 'A1', difficulty: 2 }
    ];

    const unhelpfulMock = new MockLlmProvider();
    unhelpfulMock.setOverrideHandler(() => JSON.stringify({
      questions: [
        { requirement_ids: ['r1'], category: 'technical', prompt: 'Another r1 question', answer_outline: 'A', difficulty: 2 }
      ]
    }));

    const result = await runCoveragePipeline({
      role: { requirements, title: 'Engineer' },
      existingQuestions: existing,
      options: { provider: unhelpfulMock }
    });

    assert.equal(result.coverage.passes, 2);
    assert.deepEqual(result.coverage.uncovered_requirement_ids, ['r2']);
  });

  // 11. Important specification fixture test
  await t.test('11. Important fixture: r1 must, r2 must, r3 should, r4 nice with second pass', async () => {
    const requirements = [
      { id: 'r1', priority: 'must', kind: 'technical', text: 'Core backend runtime' },
      { id: 'r2', priority: 'must', kind: 'technical', text: 'Distributed persistence' },
      { id: 'r3', priority: 'should', kind: 'behavioral', text: 'Cross-team communication' },
      { id: 'r4', priority: 'nice', kind: 'domain', text: 'Cloud devops knowledge' }
    ];

    const questions = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'Q on r1', answer_outline: 'A1', difficulty: 2 },
      { id: 'q2', requirement_ids: ['r3'], category: 'behavioral', prompt: 'Q on r3', answer_outline: 'A2', difficulty: 2 }
    ];

    // Pass 1 inspection
    const pass1 = calculateCoverage(requirements, questions, 1);
    assert.deepEqual(pass1.uncovered_requirement_ids, ['r2']);
    assert.deepEqual(pass1.covered_requirement_ids.sort(), ['r1', 'r3']);

    // Pass 2 execution
    const mock = new MockLlmProvider();
    const result = await runCoveragePipeline({
      role: { requirements, title: 'Engineer' },
      existingQuestions: questions,
      options: { provider: mock }
    });

    assert.equal(result.coverage.passes, 2);
    assert.deepEqual(result.coverage.uncovered_requirement_ids, []);

    // Verify schedule prioritized correctly
    const schedule = generateSchedule({
      daysAvailable: 3,
      requirements,
      questions: result.questions
    });

    assert.equal(schedule.days_available, 3);
    assert.equal(schedule.days.length, 3);
    // Must requirements (q1 -> r1, q3 -> r2) scheduled earlier than should requirement (q2 -> r3)
    const day1QuestionIds = schedule.days[0].question_ids;
    assert.ok(day1QuestionIds.includes('q1') || day1QuestionIds.includes('q3'));
  });

  // 12. One-day schedule returns exactly 1 day
  await t.test('12. one-day schedule returns exactly 1 day', async () => {
    const requirements = [{ id: 'r1', priority: 'must', text: 'R1' }];
    const questions = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'P1', answer_outline: 'A1', difficulty: 2 },
      { id: 'q2', requirement_ids: ['r1'], category: 'technical', prompt: 'P2', answer_outline: 'A2', difficulty: 3 }
    ];

    const schedule = generateSchedule({
      daysAvailable: 1,
      requirements,
      questions
    });

    assert.equal(schedule.days_available, 1);
    assert.equal(schedule.days.length, 1);
    assert.equal(schedule.days[0].day, 1);
    assert.deepEqual(schedule.days[0].question_ids, ['q2', 'q1']); // q2 is difficulty 3 (harder first)
    assert.equal(schedule.days[0].minutes, 60);
  });

  // 13. Five-day schedule returns exactly 5 days
  await t.test('13. five-day schedule returns exactly 5 days', async () => {
    const requirements = [{ id: 'r1', priority: 'must', text: 'R1' }];
    const questions = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'P1', answer_outline: 'A1', difficulty: 2 }
    ];

    const schedule = generateSchedule({
      daysAvailable: 5,
      requirements,
      questions
    });

    assert.equal(schedule.days_available, 5);
    assert.equal(schedule.days.length, 5);
    for (let i = 0; i < 5; i++) {
      assert.equal(schedule.days[i].day, i + 1);
      assert.equal(schedule.days[i].minutes, 60);
      assert.ok(schedule.days[i].focus);
    }
  });

  // 14. Sixty-day schedule returns exactly 60 days
  await t.test('14. sixty-day schedule returns exactly 60 days', async () => {
    const requirements = [{ id: 'r1', priority: 'must', text: 'R1' }];
    const questions = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'P1', answer_outline: 'A1', difficulty: 2 }
    ];

    const schedule = generateSchedule({
      daysAvailable: 60,
      requirements,
      questions
    });

    assert.equal(schedule.days_available, 60);
    assert.equal(schedule.days.length, 60);
    assert.equal(schedule.days[59].day, 60);
    assert.equal(schedule.days[59].minutes, 60);
  });

  // 15. Minutes are integers
  await t.test('15. minutes are integers', async () => {
    const schedule = generateSchedule({
      daysAvailable: 7,
      requirements: [{ id: 'r1', priority: 'must', text: 'R1' }],
      questions: [{ id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'P1', answer_outline: 'A1', difficulty: 2 }],
      dailyMinutes: 60
    });

    for (const day of schedule.days) {
      assert.ok(Number.isInteger(day.minutes));
      assert.equal(day.minutes, 60);
    }
  });

  // 16. must questions are scheduled earlier
  await t.test('16. must questions are scheduled earlier', async () => {
    const requirements = [
      { id: 'r1', priority: 'nice', text: 'Nice to have' },
      { id: 'r2', priority: 'must', text: 'Must have core' }
    ];
    const questions = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'Nice Q', answer_outline: 'A', difficulty: 2 },
      { id: 'q2', requirement_ids: ['r2'], category: 'technical', prompt: 'Must Q', answer_outline: 'A', difficulty: 2 }
    ];

    const schedule = generateSchedule({
      daysAvailable: 2,
      requirements,
      questions
    });

    assert.deepEqual(schedule.days[0].question_ids, ['q2']); // Must question on Day 1
    assert.deepEqual(schedule.days[1].question_ids, ['q1']); // Nice question on Day 2
  });

  // 17. harder questions are scheduled earlier within equivalent priority
  await t.test('17. harder questions are scheduled earlier within equivalent priority', async () => {
    const requirements = [{ id: 'r1', priority: 'must', text: 'Must have core' }];
    const questions = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'Easy', answer_outline: 'A', difficulty: 1 },
      { id: 'q2', requirement_ids: ['r1'], category: 'technical', prompt: 'Medium', answer_outline: 'A', difficulty: 2 },
      { id: 'q3', requirement_ids: ['r1'], category: 'technical', prompt: 'Hard', answer_outline: 'A', difficulty: 3 }
    ];

    const schedule = generateSchedule({
      daysAvailable: 3,
      requirements,
      questions
    });

    assert.deepEqual(schedule.days[0].question_ids, ['q3']); // Difficulty 3 on Day 1
    assert.deepEqual(schedule.days[1].question_ids, ['q2']); // Difficulty 2 on Day 2
    assert.deepEqual(schedule.days[2].question_ids, ['q1']); // Difficulty 1 on Day 3
  });

  // 18. schedule question IDs all exist
  await t.test('18. schedule question IDs all exist', async () => {
    const requirements = [{ id: 'r1', priority: 'must', text: 'R1' }];
    const questions = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'P1', answer_outline: 'A', difficulty: 2 },
      { id: 'q2', requirement_ids: ['r1'], category: 'technical', prompt: 'P2', answer_outline: 'A', difficulty: 2 }
    ];

    const schedule = generateSchedule({
      daysAvailable: 4,
      requirements,
      questions
    });

    const knownQIds = new Set(questions.map((q) => q.id));
    for (const day of schedule.days) {
      for (const qId of day.question_ids) {
        assert.ok(knownQIds.has(qId), `Scheduled question ID ${qId} must exist in kit questions`);
      }
    }
  });

  // 19. Repeated schedule generation produces identical output (no random ordering)
  await t.test('19. repeated schedule generation produces identical output', async () => {
    const requirements = [
      { id: 'r1', priority: 'must', text: 'R1' },
      { id: 'r2', priority: 'should', text: 'R2' }
    ];
    const questions = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'Q1', answer_outline: 'A1', difficulty: 2 },
      { id: 'q2', requirement_ids: ['r2'], category: 'behavioral', prompt: 'Q2', answer_outline: 'A2', difficulty: 2 },
      { id: 'q3', requirement_ids: ['r1'], category: 'technical', prompt: 'Q3', answer_outline: 'A3', difficulty: 3 }
    ];

    const scheduleA = generateSchedule({ daysAvailable: 5, requirements, questions });
    const scheduleB = generateSchedule({ daysAvailable: 5, requirements, questions });

    assert.deepEqual(scheduleA, scheduleB);
  });

  // 20. Thin data does not fabricate questions
  await t.test('20. thin data does not fabricate questions', async () => {
    const schedule = generateSchedule({
      daysAvailable: 10,
      requirements: [{ id: 'r1', priority: 'must', text: 'Only one requirement' }],
      questions: [{ id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'Single Q', answer_outline: 'A', difficulty: 2 }]
    });

    assert.equal(schedule.days_available, 10);
    assert.equal(schedule.days.length, 10);
    assert.deepEqual(schedule.days[0].question_ids, ['q1']);
    // Days 2 to 10 have empty question_ids, no fabricated questions
    for (let d = 1; d < 10; d++) {
      assert.deepEqual(schedule.days[d].question_ids, []);
      assert.equal(schedule.days[d].minutes, 60);
      assert.ok(schedule.days[d].focus);
    }
  });

  // 21. Full Step 7 pipeline executes and persists coverage & schedule into kit document
  await t.test('21. full Step 7 pipeline persists questions, flashcards, coverage, and schedule to MongoDB', async () => {
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
    assert.ok(genResult.kit.coverage);
    assert.ok(Array.isArray(genResult.kit.coverage.uncovered_requirement_ids));
    assert.ok(genResult.kit.coverage.passes >= 1 && genResult.kit.coverage.passes <= 2);
    assert.ok(genResult.kit.schedule);
    assert.equal(genResult.kit.schedule.days_available, 5);
    assert.equal(genResult.kit.schedule.days.length, 5);

    // Verify in MongoDB
    const persistedKit = await db.collection('kits').findOne({ _id: new ObjectId(createdKitIdUserA) });
    assert.ok(persistedKit.coverage);
    assert.ok(persistedKit.schedule);
    assert.equal(persistedKit.schedule.days.length, 5);
    assert.equal(persistedKit.status, 'ready');

    const completedJob = await db.collection('generation_jobs').findOne({ _id: new ObjectId(createdJobIdUserA) });
    assert.equal(completedJob.status, 'completed');
    assert.equal(completedJob.stage, 'generation_completed');
    assert.equal(completedJob.progress, 100);
  });

  // 22. Multi-tenant ownership remains enforced
  await t.test('22. multi-tenant ownership remains enforced for Step 7', async () => {
    const res = await request(app)
      .post(`/api/kits/${createdKitIdUserA}/generate`)
      .set('Cookie', cookieUserB);

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  t.after(() => {
    setDefaultProvider(null);
  });
});
