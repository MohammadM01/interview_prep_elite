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

    // 1. Requirement Extraction
    if (lowerSystem.includes('requirement') || lowerInput.includes('requirement')) {
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

    // 2. Company Brief
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

    // 3. Role Analysis
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

    return JSON.stringify({ status: 'ok' });
  }
}
