import { URL } from 'node:url';

const ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
  '.pdf', '.zip', '.tar', '.gz', '.mp4', '.mp3', '.mov',
  '.css', '.js', '.json', '.xml', '.rss'
]);

/**
 * Normalizes a URL by resolving against a base URL, removing hash fragments,
 * lowercasing the host, and stripping extraneous query parameters where applicable.
 *
 * @param {string} rawHref
 * @param {string} baseUrl
 * @returns {string | null}
 */
export function normalizeUrl(rawHref, baseUrl) {
  if (!rawHref || typeof rawHref !== 'string') {
    return null;
  }

  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
    return null;
  }

  try {
    const resolved = new URL(trimmed, baseUrl);

    // Only allow http and https
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null;
    }

    // Discard asset files
    const pathnameLower = resolved.pathname.toLowerCase();
    for (const ext of ASSET_EXTENSIONS) {
      if (pathnameLower.endsWith(ext)) {
        return null;
      }
    }

    // Strip hash fragment
    resolved.hash = '';

    // Standardize pathname trailing slash (remove trailing slash except for root)
    if (resolved.pathname.length > 1 && resolved.pathname.endsWith('/')) {
      resolved.pathname = resolved.pathname.slice(0, -1);
    }

    return resolved.href;
  } catch {
    return null;
  }
}

/**
 * Checks whether a candidate URL belongs to the company domain.
 * Permits the exact host, or immediate subdomains (e.g., careers.stripe.com, jobs.github.com).
 *
 * @param {string} candidateUrl
 * @param {string} baseCompanyUrl
 * @returns {boolean}
 */
export function isSameCompanyDomain(candidateUrl, baseCompanyUrl) {
  try {
    const candidateHost = new URL(candidateUrl).hostname.toLowerCase();
    const baseHost = new URL(baseCompanyUrl).hostname.toLowerCase();

    if (candidateHost === baseHost) {
      return true;
    }

    // Extract root domain (e.g. example.com from www.example.com or careers.example.com)
    const baseParts = baseHost.split('.');
    if (baseParts.length >= 2) {
      const rootDomain = baseParts.slice(-2).join('.');
      if (candidateHost.endsWith(`.${rootDomain}`)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Extracts, normalizes, domain-filters, and deduplicates all links from raw link items.
 *
 * @param {Array<{ href: string, text: string }>} rawLinks
 * @param {string} pageUrl
 * @param {string} baseCompanyUrl
 * @returns {Array<{ url: string, text: string }>}
 */
export function extractAndFilterLinks(rawLinks, pageUrl, baseCompanyUrl) {
  if (!Array.isArray(rawLinks)) return [];

  const seenUrls = new Set();
  const results = [];

  // Exclude current page URL from discovered candidates
  const normalizedPageUrl = normalizeUrl(pageUrl, baseCompanyUrl);
  if (normalizedPageUrl) {
    seenUrls.add(normalizedPageUrl);
  }

  for (const item of rawLinks) {
    const resolvedUrl = normalizeUrl(item.href, pageUrl);
    if (!resolvedUrl) continue;

    if (!isSameCompanyDomain(resolvedUrl, baseCompanyUrl)) {
      continue;
    }

    if (seenUrls.has(resolvedUrl)) {
      continue;
    }

    seenUrls.add(resolvedUrl);
    results.push({
      url: resolvedUrl,
      text: (item.text || '').trim().replace(/\s+/g, ' ')
    });
  }

  return results;
}
