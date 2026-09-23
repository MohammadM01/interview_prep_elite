import { GENERATION_DEFAULTS } from './types.js';

/**
 * Preprocesses and budget-bounds research content for the LLM.
 *
 * @param {Array<{ url: string, title: string, headings?: string[], text: string }>} pages
 * @param {Object} [options]
 * @param {number} [options.maxPageChars=3000]
 * @param {number} [options.maxTotalChars=12000]
 * @returns {Array<{ url: string, title: string, text: string }>}
 */
export function prepareResearchForPrompt(pages, options = {}) {
  const {
    maxPageChars = GENERATION_DEFAULTS.maxPageCharsForLlm,
    maxTotalChars = GENERATION_DEFAULTS.maxTotalResearchChars
  } = options;

  if (!Array.isArray(pages) || pages.length === 0) {
    return [];
  }

  let totalCharsAccumulated = 0;
  const budgetedPages = [];

  for (const page of pages) {
    if (totalCharsAccumulated >= maxTotalChars) {
      break;
    }

    const cleanTitle = (page.title || '').trim();
    const headingsText = Array.isArray(page.headings) && page.headings.length > 0
      ? `Key Sections: ${page.headings.slice(0, 5).join(' | ')}\n`
      : '';

    let bodyText = (page.text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Bound single page length safely
    if (bodyText.length > maxPageChars) {
      bodyText = `${bodyText.slice(0, maxPageChars)}... [truncated]`;
    }

    const combinedPageText = `${headingsText}${bodyText}`.trim();
    if (!combinedPageText) continue;

    const remainingBudget = maxTotalChars - totalCharsAccumulated;
    const finalPageText = combinedPageText.length > remainingBudget
      ? `${combinedPageText.slice(0, remainingBudget)}... [budget limit]`
      : combinedPageText;

    totalCharsAccumulated += finalPageText.length;

    budgetedPages.push({
      url: page.url,
      title: cleanTitle,
      text: finalPageText
    });
  }

  return budgetedPages;
}
