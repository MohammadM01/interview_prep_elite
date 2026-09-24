import { LlmError, LLM_ERROR_CODES } from './gemini.js';

/**
 * Deterministic Mock LLM Provider for unit & integration testing.
 * Does not require external internet or live GEMINI_API_KEY.
 */
export class MockLlmProvider {
  constructor(options = {}) {
    this.options = options;
    this.callCount = 0;
    this.history = [];
    this.forcedError = null;
    this.overrideHandler = null;
  }

  setForcedError(error) {
    this.forcedError = error;
  }

  setOverrideHandler(handler) {
    this.overrideHandler = handler;
  }

  reset() {
    this.callCount = 0;
    this.history = [];
    this.forcedError = null;
    this.overrideHandler = null;
  }

  async generateRaw({ system, input, model }) {
    this.callCount++;
    this.history.push({ system, input, model, timestamp: Date.now() });

    if (this.forcedError) {
      throw this.forcedError;
    }

    if (this.overrideHandler) {
      return this.overrideHandler({ system, input, model, callCount: this.callCount });
    }

    // Deterministic mock generation based on prompt intent
    const lowerSystem = (system || '').toLowerCase();
    const lowerInput = (input || '').toLowerCase();

    // 1. Flashcard Generation
    if (
      lowerSystem.includes('flashcard') ||
      lowerSystem.includes('study architect') ||
      lowerInput.includes('revision flashcards')
    ) {
      return JSON.stringify({
        flashcards: [
          {
            front: 'What is the difference between microtasks and macrotasks in Node.js?',
            back: 'Microtasks (Promises, process.nextTick) execute immediately after the current operation finishes and before the event loop advances to the next phase of macrotasks (timers, I/O, check).',
            requirement_ids: ['r1']
          },
          {
            front: 'What is the MongoDB ESR rule for index design?',
            back: 'Equality first, Sort second, Range third. Place exact match filter fields first, sort keys in order, and range inequality filters last.',
            requirement_ids: ['r2']
          },
          {
            front: 'How do you structure a behavioral interview answer effectively?',
            back: 'Use STAR: Situation (context), Task (your goal), Action (what you specifically did and why), Result (quantified impact and retrospective).',
            requirement_ids: ['r3']
          }
        ]
      });
    }

    // 2. Question Generation
    if (
      lowerSystem.includes('interview architect') ||
      lowerSystem.includes('interview questions') ||
      lowerInput.includes('generate targeted interview questions')
    ) {
      return JSON.stringify({
        questions: [
          {
            requirement_ids: ['r1'],
            category: 'technical',
            prompt: 'Explain the Node.js event loop and how asynchronous I/O is scheduled.',
            answer_outline: 'Describe libuv, macro/micro task queues, process.nextTick vs setImmediate, and backpressure management.',
            difficulty: 2
          },
          {
            requirement_ids: ['r2'],
            category: 'technical',
            prompt: 'How do you design and index MongoDB collections for high write throughput without degrading read latency?',
            answer_outline: 'Explain compound indexes, ESR rule, write concerns, sharding strategies, and avoiding unbounded arrays.',
            difficulty: 3
          },
          {
            requirement_ids: ['r3'],
            category: 'behavioral',
            prompt: 'Describe a situation where you had a strong technical disagreement with a team member. How did you resolve it?',
            answer_outline: 'STAR framework: Situation, Task, Action taking data-driven approach, Result demonstrating team alignment.',
            difficulty: 2
          }
        ]
      });
    }

    // 3. Company Brief
    if (
      lowerSystem.includes('company brief') ||
      lowerSystem.includes('corporate intelligence') ||
      lowerSystem.includes('summarize a target company') ||
      lowerInput.includes('company brief') ||
      lowerInput.includes('company target:')
    ) {
      // Find source URL from input if provided
      const urlMatch = input.match(/https?:\/\/[^\s"',]+/);
      const foundUrl = urlMatch ? urlMatch[0] : 'https://example.com/';

      return JSON.stringify({
        summary: 'A leading technology organization specializing in cloud services and developer tooling.',
        what_they_do: 'Develops distributed infrastructure and scalable developer toolsets.',
        sources: [foundUrl]
      });
    }

    // 4. Role Analysis
    if (
      lowerSystem.includes('role analysis') ||
      lowerSystem.includes('role analyst') ||
      lowerSystem.includes('technical recruiter') ||
      lowerInput.includes('role analysis')
    ) {
      return JSON.stringify({
        title: 'Senior Software Engineer',
        seniority: 'Senior',
        responsibilities: [
          'Design and maintain low-latency distributed APIs',
          'Lead technical architectural design discussions',
          'Mentor junior and mid-level engineering team members'
        ]
      });
    }

    // 5. Requirement Extraction
    if (
      lowerSystem.includes('hiring analyst') ||
      lowerSystem.includes('extract explicit hiring requirements') ||
      lowerInput.includes('untrusted job description') ||
      lowerSystem.includes('requirement') ||
      lowerInput.includes('requirement')
    ) {
      return JSON.stringify({
        requirements: [
          {
            id: 'r1',
            text: 'Proficiency in Node.js and distributed asynchronous backend services',
            kind: 'technical',
            priority: 'must'
          },
          {
            id: 'r2',
            text: 'Experience with MongoDB schema design and query optimization',
            kind: 'technical',
            priority: 'must'
          },
          {
            id: 'r3',
            text: 'Strong communication skills and cross-functional team collaboration',
            kind: 'behavioral',
            priority: 'should'
          },
          {
            id: 'r4',
            text: 'Bachelor degree in Computer Science or equivalent practical experience',
            kind: 'education',
            priority: 'nice'
          }
        ]
      });
    }

    return JSON.stringify({ status: 'ok' });
  }
}
