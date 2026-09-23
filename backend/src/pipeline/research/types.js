export const RESEARCH_DEFAULTS = {
  userAgent: process.env.RESEARCH_USER_AGENT || 'IPE-ResearchBot/1.0 (+https://github.com/MohammadM01/interview_prep_elite)',
  timeoutMs: parseInt(process.env.RESEARCH_TIMEOUT_MS || '10000', 10),
  maxHtmlBytes: parseInt(process.env.RESEARCH_MAX_HTML_BYTES || '1048576', 10), // 1 MB limit
  maxPages: parseInt(process.env.RESEARCH_MAX_PAGES || '8', 10),
  maxRedirects: 5,
  politenessDelayMs: 250
};

export const ERROR_CODES = {
  COMPANY_UNREACHABLE: 'COMPANY_UNREACHABLE',
  ROBOTS_BLOCKED: 'ROBOTS_BLOCKED',
  PAGE_FETCH_FAILED: 'PAGE_FETCH_FAILED',
  UNSUPPORTED_CONTENT_TYPE: 'UNSUPPORTED_CONTENT_TYPE',
  RESEARCH_EMPTY: 'RESEARCH_EMPTY',
  TIMEOUT: 'TIMEOUT',
  SSRF_BLOCKED: 'SSRF_BLOCKED',
  CONTENT_TOO_LARGE: 'CONTENT_TOO_LARGE'
};
