import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { generateStructured, isTransient503Error } from '../src/providers/llmProvider.js';
import { MockLlmProvider } from '../src/providers/mockProvider.js';
import { LlmError, LLM_ERROR_CODES } from '../src/providers/gemini.js';
import { generateQuestions } from '../src/pipeline/generation/questionGeneration.js';
import { generateFlashcards } from '../src/pipeline/generation/flashcardGeneration.js';

test('Gemini 503 Safe Fallback Test Suite', async (t) => {
  const primaryModel = 'gemini-3.6-flash';
  const fallbackModel = 'gemini-3.5-flash-lite';

  await t.test('1. isTransient503Error accurately identifies 503 and unavailable conditions', () => {
    assert.equal(isTransient503Error(new LlmError('503 Service Unavailable', LLM_ERROR_CODES.PROVIDER_ERROR, 503)), true);
    assert.equal(isTransient503Error(new Error('This model is currently experiencing high demand. Please try again later.')), true);
    assert.equal(isTransient503Error(new Error('Resource UNAVAILABLE: backend overloaded')), true);
    
    // Negative cases (must NOT trigger fallback)
    assert.equal(isTransient503Error(new LlmError('Invalid API Key', LLM_ERROR_CODES.CONFIGURATION_ERROR, 401)), false);
    assert.equal(isTransient503Error(new LlmError('Bad request syntax', LLM_ERROR_CODES.PROVIDER_ERROR, 400)), false);
    assert.equal(isTransient503Error(new LlmError('Permission denied', LLM_ERROR_CODES.PROVIDER_ERROR, 403)), false);
    assert.equal(isTransient503Error(new LlmError('Schema validation failed', LLM_ERROR_CODES.SCHEMA_INVALID, 422)), false);
    assert.equal(isTransient503Error(new LlmError('Failed to parse model response as JSON', LLM_ERROR_CODES.INVALID_JSON, 500)), false);
    assert.equal(isTransient503Error(null), false);
  });

  await t.test('2. generateStructured falls back to fallbackModel when primary model returns 503', async () => {
    const mock = new MockLlmProvider();
    
    // Primary model 3.6 throws 503, fallback model 3.5 succeeds
    mock.setOverrideHandler(({ model }) => {
      if (model === primaryModel) {
        throw new LlmError(
          'Gemini API returned error HTTP 503: This model is currently experiencing high demand.',
          LLM_ERROR_CODES.PROVIDER_ERROR,
          503
        );
      }
      return JSON.stringify({ result: 'success_from_fallback', model_used: model });
    });

    const output = await generateStructured({
      system: 'Test system instruction',
      input: 'Test input prompt',
      schema: z.object({ result: z.string(), model_used: z.string() }),
      model: primaryModel,
      fallbackModel,
      provider: mock,
      maxRetries: 2
    });

    assert.equal(output.result, 'success_from_fallback');
    assert.equal(output.model_used, fallbackModel);

    // Verify history: 2 attempts on primaryModel (initial + retry), then 1 attempt on fallbackModel
    assert.equal(mock.history.length, 3);
    assert.equal(mock.history[0].model, primaryModel);
    assert.equal(mock.history[1].model, primaryModel);
    assert.equal(mock.history[2].model, fallbackModel);
  });

  await t.test('3. generateStructured does NOT trigger fallback on non-503 errors (e.g. 422 schema invalid)', async () => {
    const mock = new MockLlmProvider();

    // Primary model returns invalid JSON syntax
    mock.setOverrideHandler(() => {
      return '{ invalid json structure ';
    });

    await assert.rejects(
      async () => {
        await generateStructured({
          system: 'Test system instruction',
          input: 'Test input prompt',
          model: primaryModel,
          fallbackModel,
          provider: mock,
          maxRetries: 1
        });
      },
      (err) => {
        assert.equal(err.code, LLM_ERROR_CODES.INVALID_JSON);
        return true;
      }
    );

    // Only attempted primaryModel once, never invoked fallbackModel
    assert.equal(mock.history.length, 1);
    assert.equal(mock.history[0].model, primaryModel);
  });

  await t.test('4. generateStructured does NOT make duplicate requests when primary model succeeds', async () => {
    const mock = new MockLlmProvider();
    mock.setOverrideHandler(({ model }) => {
      return JSON.stringify({ status: 'ok', model });
    });

    const output = await generateStructured({
      system: 'Test system instruction',
      input: 'Test input prompt',
      model: primaryModel,
      fallbackModel,
      provider: mock,
      maxRetries: 2
    });

    assert.equal(output.status, 'ok');
    assert.equal(output.model, primaryModel);
    assert.equal(mock.history.length, 1);
    assert.equal(mock.history[0].model, primaryModel);
  });

  await t.test('5. generateQuestions falls back to gemini-3.5-flash-lite on 503 and produces valid questions', async () => {
    const mock = new MockLlmProvider();
    mock.setOverrideHandler(({ system, input, model }) => {
      if (model === primaryModel) {
        throw new LlmError(
          'Gemini API returned error HTTP 503: Service Unavailable',
          LLM_ERROR_CODES.PROVIDER_ERROR,
          503
        );
      }
      return JSON.stringify({
        questions: [
          {
            requirement_ids: ['r1'],
            category: 'technical',
            prompt: 'Explain Node.js event loop microtasks vs macrotasks.',
            answer_outline: 'Discuss timers, I/O, process.nextTick, Promise resolution order.',
            difficulty: 2
          }
        ]
      });
    });

    const questions = await generateQuestions({
      role: {
        title: 'Backend Engineer',
        seniority: 'Senior',
        requirements: [{ id: 'r1', text: 'Node.js event loop expertise', kind: 'technical', priority: 'must' }]
      },
      options: {
        provider: mock,
        model: primaryModel,
        fallbackModel,
        maxRetries: 1
      }
    });

    assert.ok(Array.isArray(questions));
    assert.equal(questions.length, 1);
    assert.equal(questions[0].id, 'q1');
    assert.deepEqual(questions[0].requirement_ids, ['r1']);
    assert.equal(questions[0].difficulty, 2);

    // Verify fallback model was called
    const fallbackCall = mock.history.find((h) => h.model === fallbackModel);
    assert.ok(fallbackCall, 'Expected fallback model to be called');
  });

  await t.test('6. generateFlashcards falls back to gemini-3.5-flash-lite on 503 and produces valid cards', async () => {
    const mock = new MockLlmProvider();
    mock.setOverrideHandler(({ model }) => {
      if (model === primaryModel) {
        throw new LlmError(
          'Gemini API returned error HTTP 503: Service Unavailable',
          LLM_ERROR_CODES.PROVIDER_ERROR,
          503
        );
      }
      return JSON.stringify({
        flashcards: [
          {
            front: 'What is the MongoDB ESR rule?',
            back: 'Equality first, Sort second, Range third.',
            requirement_ids: ['r2']
          }
        ]
      });
    });

    const flashcards = await generateFlashcards({
      requirements: [{ id: 'r2', text: 'MongoDB indexing', kind: 'database', priority: 'must' }],
      options: {
        provider: mock,
        model: primaryModel,
        fallbackModel,
        maxRetries: 1
      }
    });

    assert.ok(Array.isArray(flashcards));
    assert.equal(flashcards.length, 1);
    assert.equal(flashcards[0].id, 'f1');
    assert.deepEqual(flashcards[0].requirement_ids, ['r2']);

    const fallbackCall = mock.history.find((h) => h.model === fallbackModel);
    assert.ok(fallbackCall, 'Expected fallback model to be called for flashcards');
  });
});
