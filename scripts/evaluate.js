#!/usr/bin/env node

/**
 * Assessment Evaluator for Interview Preparation Elite (IPE).
 *
 * Runs the complete end-to-end preparation kit generation pipeline
 * against test cases and validates output against Appendix A requirements.
 *
 * Usage:
 *   npm run evaluate -- --input fixtures/cases.json --output kits.json
 *   node scripts/evaluate.js --input fixtures/cases.json --output kits.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load environment variables from .env using native Node.js method
try {
  process.loadEnvFile();
} catch {
  // If .env does not exist or cannot be loaded, continue with process.env
}

import { executeCompanyResearch } from '../backend/src/pipeline/research/index.js';
import { extractRequirementsFromJd, normalizeRequirementIds } from '../backend/src/pipeline/generation/requirementExtraction.js';
import { generateCompanyBrief } from '../backend/src/pipeline/generation/companyBrief.js';
import { analyzeRole } from '../backend/src/pipeline/generation/roleAnalysis.js';
import { generateQuestions } from '../backend/src/pipeline/generation/questionGeneration.js';
import { generateFlashcards } from '../backend/src/pipeline/generation/flashcardGeneration.js';
import { runCoveragePipeline } from '../backend/src/pipeline/coverage/index.js';
import { generateSchedule } from '../backend/src/pipeline/schedule/index.js';
import { Step7KitSchema } from '../backend/src/pipeline/generation/schemas.js';
import { MockLlmProvider } from '../backend/src/providers/mockProvider.js';

function parseArguments() {
  const args = process.argv.slice(2);
  let inputPath = null;
  let outputPath = null;
  let providerChoice = null; // 'gemini' | 'mock'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      inputPath = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    } else if (args[i] === '--provider' && args[i + 1]) {
      providerChoice = args[i + 1];
      i++;
    }
  }

  return { inputPath, outputPath, providerChoice };
}

/**
 * Validates a generated kit against all assessment and Appendix A rules:
 * - Step7KitSchema Zod validation
 * - Stable IDs: r1..rn, q1..qn, f1..fn
 * - Difficulty 1-3
 * - Integer schedule minutes (positive)
 * - Schedule question IDs exist in questions
 * - Question requirement IDs exist in role.requirements
 * - Requested days count matches schedule.days_available and schedule.days.length
 */
export function validateEvaluatedKit(kit, expectedDays) {
  const errors = [];

  // 1. Zod schema validation
  const zodValidation = Step7KitSchema.safeParse(kit);
  if (!zodValidation.success) {
    for (const issue of zodValidation.error.issues) {
      errors.push(`Schema Error at ${issue.path.join('.') || 'root'}: ${issue.message}`);
    }
  }

  // 2. Stable IDs and Requirements validation
  const reqMap = new Map();
  if (Array.isArray(kit.role?.requirements)) {
    for (const req of kit.role.requirements) {
      if (!req.id || typeof req.id !== 'string') {
        errors.push(`Requirement missing valid ID`);
      } else if (reqMap.has(req.id)) {
        errors.push(`Duplicate requirement ID: ${req.id}`);
      } else {
        reqMap.set(req.id, req);
      }
    }
  } else {
    errors.push('role.requirements must be an array');
  }

  // 3. Question IDs, Difficulty, and Requirement References
  const qIdSet = new Set();
  if (Array.isArray(kit.questions)) {
    for (const q of kit.questions) {
      if (!q.id) {
        errors.push('Question missing ID');
      } else if (qIdSet.has(q.id)) {
        errors.push(`Duplicate question ID: ${q.id}`);
      } else {
        qIdSet.add(q.id);
      }

      if (![1, 2, 3].includes(q.difficulty)) {
        errors.push(`Question ${q.id} has invalid difficulty: ${q.difficulty}. Must be 1, 2, or 3.`);
      }

      if (!Array.isArray(q.requirement_ids) || q.requirement_ids.length === 0) {
        errors.push(`Question ${q.id} has no linked requirement_ids`);
      } else {
        for (const rId of q.requirement_ids) {
          if (!reqMap.has(rId)) {
            errors.push(`Question ${q.id} references non-existent requirement ID: ${rId}`);
          }
        }
      }
    }
  } else {
    errors.push('questions must be an array');
  }

  // 4. Flashcards Validation
  const fIdSet = new Set();
  if (Array.isArray(kit.flashcards)) {
    for (const f of kit.flashcards) {
      if (!f.id) {
        errors.push('Flashcard missing ID');
      } else if (fIdSet.has(f.id)) {
        errors.push(`Duplicate flashcard ID: ${f.id}`);
      } else {
        fIdSet.add(f.id);
      }

      if (!Array.isArray(f.requirement_ids) || f.requirement_ids.length === 0) {
        errors.push(`Flashcard ${f.id} has no linked requirement_ids`);
      } else {
        for (const rId of f.requirement_ids) {
          if (!reqMap.has(rId)) {
            errors.push(`Flashcard ${f.id} references non-existent requirement ID: ${rId}`);
          }
        }
      }
    }
  } else {
    errors.push('flashcards must be an array');
  }

  // 5. Schedule Validation
  const schedule = kit.schedule;
  if (!schedule) {
    errors.push('Missing schedule object');
  } else {
    if (schedule.days_available !== expectedDays) {
      errors.push(`Schedule days_available (${schedule.days_available}) does not match requested days (${expectedDays})`);
    }

    if (!Array.isArray(schedule.days) || schedule.days.length !== expectedDays) {
      errors.push(`Schedule days count (${schedule.days?.length}) does not match requested days (${expectedDays})`);
    } else {
      for (const day of schedule.days) {
        if (!Number.isInteger(day.minutes) || day.minutes <= 0) {
          errors.push(`Day ${day.day} minutes (${day.minutes}) must be a positive integer`);
        }

        if (Array.isArray(day.question_ids)) {
          for (const qId of day.question_ids) {
            if (!qIdSet.has(qId)) {
              errors.push(`Schedule day ${day.day} references non-existent question ID: ${qId}`);
            }
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Runs the real generation pipeline for a single test case.
 *
 * @param {Object} testCase
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function evaluateSingleCase(testCase, options = {}) {
  const startTime = Date.now();
  const caseId = testCase.id || 'unknown';
  const jdText = testCase.jd || '';
  const companyUrl = testCase.company_url || '';
  const days = parseInt(testCase.days, 10) || 5;

  let retriesCount = 0;

  try {
    // Stage 1: Research
    let researchPages = [];
    try {
      const researchResult = await executeCompanyResearch(companyUrl, {
        maxPages: 3,
        politenessDelayMs: 100
      });
      researchPages = researchResult?.pages || [];
    } catch (researchErr) {
      // Failed or invalid URLs gracefully yield empty research pages
      researchPages = [];
    }

    // Stage 2: Requirements Extraction
    const rawReqs = await extractRequirementsFromJd(jdText, options);
    const normalizedReqs = normalizeRequirementIds(rawReqs);

    // Stage 3: Company Brief
    const companyBrief = await generateCompanyBrief(researchPages, {
      companyUrl,
      ...options
    });

    // Stage 4: Role Analysis
    const roleAnalysis = await analyzeRole(jdText, normalizedReqs, options);

    const role = {
      title: roleAnalysis.title,
      seniority: roleAnalysis.seniority,
      responsibilities: roleAnalysis.responsibilities,
      requirements: normalizedReqs
    };

    // Stage 5: Question Generation (Initial)
    const initialQuestions = await generateQuestions({
      role,
      companyBrief,
      jdText,
      options
    });

    // Stage 6: Flashcard Generation
    const flashcards = await generateFlashcards({
      requirements: normalizedReqs,
      questions: initialQuestions,
      companyBrief,
      role,
      options
    });

    // Stage 7: Deterministic Coverage Pipeline (Pass 1 & Pass 2 if needed)
    const coverageResult = await runCoveragePipeline({
      role,
      companyBrief,
      jdText,
      existingQuestions: initialQuestions,
      options
    });

    const finalQuestions = coverageResult.questions;
    const finalCoverage = coverageResult.coverage;

    // Stage 8: Deterministic Schedule
    const finalSchedule = generateSchedule({
      daysAvailable: days,
      requirements: normalizedReqs,
      questions: finalQuestions,
      dailyMinutes: 60
    });

    // Stage 9: Assemble final kit
    const kit = {
      source: { company_url: companyUrl },
      company_brief: companyBrief,
      role,
      questions: finalQuestions,
      flashcards,
      coverage: finalCoverage,
      schedule: finalSchedule
    };

    // Stage 10: Validate against Appendix A
    const validation = validateEvaluatedKit(kit, days);
    const elapsedMs = Date.now() - startTime;

    return {
      case_id: caseId,
      status: validation.valid ? 'passed' : 'failed',
      elapsed_ms: elapsedMs,
      retries: retriesCount,
      kit,
      validation_errors: validation.errors,
      uncovered_requirements: finalCoverage.uncovered_requirement_ids || [],
      coverage_passes: finalCoverage.passes || 1
    };
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    return {
      case_id: caseId,
      status: 'failed',
      elapsed_ms: elapsedMs,
      retries: retriesCount,
      kit: null,
      error: {
        code: error.code || 'PIPELINE_ERROR',
        message: error.message || 'Error occurred during generation'
      },
      validation_errors: [`Pipeline execution failed: ${error.message}`],
      uncovered_requirements: [],
      coverage_passes: 0
    };
  }
}

async function main() {
  const { inputPath, outputPath, providerChoice } = parseArguments();

  if (!inputPath || !outputPath) {
    console.error('Usage: npm run evaluate -- --input <cases.json> --output <kits.json>');
    process.exit(1);
  }

  const resolvedInput = path.resolve(process.cwd(), inputPath);
  const resolvedOutput = path.resolve(process.cwd(), outputPath);

  let rawData;
  try {
    rawData = await fs.readFile(resolvedInput, 'utf-8');
  } catch (err) {
    console.error(`Cannot read input file at ${resolvedInput}: ${err.message}`);
    process.exit(1);
  }

  let cases;
  try {
    cases = JSON.parse(rawData);
    if (!Array.isArray(cases) || cases.length === 0) {
      throw new Error('Input cases must be a non-empty array');
    }
  } catch (err) {
    console.error(`Invalid JSON in input file: ${err.message}`);
    process.exit(1);
  }

  // Determine provider options
  // By default, if GEMINI_API_KEY is present, we use live Gemini provider.
  // If providerChoice is explicitly 'mock' or if GEMINI_API_KEY is not set, use MockLlmProvider.
  let options = {};
  if (providerChoice === 'mock' || (!process.env.GEMINI_API_KEY && !providerChoice)) {
    console.log('[Evaluator] Using MockLlmProvider for local deterministic offline run.');
    options.provider = new MockLlmProvider();
  } else {
    console.log('[Evaluator] Using Gemini provider (model: ' + (process.env.GEMINI_MODEL || 'gemini-2.5-flash') + ')');
  }

  console.log(`\n======================================================`);
  console.log(`  Interview Preparation Elite (IPE) Assessment Evaluator`);
  console.log(`======================================================`);
  console.log(`Cases to evaluate: ${cases.length}`);
  console.log(`Input:             ${inputPath}`);
  console.log(`Output:            ${outputPath}\n`);

  const results = [];
  let passedCount = 0;
  let failedCount = 0;

  for (let idx = 0; idx < cases.length; idx++) {
    const testCase = cases[idx];
    const caseId = testCase.id || `case-${idx + 1}`;
    process.stdout.write(`[${idx + 1}/${cases.length}] Evaluating ${caseId}... `);

    // Each case runs safely and catches errors so the batch NEVER stops on failure
    const caseResult = await evaluateSingleCase(testCase, options);

    if (caseResult.status === 'passed') {
      passedCount++;
      console.log(`PASSED (${caseResult.elapsed_ms}ms, ${caseResult.kit.questions.length} questions, ${caseResult.coverage_passes} passes)`);
    } else {
      failedCount++;
      const reason = caseResult.validation_errors?.[0] || caseResult.error?.message || 'Validation failed';
      console.log(`FAILED (${caseResult.elapsed_ms}ms): ${reason}`);
    }

    results.push(caseResult);
  }

  const summary = {
    total_cases: cases.length,
    passed_cases: passedCount,
    failed_cases: failedCount,
    pass_rate_percentage: Math.round((passedCount / cases.length) * 100),
    evaluated_at: new Date().toISOString()
  };

  const outputPayload = {
    version: '1.0',
    summary,
    cases: results
  };

  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.writeFile(resolvedOutput, JSON.stringify(outputPayload, null, 2), 'utf-8');

  console.log(`\n======================================================`);
  console.log(`  Evaluation Complete: ${passedCount}/${cases.length} Passed (${summary.pass_rate_percentage}%)`);
  console.log(`  Results saved to: ${outputPath}`);
  console.log(`======================================================\n`);

  // If all cases failed, exit with non-zero
  if (passedCount === 0 && cases.length > 0) {
    process.exit(1);
  }
}

// Only run main if executed directly via CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('Evaluator encountered an unexpected top-level error:', err);
    process.exit(1);
  });
}
