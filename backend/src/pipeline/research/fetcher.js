import { validateCompanyUrl } from '../../utils/urlValidator.js';
import { RESEARCH_DEFAULTS, ERROR_CODES } from './types.js';

export class FetchError extends Error {
  constructor(message, code, status = null) {
    super(message);
    this.name = 'FetchError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Robust HTTP fetcher enforcing SSRF protection, timeout, redirect validation, and content limits.
 *
 * @param {string} targetUrl
 * @param {Object} [options]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxBytes]
 * @param {number} [options.maxRedirects]
 * @param {boolean} [options.allowLocal=false]
 * @param {boolean} [options.isRobots=false]
 * @returns {Promise<{ ok: boolean, status: number, url: string, text: string, contentType: string }>}
 */
export async function safeFetch(targetUrl, options = {}) {
  const {
    timeoutMs = RESEARCH_DEFAULTS.timeoutMs,
    maxBytes = RESEARCH_DEFAULTS.maxHtmlBytes,
    maxRedirects = RESEARCH_DEFAULTS.maxRedirects,
    allowLocal = false,
    isRobots = false,
    userAgent = RESEARCH_DEFAULTS.userAgent
  } = options;

  let currentUrl = targetUrl;
  let redirectsCount = 0;

  while (redirectsCount <= maxRedirects) {
    // 1. Enforce SSRF validation on target / redirect destination
    const validation = validateCompanyUrl(currentUrl, { allowLocal });
    if (!validation.valid) {
      throw new FetchError(
        `URL blocked by security policy: ${validation.error}`,
        ERROR_CODES.SSRF_BLOCKED,
        400
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent': userAgent,
          'Accept': isRobots
            ? 'text/plain, text/html;q=0.8, */*;q=0.5'
            : 'text/html, application/xhtml+xml;q=0.9, text/plain;q=0.5',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        redirect: 'manual', // Manual redirection to validate every hop
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        throw new FetchError(
          `Request timed out after ${timeoutMs}ms`,
          ERROR_CODES.TIMEOUT,
          408
        );
      }
      throw new FetchError(
        `Network connection failed: ${err.message}`,
        ERROR_CODES.COMPANY_UNREACHABLE,
        500
      );
    } finally {
      clearTimeout(timeoutId);
    }

    // Handle redirects manually to inspect destination
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new FetchError(
          'Redirect response missing Location header',
          ERROR_CODES.PAGE_FETCH_FAILED,
          response.status
        );
      }

      redirectsCount++;
      if (redirectsCount > maxRedirects) {
        throw new FetchError(
          `Exceeded maximum allowed redirects (${maxRedirects})`,
          ERROR_CODES.PAGE_FETCH_FAILED,
          310
        );
      }

      currentUrl = new URL(location, currentUrl).href;
      continue;
    }

    // 2. Validate Content-Type
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!isRobots) {
      const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
      if (!isHtml && !contentType.includes('text/plain')) {
        throw new FetchError(
          `Unsupported response Content-Type: ${contentType}`,
          ERROR_CODES.UNSUPPORTED_CONTENT_TYPE,
          response.status
        );
      }
    }

    // 3. Read stream with byte length limit
    let rawText = '';
    const reader = response.body?.getReader();

    if (reader) {
      let receivedBytes = 0;
      const decoder = new TextDecoder('utf-8');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        receivedBytes += value.length;
        if (receivedBytes > maxBytes) {
          await reader.cancel();
          throw new FetchError(
            `Response exceeded size limit of ${maxBytes} bytes`,
            ERROR_CODES.CONTENT_TOO_LARGE,
            413
          );
        }

        rawText += decoder.decode(value, { stream: true });
      }
      rawText += decoder.decode();
    } else {
      rawText = await response.text();
      if (rawText.length > maxBytes) {
        throw new FetchError(
          `Response exceeded size limit of ${maxBytes} bytes`,
          ERROR_CODES.CONTENT_TOO_LARGE,
          413
        );
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      url: currentUrl,
      text: rawText,
      contentType
    };
  }

  throw new FetchError(
    'Too many redirects encountered',
    ERROR_CODES.PAGE_FETCH_FAILED,
    310
  );
}
