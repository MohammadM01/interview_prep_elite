import { callGeminiApi, LlmError, LLM_ERROR_CODES } from './gemini.js';
import { MockLlmProvider } from './mockProvider.js';

let defaultCustomProvider = null;

/**
 * Sets a custom provider (e.g. for testing)
 * @param {Object|null} provider
 */
export function setDefaultProvider(provider) {
  defaultCustomProvider = provider;
}

/**
 * Strips markdown code fences if LLM wrapped JSON in ```json ... ```
 * @param {string} raw
 * @returns {string}
 */
export function extractCleanJsonString(raw) {
  if (typeof raw !== 'string') return '';
  let cleaned = raw.trim();

  // Match ```json ... ``` or ``` ... ```
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  return cleaned;
}

/**
 * Generates structured, validated data from an LLM.
 *
 * @param {Object} params
 * @param {string} params.system System instructions
 * @param {string} params.input User / untrusted data
 * @param {import('zod').ZodType} [params.schema] Optional Zod schema for validation
 * @param {string} [params.model] Optional model override
 * @param {number} [params.timeoutMs=15000] Request timeout
 * @param {number} [params.maxRetries=2] Max retry attempts for transient / parse errors
 * @param {Object} [params.provider] Custom provider instance
 * @returns {Promise<any>} Parsed and validated object
 */
export async function generateStructured({
  system,
  input,
  schema = null,
  model = process.env.GEMINI_MODEL,
  timeoutMs = 15000,
  maxRetries = 2,
  provider = null
}) {
  const activeProvider = provider || defaultCustomProvider;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let rawText;

      if (activeProvider && typeof activeProvider.generateRaw === 'function') {
        rawText = await activeProvider.generateRaw({ system, input, model, timeoutMs });
      } else {
        rawText = await callGeminiApi({ system, input, model, timeoutMs });
      }

      if (!rawText || !rawText.trim()) {
        throw new LlmError(
          'LLM returned an empty response string',
          LLM_ERROR_CODES.EMPTY_RESPONSE,
          502
        );
      }

      // Parse JSON
      const cleanJson = extractCleanJsonString(rawText);
      let parsed;
      try {
        parsed = JSON.parse(cleanJson);
      } catch (parseErr) {
        throw new LlmError(
          `Failed to parse model response as JSON: ${parseErr.message}`,
          LLM_ERROR_CODES.INVALID_JSON,
          500,
          { rawPreview: rawText.slice(0, 200) }
        );
      }

      // Validate against schema if provided
      if (schema) {
        const validation = schema.safeParse(parsed);
        if (!validation.success) {
          const formattedIssues = validation.error.issues?.map(
            (iss) => `${iss.path.join('.') || 'root'}: ${iss.message}`
          ).join('; ');

          throw new LlmError(
            `Model output failed schema validation: ${formattedIssues}`,
            LLM_ERROR_CODES.SCHEMA_INVALID,
            422,
            { issues: validation.error.issues }
          );
        }
        return validation.data;
      }

      return parsed;
    } catch (err) {
      lastError = err;

      // Do NOT retry fatal configuration errors or authentication rejections
      if (err.code === LLM_ERROR_CODES.CONFIGURATION_ERROR) {
        throw err;
      }

      // If we still have retries remaining and error is parse/transient, retry
      if (attempt < maxRetries) {
        // Short exponential backoff before retry (100ms * attempt)
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
        continue;
      }
    }
  }

  throw lastError;
}

export { LlmError, LLM_ERROR_CODES, MockLlmProvider };
