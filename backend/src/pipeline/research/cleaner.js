import * as cheerio from 'cheerio';

/**
 * Deterministically cleans raw HTML, strips script/style/tracking noise,
 * and extracts title, meta description, structured headings, and sanitized body text.
 *
 * @param {string} rawHtml
 * @param {string} pageUrl
 * @param {Object} [options]
 * @param {number} [options.maxTextChars=15000]
 * @returns {{ url: string, title: string, description: string, headings: string[], text: string, rawLinks: Array<{ href: string, text: string }> }}
 */
export function cleanHtml(rawHtml, pageUrl, options = {}) {
  const { maxTextChars = 15000 } = options;

  if (typeof rawHtml !== 'string' || !rawHtml.trim()) {
    return {
      url: pageUrl,
      title: '',
      description: '',
      headings: [],
      text: '',
      rawLinks: []
    };
  }

  const $ = cheerio.load(rawHtml);

  // 1. Extract raw anchor links before removing navigational elements
  const rawLinks = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (href) {
      rawLinks.push({ href, text });
    }
  });

  // 2. Extract Title and Description
  const ogTitle = $('meta[property="og:title"]').attr('content') || '';
  const metaTitle = $('title').first().text().trim();
  const h1Title = $('h1').first().text().trim();
  const title = (ogTitle || metaTitle || h1Title || '').replace(/\s+/g, ' ');

  const metaDesc = $('meta[name="description"]').attr('content') || '';
  const ogDesc = $('meta[property="og:description"]').attr('content') || '';
  const description = (metaDesc || ogDesc || '').trim().replace(/\s+/g, ' ');

  // 3. Extract Headings (H1, H2, H3)
  const headings = [];
  $('h1, h2, h3').each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text && text.length > 2 && text.length < 200 && !headings.includes(text)) {
      headings.push(text);
    }
  });

  // 4. Strip noise elements
  $(
    'script, style, noscript, svg, iframe, canvas, form, button, nav, footer, [role="navigation"], [role="banner"], [aria-hidden="true"], .nav, .footer, .header, .cookie-banner, .advertisement'
  ).remove();

  // 5. Extract text from meaningful blocks (paragraphs, list items, articles)
  const textParts = [];

  $('article, main, section, p, li, blockquote').each((_, el) => {
    const blockText = $(el).text().trim().replace(/\s+/g, ' ');
    if (blockText && blockText.length > 20) {
      textParts.push(blockText);
    }
  });

  // Fallback to body text if block elements were scarce
  let cleanedText = textParts.join('\n\n');
  if (!cleanedText || cleanedText.length < 50) {
    cleanedText = $('body').text().trim().replace(/\s+/g, ' ');
  }

  // Remove duplicate sentences/paragraphs
  const paragraphs = cleanedText.split('\n\n');
  const seen = new Set();
  const deduped = [];

  for (const p of paragraphs) {
    const normalized = p.trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      deduped.push(normalized);
    }
  }

  let finalText = deduped.join('\n\n');
  if (finalText.length > maxTextChars) {
    finalText = finalText.slice(0, maxTextChars) + '...';
  }

  return {
    url: pageUrl,
    title,
    description,
    headings: headings.slice(0, 20),
    text: finalText,
    rawLinks
  };
}
