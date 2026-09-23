import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { connectToDatabase, getDatabase } from '../src/config/database.js';
import { MockLlmProvider } from '../src/providers/mockProvider.js';
import { generateStructured, LlmError, LLM_ERROR_CODES } from '../src/providers/llmProvider.js';
import { callGeminiApi } from '../src/providers/gemini.js';
import {
  extractRequirementsFromJd,
  normalizeRequirementIds
} from '../src/pipeline/generation/requirementExtraction.js';
import {
  generateCompanyBrief,
  validateAndFilterSources
} from '../src/pipeline/generation/companyBrief.js';
import { analyzeRole } from '../src/pipeline/generation/roleAnalysis.js';
import { executeKitAnalysis } from '../src/pipeline/generation/index.js';
import { CompanyBriefOutputSchema, RequirementExtractionOutputSchema } from '../src/pipeline/generation/schemas.js';

test('Step 5 LLM Extraction & Role Analysis Test Suite', async (t) => {
  await connectToDatabase();
  const db = getDatabase();

  const userAEmail = `gen.user.a.${Date.now()}@example.com`;
  const userBEmail = `gen.user.b.${Date.now()}@example.com`;
  const userPassword = 'TestPassword123!';

  let cookieUserA = null;
  let cookieUserB = null;
  let createdKitIdUserA = null;
  let createdJobIdUserA = null;

  t.after(async () => {
    if (db) {
      try {
        await db.collection('users').deleteMany({ email: { $regex: /^gen\.user\./ } });
        await db.collection('kits').deleteMany({});
        await db.collection('generation_jobs').deleteMany({});
        await db.collection('research_results').deleteMany({});
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

  // 1. Valid requirement extraction
  await t.test('1. valid requirement extraction parses structured requirements', async () => {
    const mock = new MockLlmProvider();
    const requirements = await extractRequirementsFromJd(
      'We are looking for a Senior Node.js developer with 5+ years experience and MongoDB skills.',
      { provider: mock }
    );

    assert.ok(Array.isArray(requirements));
    assert.ok(requirements.length >= 2);
    assert.equal(requirements[0].id, 'r1');
    assert.equal(requirements[0].kind, 'technical');
    assert.equal(requirements[0].priority, 'must');
  });

  // 2. Stable requirement IDs
  await t.test('2. stable requirement IDs assigns deterministic sequential identifiers', () => {
    const rawList = [
      { id: 'random-uuid-99', text: 'Mastery of distributed systems', kind: 'technical', priority: 'must' },
      { id: 'random-uuid-88', text: 'B.S. in Computer Science', kind: 'education', priority: 'nice' }
    ];

    const normalized = normalizeRequirementIds(rawList);
    assert.equal(normalized[0].id, 'r1');
    assert.equal(normalized[1].id, 'r2');
  });

  // 3. Duplicate requirement handling
  await t.test('3. duplicate requirement handling merges identical items', () => {
    const rawList = [
      { text: 'Proficiency in Python and FastAPI', kind: 'technical', priority: 'must' },
      { text: 'Proficiency in Python and FastAPI', kind: 'technical', priority: 'must' },
      { text: 'Clear documentation skills', kind: 'behavioral', priority: 'should' }
    ];

    const normalized = normalizeRequirementIds(rawList);
    assert.equal(normalized.length, 2);
    assert.equal(normalized[0].id, 'r1');
    assert.equal(normalized[1].id, 'r2');
  });

  // 4. Thin JD handling
  await t.test('4. thin JD yields valid fallback without hallucinating requirements', async () => {
    const mock = new MockLlmProvider();
    const emptyResult = await extractRequirementsFromJd('', { provider: mock });
    assert.ok(emptyResult.length >= 1);
    assert.equal(emptyResult[0].id, 'r1');
  });

  // 5. Valid company brief
  await t.test('5. valid company brief generates grounded summary and what_they_do', async () => {
    const mock = new MockLlmProvider();
    const pages = [
      {
        url: 'https://acme.org',
        title: 'Acme Home',
        text: 'Acme builds enterprise observability platforms for cloud infrastructure.'
      }
    ];

    const brief = await generateCompanyBrief(pages, { companyUrl: 'https://acme.org', provider: mock });
    assert.ok(brief.summary.length > 5);
    assert.ok(brief.what_they_do.length > 5);
    assert.deepEqual(brief.sources, ['https://acme.org']);
  });

  // 6. Source URL validation
  await t.test('6. source URL validation keeps verified fetched URLs', () => {
    const valid = ['https://acme.org', 'https://acme.org/careers'];
    const candidates = ['https://acme.org', 'https://acme.org/careers/'];

    const filtered = validateAndFilterSources(candidates, valid);
    assert.equal(filtered.length, 2);
  });

  // 7. Hallucinated source URL rejected
  await t.test('7. hallucinated source URL rejected if not present in fetched research', () => {
    const valid = ['https://acme.org'];
    const candidates = ['https://acme.org', 'https://acme.org/invented-secret-doc', 'https://randomsite.com'];

    const filtered = validateAndFilterSources(candidates, valid);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0], 'https://acme.org');
  });

  // 8. Valid role analysis
  await t.test('8. valid role analysis combines role metadata with extracted requirements', async () => {
    const mock = new MockLlmProvider();
    const requirements = [{ id: 'r1', text: 'Proficiency in Node.js', kind: 'technical', priority: 'must' }];

    const role = await analyzeRole('Looking for a Lead Systems Engineer', requirements, { provider: mock });
    assert.equal(role.title, 'Senior Software Engineer');
    assert.equal(role.seniority, 'Senior');
    assert.ok(Array.isArray(role.responsibilities));
    assert.equal(role.requirements[0].id, 'r1');
  });

  // 9. Malformed JSON handling
  await t.test('9. malformed JSON triggers retry and structured error upon exhaustion', async () => {
    const mock = new MockLlmProvider();
    mock.setOverrideHandler(() => 'Not a valid JSON string at all');

    await assert.rejects(
      async () => generateStructured({
        system: 'System instructions',
        input: 'Test input',
        schema: CompanyBriefOutputSchema,
        provider: mock,
        maxRetries: 2
      }),
      (err) => err.code === LLM_ERROR_CODES.INVALID_JSON
    );

    assert.equal(mock.callCount, 2); // Retried once before exhaustion
  });

  // 10. Schema validation failure
  await t.test('10. schema validation failure rejects mismatched output', async () => {
    const mock = new MockLlmProvider();
    // Return missing required fields
    mock.setOverrideHandler(() => JSON.stringify({ invalidField: true }));

    await assert.rejects(
      async () => generateStructured({
        system: 'Extract requirements',
        input: 'Test input',
        schema: RequirementExtractionOutputSchema,
        provider: mock,
        maxRetries: 1
      }),
      (err) => err.code === LLM_ERROR_CODES.SCHEMA_INVALID
    );
  });

  // 11. Retry behavior
  await t.test('11. retry behavior succeeds when second attempt returns valid output', async () => {
    const mock = new MockLlmProvider();
    let call = 0;
    mock.setOverrideHandler(() => {
      call++;
      if (call === 1) return 'Broken JSON {';
      return JSON.stringify({
        summary: 'Valid company summary',
        what_they_do: 'Valid product description',
        sources: ['https://example.com']
      });
    });

    const result = await generateStructured({
      system: 'Company brief',
      input: 'Test',
      schema: CompanyBriefOutputSchema,
      provider: mock,
      maxRetries: 2
    });

    assert.equal(call, 2);
    assert.equal(result.summary, 'Valid company summary');
  });

  // 12. Missing API key
  await t.test('12. missing API key returns structured configuration error without crash', async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      await assert.rejects(
        async () => callGeminiApi({ system: 'test', input: 'test' }),
        (err) => err.code === LLM_ERROR_CODES.CONFIGURATION_ERROR
      );
    } finally {
      if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    }
  });

  // 13. Rate limit handling
  await t.test('13. rate limit handling returns structured LLM_RATE_LIMITED code', async () => {
    const mock = new MockLlmProvider();
    mock.setForcedError(new LlmError('Rate limited', LLM_ERROR_CODES.RATE_LIMITED, 429));

    await assert.rejects(
      async () => generateStructured({
        system: 'test',
        input: 'test',
        provider: mock,
        maxRetries: 1
      }),
      (err) => err.code === LLM_ERROR_CODES.RATE_LIMITED
    );
  });

  // 14. Multi-tenant ownership isolation
  await t.test('14. Multi-tenant ownership isolation: User B cannot trigger analysis on User A kit', async () => {
    // 14.1 Create a kit for User A
    const kitRes = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: 'Senior Backend Engineer responsible for distributed caching and database transactions.',
        company_url: 'https://mocktestcorp.org',
        days_available: 5
      });

    assert.equal(kitRes.status, 201);
    createdKitIdUserA = kitRes.body.kit.id;
    createdJobIdUserA = kitRes.body.job.id;

    const userAKitDoc = await db.collection('kits').findOne({
      _id: new (await import('mongodb')).ObjectId(createdKitIdUserA)
    });
    const userAId = userAKitDoc.user_id;

    // Insert fake research results for User A kit
    await db.collection('research_results').insertOne({
      kit_id: new (await import('mongodb')).ObjectId(createdKitIdUserA),
      user_id: userAId,
      company_url: 'https://mocktestcorp.org',
      researched_at: new Date(),
      pages: [
        {
          url: 'https://mocktestcorp.org',
          title: 'MockTestCorp',
          text: 'MockTestCorp builds real-time high-throughput transactional infrastructure.'
        }
      ],
      pages_used: ['https://mocktestcorp.org'],
      warnings: [],
      created_at: new Date(),
      updated_at: new Date()
    });

    // User B attempts to trigger analysis on User A's kit
    const triggerResB = await request(app)
      .post(`/api/kits/${createdKitIdUserA}/analyze`)
      .set('Cookie', cookieUserB);

    assert.equal(triggerResB.status, 404);
    assert.equal(triggerResB.body.error.code, 'NOT_FOUND');
  });

  // 15. Generated data persisted correctly
  await t.test('15. generated data persisted correctly in kit document matching Appendix A format', async () => {
    const mock = new MockLlmProvider();

    const analysisResult = await executeKitAnalysis({
      kitId: createdKitIdUserA,
      jobId: createdJobIdUserA,
      userId: (await db.collection('kits').findOne({ _id: new (await import('mongodb')).ObjectId(createdKitIdUserA) })).user_id,
      options: { provider: mock }
    });

    assert.ok(analysisResult.kit);
    assert.ok(analysisResult.kit.company_brief);
    assert.ok(analysisResult.kit.role);
    assert.ok(analysisResult.kit.role.requirements.length >= 1);

    // Verify directly in MongoDB
    const persistedKit = await db.collection('kits').findOne({
      _id: new (await import('mongodb')).ObjectId(createdKitIdUserA)
    });

    assert.ok(
      persistedKit.company_brief.sources[0] === 'https://mocktestcorp.org' ||
      persistedKit.company_brief.sources[0] === 'https://mocktestcorp.org/'
    );
    assert.equal(persistedKit.role.title, 'Senior Software Engineer');
    assert.equal(persistedKit.role.requirements[0].id, 'r1');

    // Verify Appendix A future placeholders are preserved and not faked
    assert.deepEqual(persistedKit.questions, []);
    assert.deepEqual(persistedKit.flashcards, []);
  });

  // 16. Generation job stage updates
  await t.test('16. generation job stage updates to analysis_completed and progress: 75', async () => {
    const updatedJob = await db.collection('generation_jobs').findOne({
      _id: new (await import('mongodb')).ObjectId(createdJobIdUserA)
    });

    assert.equal(updatedJob.status, 'running');
    assert.equal(updatedJob.stage, 'analysis_completed');
    assert.equal(updatedJob.progress, 75);
  });

  // 17. Generation failure state
  await t.test('17. generation failure state records safe error in generation job', async () => {
    const brokenMock = new MockLlmProvider();
    brokenMock.setForcedError(new LlmError('Transient outage', LLM_ERROR_CODES.PROVIDER_ERROR, 500));

    await assert.rejects(
      async () => executeKitAnalysis({
        kitId: createdKitIdUserA,
        jobId: createdJobIdUserA,
        userId: (await db.collection('kits').findOne({ _id: new (await import('mongodb')).ObjectId(createdKitIdUserA) })).user_id,
        options: { provider: brokenMock }
      }),
      (err) => err.code === LLM_ERROR_CODES.PROVIDER_ERROR
    );

    const failedJob = await db.collection('generation_jobs').findOne({
      _id: new (await import('mongodb')).ObjectId(createdJobIdUserA)
    });

    assert.equal(failedJob.status, 'failed');
    assert.equal(failedJob.stage, 'analysis_failed');
    assert.equal(failedJob.error.code, LLM_ERROR_CODES.PROVIDER_ERROR);
  });
});
