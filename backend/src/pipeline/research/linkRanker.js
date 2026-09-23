import { URL } from 'node:url';

const HIGH_POSITIVE_SIGNALS = [
  { pattern: /\b(careers?|jobs?|hiring|openings?|join(-us)?|work(-with-us|-at)?)\b/i, weight: 10 },
  { pattern: /\b(interviews?|interview-process|how-we-hire|hiring-process)\b/i, weight: 10 },
  { pattern: /\b(engineering|developers?|tech|technology|handbook)\b/i, weight: 8 },
  { pattern: /\b(culture|life|values|people|benefits)\b/i, weight: 6 },
  { pattern: /\b(about(-us)?|company|mission|who-we-are|team)\b/i, weight: 5 }
];

const NEGATIVE_SIGNALS = [
  { pattern: /\b(login|sign-?in|sign-?up|register|auth|password|account)\b/i, weight: -15 },
  { pattern: /\b(privacy(-policy)?|terms(-of-service)?|tos|cookies?|legal|compliance|security)\b/i, weight: -12 },
  { pattern: /\b(press|news|media|investors?|events?|webinars?)\b/i, weight: -6 },
  { pattern: /\b(support|help(-center)?|faq|contact(-us)?|pricing|cart|checkout)\b/i, weight: -8 }
];

/**
 * Calculates a deterministic relevance score for a link based on its anchor text and URL path.
 *
 * @param {string} url
 * @param {string} anchorText
 * @returns {number}
 */
export function scoreLink(url, anchorText = '') {
  let score = 0;
  let parsedPath = '';

  try {
    const parsed = new URL(url);
    parsedPath = `${parsed.pathname} ${parsed.search}`.toLowerCase();
  } catch {
    parsedPath = url.toLowerCase();
  }

  const combinedTarget = `${anchorText.toLowerCase()} ${parsedPath}`;

  // Evaluate positive signals
  for (const { pattern, weight } of HIGH_POSITIVE_SIGNALS) {
    if (pattern.test(anchorText)) {
      score += weight;
    }
    if (pattern.test(parsedPath)) {
      score += Math.round(weight * 0.8);
    }
  }

  // Evaluate negative signals
  for (const { pattern, weight } of NEGATIVE_SIGNALS) {
    if (pattern.test(anchorText) || pattern.test(parsedPath)) {
      score += weight;
    }
  }

  return score;
}

/**
 * Ranks discovered links and returns top-scoring candidates.
 *
 * @param {Array<{ url: string, text: string }>} links
 * @param {number} [limit=7]
 * @returns {Array<{ url: string, text: string, score: number }>}
 */
export function rankLinks(links, limit = 7) {
  if (!Array.isArray(links)) return [];

  const scored = links.map((link) => ({
    url: link.url,
    text: link.text,
    score: scoreLink(link.url, link.text)
  }));

  // Filter out clearly irrelevant/negative links and sort descending by score
  const filtered = scored.filter((item) => item.score > 0);

  filtered.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // Deterministic tie-breaker: shorter path depth preferred
    return a.url.length - b.url.length;
  });

  return filtered.slice(0, limit);
}
