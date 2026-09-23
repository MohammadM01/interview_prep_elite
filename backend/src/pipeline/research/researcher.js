import { safeFetch, FetchError } from './fetcher.js';
import { checkRobotsPermission, isPathAllowed } from './robots.js';
import { cleanHtml } from './cleaner.js';
import { extractAndFilterLinks } from './linkExtractor.js';
import { rankLinks } from './linkRanker.js';
import { RESEARCH_DEFAULTS, ERROR_CODES } from './types.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes the company research pipeline in distinct deterministic stages.
 *
 * @param {string} companyUrl
 * @param {Object} [options]
 * @param {number} [options.maxPages]
 * @param {Function} [options.onProgress]
 * @param {boolean} [options.allowLocal=false]
 * @param {Function} [options.fetcher] Custom fetcher for testing
 * @returns {Promise<{ company_url: string, researched_at: string, pages: Array, pages_used: string[], warnings: string[] }>}
 */
export async function executeCompanyResearch(companyUrl, options = {}) {
  const {
    maxPages = RESEARCH_DEFAULTS.maxPages,
    onProgress,
    allowLocal = false,
    fetcher = (url, opts) => safeFetch(url, { ...opts, allowLocal }),
    politenessDelayMs = RESEARCH_DEFAULTS.politenessDelayMs
  } = options;

  const warnings = [];
  const pages = [];
  const pagesUsed = [];

  onProgress?.({ stage: 'checking_robots', progress: 10 });

  // Stage 1: Check robots.txt
  let robotsRules = [];
  try {
    const robotsResult = await checkRobotsPermission(companyUrl, { fetcher });
    robotsRules = robotsResult.rules || [];
    if (robotsResult.warning) {
      warnings.push(robotsResult.warning);
    }

    if (!robotsResult.allowed) {
      warnings.push(`Homepage disallowed by robots.txt, proceeding cautiously for public metadata.`);
    }
  } catch (err) {
    warnings.push(`Robots check error: ${err.message}`);
  }

  onProgress?.({ stage: 'fetching_homepage', progress: 25 });

  // Stage 2: Fetch and clean homepage
  let homepageFetch;
  try {
    homepageFetch = await fetcher(companyUrl);
  } catch (err) {
    throw new FetchError(
      `Company homepage could not be reached: ${err.message}`,
      err.code || ERROR_CODES.COMPANY_UNREACHABLE,
      err.status || 500
    );
  }

  if (!homepageFetch.ok) {
    throw new FetchError(
      `Company homepage returned HTTP ${homepageFetch.status}`,
      ERROR_CODES.COMPANY_UNREACHABLE,
      homepageFetch.status
    );
  }

  const cleanedHomepage = cleanHtml(homepageFetch.text, homepageFetch.url);
  pages.push({
    url: cleanedHomepage.url,
    title: cleanedHomepage.title,
    description: cleanedHomepage.description,
    headings: cleanedHomepage.headings,
    text: cleanedHomepage.text,
    source_type: 'company_site'
  });
  pagesUsed.push(cleanedHomepage.url);

  onProgress?.({ stage: 'discovering_links', progress: 50 });

  // Stage 3: Extract and rank links
  const discoveredLinks = extractAndFilterLinks(
    cleanedHomepage.rawLinks,
    cleanedHomepage.url,
    companyUrl
  );

  const candidateSlots = Math.max(0, maxPages - 1);
  const rankedCandidates = rankLinks(discoveredLinks, candidateSlots);

  onProgress?.({
    stage: 'fetching_pages',
    progress: 60,
    discoveredCount: discoveredLinks.length,
    selectedCount: rankedCandidates.length
  });

  // Stage 4: Fetch selected candidate pages with politeness delay
  let completedCandidateSteps = 0;
  for (const candidate of rankedCandidates) {
    // Check robots permission for candidate path
    try {
      const candidatePath = new URL(candidate.url).pathname;
      if (!isPathAllowed(candidatePath, robotsRules)) {
        warnings.push(`Skipped ${candidate.url} (disallowed by robots.txt)`);
        continue;
      }
    } catch {
      // Path parsing error; proceed with fetch
    }

    if (politenessDelayMs > 0) {
      await sleep(politenessDelayMs);
    }

    try {
      const candidateFetch = await fetcher(candidate.url);
      if (candidateFetch.ok) {
        const cleanedPage = cleanHtml(candidateFetch.text, candidateFetch.url);
        // Only include if meaningful text content exists
        if (cleanedPage.text.length > 50 || cleanedPage.headings.length > 0) {
          pages.push({
            url: cleanedPage.url,
            title: cleanedPage.title || candidate.text,
            description: cleanedPage.description,
            headings: cleanedPage.headings,
            text: cleanedPage.text,
            source_type: 'company_site'
          });
          pagesUsed.push(cleanedPage.url);
        }
      } else {
        warnings.push(`Failed to fetch ${candidate.url} (HTTP ${candidateFetch.status})`);
      }
    } catch (err) {
      warnings.push(`Error retrieving ${candidate.url}: ${err.message}`);
    }

    completedCandidateSteps++;
    const pageProgress = 60 + Math.round((completedCandidateSteps / Math.max(1, rankedCandidates.length)) * 35);
    onProgress?.({ stage: 'fetching_pages', progress: Math.min(95, pageProgress) });
  }

  onProgress?.({ stage: 'research_complete', progress: 100 });

  return {
    company_url: companyUrl,
    researched_at: new Date().toISOString(),
    pages,
    pages_used: pagesUsed,
    warnings
  };
}
