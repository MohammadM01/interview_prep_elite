import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import app from '../src/app.js';
import { connectToDatabase, getDatabase } from '../src/config/database.js';
import { mergeGeneratedContent } from '../src/pipeline/generation/mergeContent.js';
import { MockLlmProvider } from '../src/providers/mockProvider.js';
import { setDefaultProvider } from '../src/providers/llmProvider.js';

test('Step 8 Builder Mode & Editable State Suite', async (t) => {
  let db;
  let cookieUserA;
  let cookieUserB;
  let userAId;
  let userBId;
  let kitIdUserA;

  await t.test('Setup: register User A & B, create seed kit with questions, flashcards, schedule', async () => {
    await connectToDatabase();
    db = getDatabase();
    setDefaultProvider(new MockLlmProvider());

    const emailA = `step8_userA_${Date.now()}@example.com`;
    const resA = await request(app)
      .post('/api/auth/register')
      .send({ email: emailA, password: 'password123' });
    assert.equal(resA.status, 201);
    cookieUserA = resA.headers['set-cookie'][0];
    userAId = resA.body.user.id;

    const emailB = `step8_userB_${Date.now()}@example.com`;
    const resB = await request(app)
      .post('/api/auth/register')
      .send({ email: emailB, password: 'password123' });
    assert.equal(resB.status, 201);
    cookieUserB = resB.headers['set-cookie'][0];
    userBId = resB.body.user.id;

    // Seed a complete kit in MongoDB for User A
    const kitDoc = {
      user_id: new ObjectId(userAId),
      status: 'ready',
      source: { company_url: 'https://example.com' },
      input: { jd: 'Senior Backend Engineer', company_url: 'https://example.com', days_available: 3 },
      company_brief: {
        company: 'Example Corp',
        role: 'Senior Backend Engineer',
        seniority: 'Senior',
        company_summary: 'Leading cloud services',
        what_they_do: 'Distributed compute platforms',
        sources: ['https://example.com']
      },
      role: {
        title: 'Senior Backend Engineer',
        seniority: 'Senior',
        responsibilities: ['Build APIs', 'Scale database'],
        requirements: [
          { id: 'r1', priority: 'must', kind: 'technical', text: 'Node.js & MongoDB' },
          { id: 'r2', priority: 'should', kind: 'system_design', text: 'Distributed caching' },
          { id: 'r3', priority: 'nice', kind: 'behavioral', text: 'Team mentoring' }
        ]
      },
      questions: [
        {
          id: 'q1',
          category: 'technical',
          prompt: 'How does the Node.js event loop work?',
          answer_outline: 'Explain timers, poll, check, and microtask queues.',
          difficulty: 2,
          state: 'generated',
          requirement_ids: ['r1']
        },
        {
          id: 'q2',
          category: 'system_design',
          prompt: 'How would you design a distributed cache with Redis?',
          answer_outline: 'Discuss eviction policies, cache invalidation, and replication.',
          difficulty: 3,
          state: 'generated',
          requirement_ids: ['r2']
        }
      ],
      flashcards: [
        {
          id: 'f1',
          front: 'What is libuv?',
          back: 'A multi-platform support library focused on asynchronous I/O.',
          state: 'generated',
          requirement_ids: ['r1']
        },
        {
          id: 'f2',
          front: 'What is Redis Sentinel?',
          back: 'Provides high availability for Redis through automatic failover.',
          state: 'generated',
          requirement_ids: ['r2']
        }
      ],
      schedule: {
        total_days: 2,
        days: [
          { day: 1, focus: 'Node.js Core', question_ids: ['q1'], minutes: 45 },
          { day: 2, focus: 'System Design', question_ids: ['q2'], minutes: 45 }
        ]
      },
      coverage: {
        passes: 1,
        uncovered_requirement_ids: ['r3']
      },
      created_at: new Date(),
      updated_at: new Date()
    };

    const insertRes = await db.collection('kits').insertOne(kitDoc);
    kitIdUserA = insertRes.insertedId.toString();
  });

  // 1. authenticated user can update own kit
  await t.test('1. authenticated user can update own kit', async () => {
    const res = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA)
      .send({
        questions: [
          {
            id: 'q1',
            category: 'technical',
            prompt: 'Updated question prompt about event loop?',
            answer_outline: 'Updated outline',
            difficulty: 3,
            state: 'edited',
            requirement_ids: ['r1']
          },
          {
            id: 'q2',
            category: 'system_design',
            prompt: 'How would you design a distributed cache with Redis?',
            answer_outline: 'Discuss eviction policies, cache invalidation, and replication.',
            difficulty: 3,
            state: 'generated',
            requirement_ids: ['r2']
          }
        ]
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.kit.questions[0].prompt, 'Updated question prompt about event loop?');
    assert.equal(res.body.kit.questions[0].state, 'edited');
    assert.equal(res.body.kit.questions[0].difficulty, 3);
  });

  // 2. unauthenticated update is rejected
  await t.test('2. unauthenticated update is rejected', async () => {
    const res = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .send({
        questions: []
      });

    assert.equal(res.status, 401);
  });

  // 3. user cannot update another user kit
  await t.test('3. user cannot update another user kit', async () => {
    const res = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserB)
      .send({
        questions: []
      });

    assert.equal(res.status, 404);
  });

  // 4. invalid kit update is rejected
  await t.test('4. invalid kit update is rejected', async () => {
    const res = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA)
      .send({
        questions: [
          {
            id: 'q1',
            category: 'technical',
            prompt: '', // Empty prompt is invalid
            answer_outline: 'Test',
            difficulty: 99, // Invalid difficulty
            requirement_ids: ['r1']
          }
        ]
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  // 5. question edit persists
  await t.test('5. question edit persists across GET requests', async () => {
    const patchRes = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA)
      .send({
        questions: [
          {
            id: 'q1',
            category: 'technical',
            prompt: 'In-depth explanation of microtasks in Node.js?',
            answer_outline: 'process.nextTick vs Promise microtasks.',
            difficulty: 3,
            state: 'edited',
            requirement_ids: ['r1']
          },
          {
            id: 'q2',
            category: 'system_design',
            prompt: 'How would you design a distributed cache with Redis?',
            answer_outline: 'Discuss eviction policies, cache invalidation, and replication.',
            difficulty: 3,
            state: 'generated',
            requirement_ids: ['r2']
          }
        ]
      });
    assert.equal(patchRes.status, 200);

    const getRes = await request(app)
      .get(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.kit.questions[0].prompt, 'In-depth explanation of microtasks in Node.js?');
    assert.equal(getRes.body.kit.questions[0].answer_outline, 'process.nextTick vs Promise microtasks.');
    assert.equal(getRes.body.kit.questions[0].state, 'edited');
  });

  // 6. question reorder persists
  await t.test('6. question reorder persists with existing IDs', async () => {
    // Current order: [q1, q2]. Reorder to: [q2, q1]
    const patchRes = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA)
      .send({
        questions: [
          {
            id: 'q2',
            category: 'system_design',
            prompt: 'How would you design a distributed cache with Redis?',
            answer_outline: 'Discuss eviction policies, cache invalidation, and replication.',
            difficulty: 3,
            state: 'generated',
            requirement_ids: ['r2']
          },
          {
            id: 'q1',
            category: 'technical',
            prompt: 'In-depth explanation of microtasks in Node.js?',
            answer_outline: 'process.nextTick vs Promise microtasks.',
            difficulty: 3,
            state: 'edited',
            requirement_ids: ['r1']
          }
        ]
      });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.kit.questions[0].id, 'q2');
    assert.equal(patchRes.body.kit.questions[1].id, 'q1');

    const getRes = await request(app)
      .get(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA);
    assert.equal(getRes.body.kit.questions[0].id, 'q2');
    assert.equal(getRes.body.kit.questions[1].id, 'q1');
  });

  // 7. question deletion persists
  await t.test('7. question deletion persists', async () => {
    // Delete q2, keeping only q1
    const patchRes = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA)
      .send({
        questions: [
          {
            id: 'q1',
            category: 'technical',
            prompt: 'In-depth explanation of microtasks in Node.js?',
            answer_outline: 'process.nextTick vs Promise microtasks.',
            difficulty: 3,
            state: 'edited',
            requirement_ids: ['r1']
          }
        ]
      });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.kit.questions.length, 1);
    assert.equal(patchRes.body.kit.questions[0].id, 'q1');

    const getRes = await request(app)
      .get(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA);
    assert.equal(getRes.body.kit.questions.length, 1);
    assert.equal(getRes.body.kit.questions[0].id, 'q1');
  });

  // 8. flashcard edit persists
  await t.test('8. flashcard edit persists', async () => {
    const patchRes = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA)
      .send({
        flashcards: [
          {
            id: 'f1',
            front: 'Updated Front: What is libuv?',
            back: 'Updated Back: Node asynchronous I/O engine.',
            state: 'edited',
            requirement_ids: ['r1']
          },
          {
            id: 'f2',
            front: 'What is Redis Sentinel?',
            back: 'Provides high availability for Redis through automatic failover.',
            state: 'generated',
            requirement_ids: ['r2']
          }
        ]
      });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.kit.flashcards[0].front, 'Updated Front: What is libuv?');
    assert.equal(patchRes.body.kit.flashcards[0].back, 'Updated Back: Node asynchronous I/O engine.');
    assert.equal(patchRes.body.kit.flashcards[0].state, 'edited');
  });

  // 9. pinned question state persists
  await t.test('9. pinned question state persists', async () => {
    const patchRes = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA)
      .send({
        questions: [
          {
            id: 'q1',
            category: 'technical',
            prompt: 'In-depth explanation of microtasks in Node.js?',
            answer_outline: 'process.nextTick vs Promise microtasks.',
            difficulty: 3,
            state: 'pinned',
            requirement_ids: ['r1']
          },
          {
            id: 'q_manual_001',
            category: 'system_design',
            prompt: 'How to scale MongoDB replica sets?',
            answer_outline: 'Discuss read preferences, chunking, and shard keys.',
            difficulty: 2,
            state: 'pinned',
            requirement_ids: ['r1']
          }
        ]
      });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.kit.questions[0].state, 'pinned');
    assert.equal(patchRes.body.kit.questions[1].state, 'pinned');
    assert.equal(patchRes.body.kit.questions[1].id, 'q_manual_001');
  });

  // 10. pinned flashcard state persists
  await t.test('10. pinned flashcard state persists', async () => {
    const patchRes = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA)
      .send({
        flashcards: [
          {
            id: 'f1',
            front: 'What is libuv?',
            back: 'Node I/O library.',
            state: 'pinned',
            requirement_ids: ['r1']
          },
          {
            id: 'f_manual_001',
            front: 'What is write concern in MongoDB?',
            back: 'Level of acknowledgment requested from MongoDB for write operations.',
            state: 'pinned',
            requirement_ids: ['r1']
          }
        ]
      });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.kit.flashcards[0].state, 'pinned');
    assert.equal(patchRes.body.kit.flashcards[1].state, 'pinned');
    assert.equal(patchRes.body.kit.flashcards[1].id, 'f_manual_001');
  });

  // 11. duplicate IDs are rejected
  await t.test('11. duplicate IDs are rejected', async () => {
    // Duplicate question ID
    const resQ = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA)
      .send({
        questions: [
          {
            id: 'q1',
            category: 'technical',
            prompt: 'Prompt 1',
            answer_outline: 'Outline 1',
            difficulty: 1,
            requirement_ids: ['r1']
          },
          {
            id: 'q1', // Duplicate ID
            category: 'technical',
            prompt: 'Prompt 2',
            answer_outline: 'Outline 2',
            difficulty: 2,
            requirement_ids: ['r1']
          }
        ]
      });
    assert.equal(resQ.status, 400);
    assert.match(resQ.body.error.message, /duplicate.*q1/i);

    // Duplicate flashcard ID
    const resF = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA)
      .send({
        flashcards: [
          { id: 'f1', front: 'Front 1', back: 'Back 1', requirement_ids: ['r1'] },
          { id: 'f1', front: 'Front 2', back: 'Back 2', requirement_ids: ['r1'] }
        ]
      });
    assert.equal(resF.status, 400);
    assert.match(resF.body.error.message, /duplicate.*f1/i);
  });

  // 12. schedule references remain valid after question deletion/update
  await t.test('12. schedule references remain valid after question deletion', async () => {
    // Notice earlier schedule was:
    // Day 1: [q1], Day 2: [q2]
    // If we only keep question 'q1', Day 2's question_ids must not include 'q2'
    const patchRes = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA)
      .send({
        questions: [
          {
            id: 'q1',
            category: 'technical',
            prompt: 'Single question left',
            answer_outline: 'Outline',
            difficulty: 2,
            requirement_ids: ['r1']
          }
        ]
      });
    assert.equal(patchRes.status, 200);

    const getRes = await request(app)
      .get(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA);
    const schedule = getRes.body.kit.schedule;
    assert.ok(schedule);
    const day1 = schedule.days.find((d) => d.day === 1);
    const day2 = schedule.days.find((d) => d.day === 2);
    assert.deepEqual(day1.question_ids, ['q1']);
    // 'q2' should have been pruned cleanly
    assert.deepEqual(day2.question_ids, []);
  });

  // 13. requirement references remain valid
  await t.test('13. requirement references remain valid', async () => {
    const res = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA)
      .send({
        questions: [
          {
            id: 'q1',
            category: 'technical',
            prompt: 'Question referencing nonexistent requirement',
            answer_outline: 'Outline',
            difficulty: 2,
            requirement_ids: ['r999_nonexistent']
          }
        ]
      });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /r999_nonexistent/i);
  });

  // 14. generated / edited / pinned states validate correctly
  await t.test('14. generated / edited / pinned states validate correctly', async () => {
    // Valid states
    for (const validState of ['generated', 'edited', 'pinned']) {
      const res = await request(app)
        .patch(`/api/kits/${kitIdUserA}`)
        .set('Cookie', cookieUserA)
        .send({
          questions: [
            {
              id: 'q1',
              category: 'technical',
              prompt: `Question with state ${validState}`,
              answer_outline: 'Outline',
              difficulty: 1,
              state: validState,
              requirement_ids: ['r1']
            }
          ]
        });
      assert.equal(res.status, 200);
      assert.equal(res.body.kit.questions[0].state, validState);
    }

    // Invalid state
    const resInvalid = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA)
      .send({
        questions: [
          {
            id: 'q1',
            category: 'technical',
            prompt: 'Invalid state test',
            answer_outline: 'Outline',
            difficulty: 1,
            state: 'random_bad_state',
            requirement_ids: ['r1']
          }
        ]
      });
    assert.equal(resInvalid.status, 400);
  });

  // 14b. requirements editing (text, kind, priority) persists and recalculates coverage
  await t.test('14b. requirements editing (text, kind, priority) persists and recalculates coverage', async () => {
    const res = await request(app)
      .patch(`/api/kits/${kitIdUserA}`)
      .set('Cookie', cookieUserA)
      .send({
        role: {
          requirements: [
            { id: 'r1', priority: 'must', kind: 'technical', text: 'Deep Node.js internals' },
            { id: 'r2', priority: 'must', kind: 'system_design', text: 'Distributed caching architectures' }
          ]
        },
        questions: [
          {
            id: 'q1',
            category: 'technical',
            prompt: 'Explain event loop',
            answer_outline: 'Timers and microtasks',
            difficulty: 2,
            requirement_ids: ['r1']
          }
        ]
      });

    assert.equal(res.status, 200);
    const updatedKit = res.body.kit;
    assert.equal(updatedKit.role.requirements.length, 2);
    assert.equal(updatedKit.role.requirements[0].text, 'Deep Node.js internals');
    assert.equal(updatedKit.role.requirements[1].priority, 'must');
    // Coverage should recalculate: r2 is 'must' and has no question, so it should be uncovered
    assert.ok(updatedKit.coverage.uncovered_requirement_ids.includes('r2'));
  });

  // 15. Regeneration safe: mergeGeneratedContent preserves pinned & edited items
  await t.test('15. mergeGeneratedContent deterministically preserves pinned and edited content', async () => {
    const existingQuestions = [
      {
        id: 'q1',
        prompt: 'Pinned prompt by user',
        category: 'technical',
        difficulty: 3,
        state: 'pinned',
        requirement_ids: ['r1']
      },
      {
        id: 'q2',
        prompt: 'User edited prompt',
        category: 'behavioral',
        difficulty: 1,
        state: 'edited',
        requirement_ids: ['r3']
      },
      {
        id: 'q3',
        prompt: 'Old AI generated prompt to be replaced',
        category: 'system_design',
        difficulty: 2,
        state: 'generated',
        requirement_ids: ['r2']
      }
    ];

    const newQuestions = [
      {
        id: 'q1', // ID collision with pinned
        prompt: 'Brand new AI prompt A',
        category: 'system_design',
        difficulty: 2,
        state: 'generated',
        requirement_ids: ['r2']
      },
      {
        id: 'q2', // ID collision with edited
        prompt: 'Brand new AI prompt B',
        category: 'technical',
        difficulty: 1,
        state: 'generated',
        requirement_ids: ['r1']
      }
    ];

    const result = mergeGeneratedContent({
      existingQuestions,
      newQuestions,
      existingFlashcards: [],
      newFlashcards: []
    });

    // Pinned and edited items MUST be preserved
    assert.equal(result.questions.length, 4);
    assert.equal(result.questions[0].id, 'q1');
    assert.equal(result.questions[0].state, 'pinned');
    assert.equal(result.questions[0].prompt, 'Pinned prompt by user');

    assert.equal(result.questions[1].id, 'q2');
    assert.equal(result.questions[1].state, 'edited');
    assert.equal(result.questions[1].prompt, 'User edited prompt');

    // New AI questions get sequential non-colliding IDs: q4, q5
    assert.equal(result.questions[2].id, 'q4');
    assert.equal(result.questions[2].prompt, 'Brand new AI prompt A');
    assert.equal(result.questions[3].id, 'q5');
    assert.equal(result.questions[3].prompt, 'Brand new AI prompt B');

    // Old unpinned generated q3 is replaced
    const foundOldQ3 = result.questions.some((q) => q.prompt === 'Old AI generated prompt to be replaced');
    assert.equal(foundOldQ3, false);
  });
});
