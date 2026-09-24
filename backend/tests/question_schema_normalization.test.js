import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RawQuestionItemSchema,
  QuestionGenerationOutputSchema,
  QuestionItemSchema
} from '../src/pipeline/generation/schemas.js';
import {
  generateQuestions,
  validateAndAssignQuestionIds
} from '../src/pipeline/generation/questionGeneration.js';
import { MockLlmProvider } from '../src/providers/mockProvider.js';
import { LlmError, LLM_ERROR_CODES } from '../src/providers/gemini.js';

test('Question Schema Normalization & answer_outline Robustness Suite', async (t) => {
  const validRequirementIds = new Set(['r1', 'r2']);

  // TEST 1: Gemini returns string answer_outline -> remains string
  await t.test('TEST 1: Gemini returns string answer_outline -> remains string', () => {
    const rawInput = {
      requirement_ids: ['r1'],
      category: 'technical',
      prompt: 'Explain how Node.js clusters handle incoming TCP connections.',
      answer_outline: 'Explain master process, worker IPC, SO_REUSEPORT, round-robin distribution.',
      difficulty: 3
    };

    const parsed = RawQuestionItemSchema.parse(rawInput);
    assert.equal(typeof parsed.answer_outline, 'string');
    assert.equal(parsed.answer_outline, 'Explain master process, worker IPC, SO_REUSEPORT, round-robin distribution.');

    const validated = validateAndAssignQuestionIds([parsed], validRequirementIds);
    assert.equal(typeof validated[0].answer_outline, 'string');
    assert.equal(validated[0].answer_outline, 'Explain master process, worker IPC, SO_REUSEPORT, round-robin distribution.');
  });

  // TEST 2: Gemini returns array of strings -> normalized to one string joined with "; "
  await t.test('TEST 2: Gemini returns array of strings -> normalized to one joined string', () => {
    const rawInput = {
      requirement_ids: ['r1'],
      category: 'technical',
      prompt: 'Explain database indexing principles with MongoDB ESR rule.',
      answer_outline: [
        'Explain Equality first',
        'Sort second',
        'Range third'
      ],
      difficulty: 2
    };

    const parsed = RawQuestionItemSchema.parse(rawInput);
    assert.equal(typeof parsed.answer_outline, 'string');
    assert.equal(parsed.answer_outline, 'Explain Equality first; Sort second; Range third');

    const validated = validateAndAssignQuestionIds([parsed], validRequirementIds);
    assert.equal(typeof validated[0].answer_outline, 'string');
    assert.equal(validated[0].answer_outline, 'Explain Equality first; Sort second; Range third');
  });

  // TEST 3: Gemini returns empty array -> rejected with validation error
  await t.test('TEST 3: Gemini returns empty array -> rejected', () => {
    const rawInputEmpty = {
      requirement_ids: ['r1'],
      category: 'technical',
      prompt: 'Valid prompt testing empty array rejection.',
      answer_outline: [],
      difficulty: 1
    };

    assert.throws(
      () => RawQuestionItemSchema.parse(rawInputEmpty),
      /Answer outline must be at least 5 characters/
    );

    const rawInputWhitespaceOnly = {
      requirement_ids: ['r1'],
      category: 'technical',
      prompt: 'Valid prompt testing whitespace array rejection.',
      answer_outline: ['', '   '],
      difficulty: 1
    };

    assert.throws(
      () => RawQuestionItemSchema.parse(rawInputWhitespaceOnly),
      /Answer outline must be at least 5 characters/
    );
  });

  // TEST 4: Gemini returns invalid type/object -> rejected
  await t.test('TEST 4: Gemini returns invalid type/object -> rejected', () => {
    const rawInputObject = {
      requirement_ids: ['r1'],
      category: 'technical',
      prompt: 'Valid prompt testing object rejection.',
      answer_outline: { step1: 'Explain this', step2: 'Explain that' },
      difficulty: 2
    };

    assert.throws(
      () => RawQuestionItemSchema.parse(rawInputObject),
      /expected string/i
    );

    const rawInputNumber = {
      requirement_ids: ['r1'],
      category: 'technical',
      prompt: 'Valid prompt testing number rejection.',
      answer_outline: 12345,
      difficulty: 2
    };

    assert.throws(
      () => RawQuestionItemSchema.parse(rawInputNumber),
      /expected string/i
    );

    const rawInputNull = {
      requirement_ids: ['r1'],
      category: 'technical',
      prompt: 'Valid prompt testing null rejection.',
      answer_outline: null,
      difficulty: 2
    };

    assert.throws(
      () => RawQuestionItemSchema.parse(rawInputNull),
      /expected string/i
    );
  });

  // TEST 5: Normalized question passes existing QuestionItemSchema
  await t.test('TEST 5: Normalized question passes the existing QuestionItemSchema', () => {
    const rawOutputWithArray = {
      questions: [
        {
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'What are the main advantages of asynchronous I/O in Node.js?',
          answer_outline: [
            'Non-blocking event loop execution',
            'Efficient thread utilization without thread-per-request overhead',
            'High concurrency handling for I/O bound workloads'
          ],
          difficulty: 2
        }
      ]
    };

    const parsedBatch = QuestionGenerationOutputSchema.parse(rawOutputWithArray);
    const assignedQuestions = validateAndAssignQuestionIds(parsedBatch.questions, validRequirementIds);

    assert.equal(assignedQuestions.length, 1);
    const q1 = assignedQuestions[0];

    // Validate against QuestionItemSchema
    const finalValidated = QuestionItemSchema.parse(q1);
    assert.equal(typeof finalValidated.answer_outline, 'string');
    assert.equal(finalValidated.id, 'q1');
    assert.deepEqual(finalValidated.requirement_ids, ['r1']);
    assert.equal(
      finalValidated.answer_outline,
      'Non-blocking event loop execution; Efficient thread utilization without thread-per-request overhead; High concurrency handling for I/O bound workloads'
    );
  });

  // TEST 6: Full generated question output matches Appendix A requirements
  await t.test('TEST 6: Full generated question output matches Appendix A requirements', async () => {
    const mock = new MockLlmProvider();
    mock.setOverrideHandler(() => {
      return JSON.stringify({
        questions: [
          {
            requirement_ids: ['r1'],
            category: 'technical',
            prompt: 'Design a resilient rate limiter in Node.js with Redis.',
            answer_outline: [
              'Token bucket algorithm implementation',
              'Atomic Redis Lua scripts for concurrency safety',
              'Handling Redis connection loss gracefully'
            ],
            difficulty: 3
          }
        ]
      });
    });

    const result = await generateQuestions({
      role: {
        title: 'Senior Backend Engineer',
        seniority: 'Senior',
        requirements: [{ id: 'r1', text: 'Distributed systems & caching', kind: 'technical', priority: 'must' }]
      },
      options: { provider: mock }
    });

    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
    const q = result[0];

    // Must match Appendix A fields exactly
    assert.equal(q.id, 'q1');
    assert.deepEqual(q.requirement_ids, ['r1']);
    assert.equal(q.category, 'technical');
    assert.equal(q.prompt, 'Design a resilient rate limiter in Node.js with Redis.');
    assert.equal(typeof q.answer_outline, 'string');
    assert.equal(
      q.answer_outline,
      'Token bucket algorithm implementation; Atomic Redis Lua scripts for concurrency safety; Handling Redis connection loss gracefully'
    );
    assert.equal(q.difficulty, 3);

    // Conforms to QuestionItemSchema
    const schemaChecked = QuestionItemSchema.safeParse(q);
    assert.equal(schemaChecked.success, true);
  });

  // TEST 7: 3.6 -> 3.5 Fallback with array answer_outline works end-to-end
  await t.test('TEST 7: Fallback from gemini-3.6-flash to gemini-3.5-flash-lite normalizes array answer_outline', async () => {
    const mock = new MockLlmProvider();
    mock.setOverrideHandler(({ model }) => {
      if (model === 'gemini-3.6-flash') {
        throw new LlmError(
          'Gemini API returned error HTTP 503: This model is currently experiencing high demand.',
          LLM_ERROR_CODES.PROVIDER_ERROR,
          503
        );
      }
      // Fallback model returns questions with array answer_outline
      return JSON.stringify({
        questions: [
          {
            requirement_ids: ['r1'],
            category: 'technical',
            prompt: 'Explain ACID transactions in distributed MongoDB.',
            answer_outline: [
              'Multi-document transaction semantics',
              'Two-phase commit overhead and write concerns',
              'Transient transaction error handling'
            ],
            difficulty: 3
          }
        ]
      });
    });

    const result = await generateQuestions({
      role: {
        title: 'Backend Engineer',
        requirements: [{ id: 'r1', text: 'MongoDB ACID', kind: 'technical', priority: 'must' }]
      },
      options: {
        provider: mock,
        model: 'gemini-3.6-flash',
        fallbackModel: 'gemini-3.5-flash-lite',
        maxRetries: 1
      }
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'q1');
    assert.equal(typeof result[0].answer_outline, 'string');
    assert.equal(
      result[0].answer_outline,
      'Multi-document transaction semantics; Two-phase commit overhead and write concerns; Transient transaction error handling'
    );

    // Verify both models were invoked in sequence
    assert.equal(mock.history[0].model, 'gemini-3.6-flash');
    assert.equal(mock.history[1].model, 'gemini-3.5-flash-lite');
  });
});
