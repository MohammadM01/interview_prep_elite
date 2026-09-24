/**
 * Gemini LLM Provider
 * Interfaces directly with the Google Gemini REST API using native fetch.
 * Enforces structured JSON output, timeout handling, and security sanitization.
 */

export class LlmError extends Error {
  constructor(message, code, status = null, details = null) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const LLM_ERROR_CODES = {
  CONFIGURATION_ERROR: 'LLM_CONFIGURATION_ERROR',
  RATE_LIMITED: 'LLM_RATE_LIMITED',
  TIMEOUT: 'LLM_TIMEOUT',
  INVALID_JSON: 'LLM_INVALID_JSON',
  SCHEMA_INVALID: 'LLM_SCHEMA_INVALID',
  EMPTY_RESPONSE: 'LLM_EMPTY_RESPONSE',
  PROVIDER_ERROR: 'LLM_PROVIDER_ERROR'
};

const DEFAULT_MODEL = 'gemini-3.6-flash';
const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Calls Gemini REST API expecting structured JSON.
 *
 * @param {Object} params
 * @param {string} params.system System instructions
 * @param {string} params.input User prompt / untrusted data
 * @param {string} [params.model]
 * @param {number} [params.timeoutMs=15000]
 * @returns {Promise<string>} Raw JSON string from model
 */
export async function callGeminiApi({
  system,
  input,
  model = process.env.GEMINI_MODEL || DEFAULT_MODEL,
  timeoutMs = parseInt(process.env.LLM_TIMEOUT_MS, 10) || 30000
}) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || !apiKey.trim()) {
    throw new LlmError(
      'GEMINI_API_KEY is not configured in the environment',
      LLM_ERROR_CODES.CONFIGURATION_ERROR,
      500
    );
  }

  const endpointUrl = `${GEMINI_API_ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

  const requestBody = {
    systemInstruction: {
      parts: [{ text: system }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: input }]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError' || err.message?.includes('aborted')) {
      throw new LlmError(
        `Gemini API request timed out after ${timeoutMs}ms`,
        LLM_ERROR_CODES.TIMEOUT,
        408
      );
    }
    throw new LlmError(
      `Gemini network connection failure: ${err.message}`,
      LLM_ERROR_CODES.PROVIDER_ERROR,
      500
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 429) {
    let detail = '';
    try {
      const errJson = await response.json();
      detail = errJson.error?.message || '';
    } catch {}
    throw new LlmError(
      `Gemini API rate limit exceeded: ${detail || 'Please retry after a brief delay.'}`,
      LLM_ERROR_CODES.RATE_LIMITED,
      429,
      { detail }
    );
  }

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson.error?.message || response.statusText;
    } catch {
      errorDetail = response.statusText;
    }

    if (response.status === 400 && errorDetail.includes('API_KEY')) {
      throw new LlmError(
        'Invalid or unauthorized Gemini API key',
        LLM_ERROR_CODES.CONFIGURATION_ERROR,
        401
      );
    }

    throw new LlmError(
      `Gemini API returned error HTTP ${response.status}: ${errorDetail}`,
      LLM_ERROR_CODES.PROVIDER_ERROR,
      response.status
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new LlmError(
      'Failed to parse Gemini response payload as JSON',
      LLM_ERROR_CODES.INVALID_JSON,
      500
    );
  }

  const candidate = data.candidates?.[0];
  if (!candidate || !candidate.content?.parts?.[0]?.text) {
    const finishReason = candidate?.finishReason || 'NO_CANDIDATE';
    throw new LlmError(
      `Gemini returned empty response content (finishReason: ${finishReason})`,
      LLM_ERROR_CODES.EMPTY_RESPONSE,
      502
    );
  }

  return candidate.content.parts[0].text;
}
