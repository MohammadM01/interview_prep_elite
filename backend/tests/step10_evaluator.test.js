import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEvaluatedKit, evaluateSingleCase } from '../../scripts/evaluate.js';
import { MockLlmProvider } from '../src/providers/mockProvider.js';

test('Step 10 Assessment Evaluator & Validation Suite', async (t) => {
  const validMockKit = {
    source: { company_url: 'https://example.com' },
    company_brief: {
      summary: 'Leading distributed systems provider.',
      what_they_do: 'Builds low-latency developer platforms.',
      sources: ['https://example.com']
    },
    role: {
      title: 'Senior Distributed Systems Engineer',
      seniority: 'Senior',
      responsibilities: ['Architect fault-tolerant clusters', 'Optimize consensus protocols'],
      requirements: [
        { id: 'r1', text: 'Proficiency in distributed systems', kind: 'technical', priority: 'must' },
        { id: 'r2', text: 'Experience with database replication', kind: 'technical', priority: 'should' },
        { id: 'r3', text: 'Strong communication and mentoring skills', kind: 'behavioral', priority: 'nice' }
      ]
    },
    questions: [
      {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Explain the Raft consensus protocol and leader election.',
        answer_outline: 'Explain terms, candidate states, split votes, heartbeats, and log replication.',
        difficulty: 3
      },
      {
        id: 'q2',
        requirement_ids: ['r2'],
        category: 'technical',
        prompt: 'How do you mitigate split-brain in multi-datacenter clusters?',
        answer_outline: 'Explain quorum requirements, fencing tokens, witness nodes, and tie-breakers.',
        difficulty: 2
      }
    ],
    flashcards: [
      {
        id: 'f1',
        front: 'What is linearizability in distributed databases?',
        back: 'A consistency model where all operations appear to execute atomically at a specific point in real time.',
        requirement_ids: ['r1']
      }
    ],
    coverage: {
      total_requirements: 3,
      covered_requirements: 2,
      coverage_percentage: 67,
      passes: 1,
      uncovered_requirement_ids: ['r3']
    },
    schedule: {
      days_available: 3,
      daily_minutes: 60,
      total_minutes: 180,
      days: [
        { day: 1, focus: 'Foundation', minutes: 60, question_ids: ['q1'] },
        { day: 2, focus: 'Deep Dive', minutes: 60, question_ids: ['q2'] },
        { day: 3, focus: 'Review', minutes: 60, question_ids: [] }
      ]
    }
  };

  await t.test('1. Valid kit passes all validation checks', () => {
    const result = validateEvaluatedKit(validMockKit, 3);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  await t.test('2. Detects duplicate requirement IDs', () => {
    const corruptedKit = JSON.parse(JSON.stringify(validMockKit));
    corruptedKit.role.requirements.push({
      id: 'r1', // duplicate
      text: 'Duplicate requirement text',
      kind: 'technical',
      priority: 'must'
    });

    const result = validateEvaluatedKit(corruptedKit, 3);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((err) => err.includes('Duplicate requirement ID: r1')));
  });

  await t.test('3. Detects question referencing non-existent requirement ID', () => {
    const corruptedKit = JSON.parse(JSON.stringify(validMockKit));
    corruptedKit.questions[0].requirement_ids = ['r999'];

    const result = validateEvaluatedKit(corruptedKit, 3);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((err) => err.includes('non-existent requirement ID: r999')));
  });

  await t.test('4. Detects flashcard referencing non-existent requirement ID', () => {
    const corruptedKit = JSON.parse(JSON.stringify(validMockKit));
    corruptedKit.flashcards[0].requirement_ids = ['r999'];

    const result = validateEvaluatedKit(corruptedKit, 3);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((err) => err.includes('non-existent requirement ID: r999')));
  });

  await t.test('5. Validates question difficulty range (1-3)', () => {
    const corruptedKit = JSON.parse(JSON.stringify(validMockKit));
    corruptedKit.questions[0].difficulty = 5;

    const result = validateEvaluatedKit(corruptedKit, 3);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((err) => err.includes('invalid difficulty: 5')));
  });

  await t.test('6. Validates positive integer schedule minutes', () => {
    const corruptedKit = JSON.parse(JSON.stringify(validMockKit));
    corruptedKit.schedule.days[0].minutes = 0;

    const result = validateEvaluatedKit(corruptedKit, 3);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((err) => err.includes('must be a positive integer')));
  });

  await t.test('7. Detects schedule referencing non-existent question ID', () => {
    const corruptedKit = JSON.parse(JSON.stringify(validMockKit));
    corruptedKit.schedule.days[0].question_ids = ['q999'];

    const result = validateEvaluatedKit(corruptedKit, 3);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((err) => err.includes('non-existent question ID: q999')));
  });

  await t.test('8. Validates requested days match schedule days length', () => {
    const corruptedKit = JSON.parse(JSON.stringify(validMockKit));
    // Kit has 3 days, but expected is 5 days
    const result = validateEvaluatedKit(corruptedKit, 5);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((err) => err.includes('does not match requested days')));
  });

  await t.test('9. evaluateSingleCase runs real pipeline and passes with MockLlmProvider', async () => {
    const testCase = {
      id: 'unit-test-case',
      jd: 'Senior Backend Engineer. Must know Node.js and MongoDB. Should know Docker.',
      company_url: 'https://example.com',
      days: 3
    };

    const mockProvider = new MockLlmProvider();
    const result = await evaluateSingleCase(testCase, { provider: mockProvider });

    assert.strictEqual(result.case_id, 'unit-test-case');
    assert.strictEqual(result.status, 'passed');
    assert.strictEqual(result.validation_errors.length, 0);
    assert.ok(result.kit);
    assert.strictEqual(result.kit.schedule.days.length, 3);
    assert.ok(result.kit.questions.length > 0);
    assert.ok(result.kit.flashcards.length > 0);
  });

  await t.test('10. evaluateSingleCase safely captures errors without throwing uncaught exceptions', async () => {
    const failingCase = {
      id: 'failing-case',
      jd: '', // empty JD triggers extraction failure
      company_url: 'https://invalid-url.test',
      days: 5
    };

    // Even if something fails, evaluateSingleCase returns a structured failure object
    const result = await evaluateSingleCase(failingCase);
    assert.strictEqual(result.case_id, 'failing-case');
    assert.strictEqual(result.status, 'failed');
    assert.ok(result.validation_errors.length > 0);
    assert.strictEqual(result.kit, null);
  });
});
