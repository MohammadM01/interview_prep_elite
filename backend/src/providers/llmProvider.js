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
 * Determines whether an error represents a transient 503 / UNAVAILABLE condition.
 * @param {any} err
 * @returns {boolean}
 */
export function isTransient503Error(err) {
  if (!err) return false;
  if (err.status === 503) return true;
  if (typeof err.message === 'string') {
    const lower = err.message.toLowerCase();
    if (lower.includes('503') || lower.includes('unavailable') || lower.includes('high demand')) {
      return true;
    }
  }
  return false;
}

/**
 * Generates structured, validated data from an LLM.
 *
 * @param {Object} params
 * @param {string} params.system System instructions
 * @param {string} params.input User / untrusted data
 * @param {import('zod').ZodType} [params.schema] Optional Zod schema for validation
 * @param {string} [params.model] Optional model override
 * @param {string} [params.fallbackModel] Optional fallback model if primary model encounters transient 503/UNAVAILABLE
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
  fallbackModel = null,
  timeoutMs = 15000,
  maxRetries = 2,
  provider = null
}) {
  const activeProvider = provider || defaultCustomProvider;

  const executeAttempts = async (activeModel, retries) => {
    let lastErr = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        let rawText;

        if (activeProvider && typeof activeProvider.generateRaw === 'function') {
          rawText = await activeProvider.generateRaw({ system, input, model: activeModel, timeoutMs });
        } else {
          rawText = await callGeminiApi({ system, input, model: activeModel, timeoutMs });
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
        lastErr = err;

        // Do NOT retry fatal configuration errors or authentication rejections
        if (err.code === LLM_ERROR_CODES.CONFIGURATION_ERROR) {
          throw err;
        }

        // If we still have retries remaining and error is parse/transient, retry
        if (attempt < retries) {
          let backoffMs = (err.status === 429 || err.status === 503)
            ? (process.env.NODE_ENV === 'test' ? 10 * attempt : 2000 * attempt)
            : (process.env.NODE_ENV === 'test' ? 5 * attempt : 100 * attempt);

          // Honor provider rate limit reset delay if explicitly specified
          const retryMatch = err.message?.match(/retry in\s*([\d.]+)s/i);
          if (retryMatch) {
            const parsedDelayMs = Math.ceil(parseFloat(retryMatch[1]) * 1000);
            if (parsedDelayMs > 0 && parsedDelayMs <= 60000) {
              backoffMs = parsedDelayMs + 1000;
            }
          }

          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
      }
    }
    throw lastErr;
  };

  try {
    return await executeAttempts(model, maxRetries);
  } catch (err) {
    if (fallbackModel && fallbackModel !== model && isTransient503Error(err)) {
      console.warn(`[LLM Fallback] DRAFT_MODEL ${model} unavailable (HTTP 503 / high demand), falling back to ${fallbackModel}`);
      console.log(`DRAFT_MODEL ${model} unavailable, falling back to ${fallbackModel}`);
      try {
        return await executeAttempts(fallbackModel, 1);
      } catch (fallbackErr) {
        console.error(`[LLM Fallback] Fallback model ${fallbackModel} also failed:`, fallbackErr.message);
        throw fallbackErr;
      }
    }

    throw err;
  }
}

export { LlmError, LLM_ERROR_CODES, MockLlmProvider };
