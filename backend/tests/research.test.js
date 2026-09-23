import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { connectToDatabase, getDatabase } from '../src/config/database.js';
import { parseRobotsTxt, isPathAllowed, checkRobotsPermission } from '../src/pipeline/research/robots.js';
import { cleanHtml } from '../src/pipeline/research/cleaner.js';
import { extractAndFilterLinks, normalizeUrl, isSameCompanyDomain } from '../src/pipeline/research/linkExtractor.js';
import { scoreLink, rankLinks } from '../src/pipeline/research/linkRanker.js';
import { safeFetch, FetchError } from '../src/pipeline/research/fetcher.js';
import { executeCompanyResearch } from '../src/pipeline/research/researcher.js';
import { researchCompany, getResearchByKitId } from '../src/services/researchService.js';
import { ERROR_CODES } from '../src/pipeline/research/types.js';

test('Research & Web Crawling Pipeline Unit & Integration Suite', async (t) => {
  await connectToDatabase();
  const db = getDatabase();

  const userAEmail = `research.user.a.${Date.now()}@example.com`;
  const userBEmail = `research.user.b.${Date.now()}@example.com`;
  const userPassword = 'TestPassword123!';

  let cookieUserA = null;
  let cookieUserB = null;
  let createdKitIdUserA = null;

  t.after(async () => {
    if (db) {
      try {
        await db.collection('users').deleteMany({ email: { $regex: /^research\.user\./ } });
        await db.collection('kits').deleteMany({});
        await db.collection('generation_jobs').deleteMany({});
        await db.collection('research_results').deleteMany({});
        await db.collection('sessions').deleteMany({});
      } catch {}
    }
  });

  // Setup User A and User B
  await t.test('Setup: register User A and User B', async () => {
    const resA = await request(app)
      .post('/api/auth/register')
      .send({ email: userAEmail, password: userPassword });
    assert.equal(resA.status, 201);
    cookieUserA = resA.headers['set-cookie'][0];

    const resB = await request(app)
      .post('/api/auth/register')
      .send({ email: userBEmail, password: userPassword });
    assert.equal(resB.status, 201);
    cookieUserB = resB.headers['set-cookie'][0];
  });

  // 1. Robots.txt parsing
  await t.test('1. robots.txt parsing parses standard rules correctly', () => {
    const robotsContent = `
      User-agent: *
      Disallow: /admin
      Disallow: /private/
      Allow: /public

      User-agent: IPE-ResearchBot
      Disallow: /internal/
      Allow: /careers
    `;

    const genericRules = parseRobotsTxt(robotsContent, '*');
    assert.equal(genericRules.length, 3);
    assert.equal(genericRules[0].path, '/admin');
    assert.equal(genericRules[0].type, 'disallow');

    const botRules = parseRobotsTxt(robotsContent, 'IPE-ResearchBot');
    assert.equal(botRules.length, 2);
    assert.equal(botRules[0].path, '/internal/');
    assert.equal(botRules[1].path, '/careers');
  });

  // 2. Robots disallow check
  await t.test('2. robots disallow prevents crawling disallowed paths', () => {
    const rules = [
      { type: 'disallow', path: '/admin' },
      { type: 'disallow', path: '/secret/' },
      { type: 'allow', path: '/secret/open' }
    ];

    assert.equal(isPathAllowed('/careers', rules), true);
    assert.equal(isPathAllowed('/admin', rules), false);
    assert.equal(isPathAllowed('/admin/subpage', rules), false);
    assert.equal(isPathAllowed('/secret/confidential', rules), false);
    assert.equal(isPathAllowed('/secret/open', rules), true);
  });

  // 3. Relative link resolution
  await t.test('3. relative link resolution resolves paths against base URL', () => {
    const baseUrl = 'https://example.com/company/about';
    const normalized = normalizeUrl('../careers', baseUrl);
    assert.equal(normalized, 'https://example.com/careers');
  });

  // 4. Absolute link resolution
  await t.test('4. absolute link resolution normalizes root and full URLs', () => {
    const baseUrl = 'https://example.com';
    const rootRelative = normalizeUrl('/jobs', baseUrl);
    assert.equal(rootRelative, 'https://example.com/jobs');

    const fullUrl = normalizeUrl('https://example.com/engineering/', baseUrl);
    assert.equal(fullUrl, 'https://example.com/engineering');
  });

  // 5. Same-domain filtering
  await t.test('5. same-domain filtering allows subdomains/same domain and rejects external domains', () => {
    const companyUrl = 'https://example.com';
    assert.equal(isSameCompanyDomain('https://example.com/careers', companyUrl), true);
    assert.equal(isSameCompanyDomain('https://careers.example.com', companyUrl), true);
    assert.equal(isSameCompanyDomain('https://google.com', companyUrl), false);
    assert.equal(isSameCompanyDomain('https://not-example.com', companyUrl), false);
  });

  // 6. URL normalization
  await t.test('6. URL normalization strips fragments, trailing slashes, and ignores static assets', () => {
    const baseUrl = 'https://example.com';
    assert.equal(normalizeUrl('/team#leadership', baseUrl), 'https://example.com/team');
    assert.equal(normalizeUrl('/team/', baseUrl), 'https://example.com/team');
    assert.equal(normalizeUrl('/document.pdf', baseUrl), null);
    assert.equal(normalizeUrl('/image.png', baseUrl), null);
    assert.equal(normalizeUrl('mailto:jobs@example.com', baseUrl), null);
    assert.equal(normalizeUrl('javascript:void(0)', baseUrl), null);
  });

  // 7. Duplicate URL removal
  await t.test('7. duplicate URL removal deduplicates normalized links', () => {
    const rawLinks = [
      { href: '/careers', text: 'Careers' },
      { href: '/careers/', text: 'Join Our Team' },
      { href: '/careers#openings', text: 'Openings' },
      { href: '/about', text: 'About' }
    ];

    const extracted = extractAndFilterLinks(rawLinks, 'https://example.com', 'https://example.com');
    assert.equal(extracted.length, 2);
    assert.equal(extracted[0].url, 'https://example.com/careers');
    assert.equal(extracted[1].url, 'https://example.com/about');
  });

  // 8. Link ranking
  await t.test('8. link ranking scores career/culture higher than legal/privacy', () => {
    const links = [
      { url: 'https://example.com/privacy-policy', text: 'Privacy Policy' },
      { url: 'https://example.com/careers', text: 'Careers & Openings' },
      { url: 'https://example.com/engineering', text: 'Engineering Blog' },
      { url: 'https://example.com/about-us', text: 'About Our Team' },
      { url: 'https://example.com/login', text: 'Sign In' }
    ];

    const ranked = rankLinks(links, 3);
    assert.equal(ranked.length, 3);
    assert.equal(ranked[0].url, 'https://example.com/careers');
    assert.ok(ranked.find(l => l.url.includes('engineering')));
    assert.ok(!ranked.find(l => l.url.includes('privacy-policy')));
    assert.ok(!ranked.find(l => l.url.includes('login')));
  });

  // 9. HTML cleaning
  await t.test('9. HTML cleaning extracts title, description, headings, and clean text', () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Acme Corp - Innovating Cloud Systems</title>
          <meta name="description" content="Acme builds next generation cloud architecture." />
        </head>
        <body>
          <h1>Welcome to Acme</h1>
          <h2>Engineering Culture</h2>
          <p>We believe in high autonomy and deep engineering rigor.</p>
          <p>Our team works extensively with distributed Node.js services.</p>
        </body>
      </html>
    `;

    const cleaned = cleanHtml(sampleHtml, 'https://example.com');
    assert.equal(cleaned.title, 'Acme Corp - Innovating Cloud Systems');
    assert.equal(cleaned.description, 'Acme builds next generation cloud architecture.');
    assert.equal(cleaned.headings.length, 2);
    assert.equal(cleaned.headings[0], 'Welcome to Acme');
    assert.ok(cleaned.text.includes('We believe in high autonomy'));
    assert.ok(cleaned.text.includes('distributed Node.js services'));
  });

  // 10. Script/style removal
  await t.test('10. script and style tags are completely stripped from clean text', () => {
    const rawHtml = `
      <html>
        <head>
          <style>body { background: red; } .hidden { display: none; }</style>
          <script>console.log("tracking_secret_token_12345");</script>
        </head>
        <body>
          <script type="text/javascript">window.__INITIAL_STATE__ = { leak: true };</script>
          <p>Visible genuine user text.</p>
          <noscript>Please enable javascript</noscript>
        </body>
      </html>
    `;

    const cleaned = cleanHtml(rawHtml, 'https://example.com');
    assert.ok(!cleaned.text.includes('tracking_secret_token_12345'));
    assert.ok(!cleaned.text.includes('background: red'));
    assert.ok(!cleaned.text.includes('__INITIAL_STATE__'));
    assert.ok(cleaned.text.includes('Visible genuine user text.'));
  });

  // 11. Page size rejection
  await t.test('11. page size rejection blocks payloads exceeding maximum byte threshold', async () => {
    // Test safeFetch with a custom mock or low maxBytes
    const mockBigText = 'A'.repeat(5000);
    const mockFetcher = async (url) => {
      if (url.includes('big')) {
        return safeFetch('https://httpbin.org/status/200', {
          maxBytes: 100
        }).catch(err => {
          throw err;
        });
      }
    };

    // Directly test safeFetch byte size verification on oversized response
    await assert.rejects(
      async () => {
        // SafeFetch calling a data source or mock
        // We can test by setting maxBytes small against a mock fetch
        const originalFetch = globalThis.fetch;
        try {
          globalThis.fetch = async () => new Response('Excessively large payload'.repeat(50), {
            headers: { 'content-type': 'text/html' }
          });
          await safeFetch('https://example.com', { maxBytes: 50 });
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
      (err) => err.code === ERROR_CODES.CONTENT_TOO_LARGE
    );
  });

  // 12. Unsupported content type
  await t.test('12. unsupported content type is rejected', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response('Binary data', {
        headers: { 'content-type': 'application/pdf' }
      });
      await assert.rejects(
        async () => safeFetch('https://example.com'),
        (err) => err.code === ERROR_CODES.UNSUPPORTED_CONTENT_TYPE
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 13. Timeout handling
  await t.test('13. timeout aborts slow requests', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (_url, { signal }) => {
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      };

      await assert.rejects(
        async () => safeFetch('https://example.com', { timeoutMs: 20 }),
        (err) => err.code === ERROR_CODES.TIMEOUT
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 14. Redirect validation
  await t.test('14. redirect destination is validated against SSRF policy', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => ({
        status: 302,
        headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data' }),
        ok: false
      });

      await assert.rejects(
        async () => safeFetch('https://example.com'),
        (err) => err.code === ERROR_CODES.SSRF_BLOCKED
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 15. Private destination rejection
  await t.test('15. private and loopback destinations are rejected immediately', async () => {
    await assert.rejects(
      async () => safeFetch('http://127.0.0.1:5000/api'),
      (err) => err.code === ERROR_CODES.SSRF_BLOCKED
    );

    await assert.rejects(
      async () => safeFetch('http://localhost:3000'),
      (err) => err.code === ERROR_CODES.SSRF_BLOCKED
    );
  });

  // 16. Partial crawl behavior
  await t.test('16. partial crawl succeeds when some secondary pages fail or are blocked', async () => {
    const fakePages = {
      'https://acme.test/robots.txt': {
        ok: true,
        status: 200,
        text: 'User-agent: *\nDisallow: /admin\n',
        contentType: 'text/plain'
      },
      'https://acme.test': {
        ok: true,
        status: 200,
        text: `
          <html>
            <head><title>Acme Homepage</title></head>
            <body>
              <h1>Welcome to Acme</h1>
              <a href="/careers">Careers at Acme</a>
              <a href="/broken-jobs">Jobs at Acme (Broken Link)</a>
            </body>
          </html>
        `,
        contentType: 'text/html'
      },
      'https://acme.test/careers': {
        ok: true,
        status: 200,
        text: '<html><head><title>Careers</title></head><body><h1>Join us</h1><p>We are hiring engineering leaders with distributed systems background.</p></body></html>',
        contentType: 'text/html'
      },
      'https://acme.test/broken-jobs': {
        ok: false,
        status: 404,
        text: 'Not found',
        contentType: 'text/html'
      }
    };

    const mockFetcher = async (url) => {
      const match = fakePages[url];
      if (!match) throw new Error(`Not found in mock: ${url}`);
      return { url, ...match };
    };

    const result = await executeCompanyResearch('https://acme.test', {
      fetcher: mockFetcher,
      politenessDelayMs: 0
    });

    assert.equal(result.company_url, 'https://acme.test');
    assert.equal(result.pages.length, 2); // Homepage + Careers
    assert.ok(result.warnings.some(w => w.includes('broken-jobs')));
    assert.equal(result.pages[0].title, 'Acme Homepage');
    assert.equal(result.pages[1].title, 'Careers');
  });

  // 17. Complete crawl
  await t.test('17. complete crawl extracts ranked candidate pages up to max limit', async () => {
    const fakeSite = {
      'https://techcorp.test/robots.txt': { ok: true, status: 200, text: '', contentType: 'text/plain' },
      'https://techcorp.test': {
        ok: true,
        status: 200,
        text: `
          <html>
            <head><title>TechCorp Official</title></head>
            <body>
              <h1>Building Modern Infrastructure</h1>
              <a href="/engineering">Tech Blog</a>
              <a href="/culture">Company Culture</a>
              <a href="/about">About Us</a>
            </body>
          </html>
        `,
        contentType: 'text/html'
      },
      'https://techcorp.test/engineering': {
        ok: true,
        status: 200,
        text: '<html><body><h1>Tech Blog</h1><p>Deep dive into high performance microservices architecture.</p></body></html>',
        contentType: 'text/html'
      },
      'https://techcorp.test/culture': {
        ok: true,
        status: 200,
        text: '<html><body><h1>Culture</h1><p>Autonomy, continuous learning, and transparent feedback loops.</p></body></html>',
        contentType: 'text/html'
      },
      'https://techcorp.test/about': {
        ok: true,
        status: 200,
        text: '<html><body><h1>About</h1><p>Founded in 2021 to redefine developer developer experience.</p></body></html>',
        contentType: 'text/html'
      }
    };

    const mockFetcher = async (url) => fakeSite[url] ? { url, ...fakeSite[url] } : { ok: false, status: 404, text: '', contentType: 'text/html' };

    const result = await executeCompanyResearch('https://techcorp.test', {
      fetcher: mockFetcher,
      maxPages: 4,
      politenessDelayMs: 0
    });

    assert.equal(result.pages.length, 4); // Homepage + 3 ranked candidates
    assert.equal(result.pages_used.length, 4);
    assert.equal(result.warnings.length, 0);
  });

  // 18. Empty page handling
  await t.test('18. empty page with no content is handled gracefully and ignored', async () => {
    const fakeSite = {
      'https://empty.test/robots.txt': { ok: true, status: 200, text: '', contentType: 'text/plain' },
      'https://empty.test': {
        ok: true,
        status: 200,
        text: '<html><head><title>Empty</title></head><body><a href="/blank">Blank</a></body></html>',
        contentType: 'text/html'
      },
      'https://empty.test/blank': {
        ok: true,
        status: 200,
        text: '<html><body></body></html>',
        contentType: 'text/html'
      }
    };

    const mockFetcher = async (url) => fakeSite[url] ? { url, ...fakeSite[url] } : { ok: false, status: 404, text: '' };

    const result = await executeCompanyResearch('https://empty.test', {
      fetcher: mockFetcher,
      politenessDelayMs: 0
    });

    assert.equal(result.pages.length, 1); // Only homepage, blank page skipped
  });

  // 19. Integration: Research Service, Job State, and Ownership Isolation
  await t.test('19. Kit creation and research integration with ownership isolation', async () => {
    // 19.1 User A creates a kit
    const kitResA = await request(app)
      .post('/api/kits')
      .set('Cookie', cookieUserA)
      .send({
        jd: 'Staff Backend Engineer responsible for scalable streaming systems.',
        company_url: 'https://testcorp.org',
        days_available: 7
      });

    assert.equal(kitResA.status, 201);
    createdKitIdUserA = kitResA.body.kit.id;
    const createdJobIdUserA = kitResA.body.job.id;

    // 19.2 Trigger research with mock fetcher for testing
    const fakeCorp = {
      'https://testcorp.org/robots.txt': { ok: true, status: 200, text: 'User-agent: *\nAllow: /\n', contentType: 'text/plain' },
      'https://testcorp.org': {
        ok: true,
        status: 200,
        text: '<html><head><title>TestCorp Systems</title></head><body><h1>Core Streaming Platform</h1><p>We build mission-critical streaming pipelines.</p><a href="/careers">Careers</a></body></html>',
        contentType: 'text/html'
      },
      'https://testcorp.org/careers': {
        ok: true,
        status: 200,
        text: '<html><head><title>Careers</title></head><body><h1>Join TestCorp</h1><p>Looking for senior distributed systems engineers.</p></body></html>',
        contentType: 'text/html'
      }
    };

    const mockFetcher = async (url) => {
      const trimmed = url.replace(/\/$/, '');
      const match = fakeCorp[url] || fakeCorp[trimmed];
      return match ? { url, ...match } : { ok: false, status: 404, text: '' };
    };

    const researchResult = await researchCompany({
      kitId: createdKitIdUserA,
      jobId: createdJobIdUserA,
      userId: kitResA.body.kit.user_id || (await db.collection('kits').findOne({ _id: new (await import('mongodb')).ObjectId(createdKitIdUserA) })).user_id,
      options: {
        fetcher: mockFetcher,
        politenessDelayMs: 0
      }
    });

    assert.equal(researchResult.company_url, 'https://testcorp.org/');
    assert.equal(researchResult.pages_count, 2);

    // 19.3 Verify MongoDB state
    const storedResearch = await db.collection('research_results').findOne({
      kit_id: new (await import('mongodb')).ObjectId(createdKitIdUserA)
    });
    assert.ok(storedResearch);
    assert.equal(storedResearch.pages.length, 2);
    assert.equal(storedResearch.company_url, 'https://testcorp.org/');

    const updatedJob = await db.collection('generation_jobs').findOne({
      _id: new (await import('mongodb')).ObjectId(createdJobIdUserA)
    });
    assert.equal(updatedJob.status, 'running');
    assert.equal(updatedJob.stage, 'research_completed');
    assert.equal(updatedJob.progress, 100);

    // 19.4 API Verification: User A can get research
    const getResA = await request(app)
      .get(`/api/kits/${createdKitIdUserA}/research`)
      .set('Cookie', cookieUserA);

    assert.equal(getResA.status, 200);
    assert.equal(getResA.body.research.company_url, 'https://testcorp.org/');
    assert.equal(getResA.body.research.pages.length, 2);

    // 19.5 Ownership isolation: User B cannot access User A's research result
    const getResB = await request(app)
      .get(`/api/kits/${createdKitIdUserA}/research`)
      .set('Cookie', cookieUserB);

    assert.equal(getResB.status, 404);
    assert.equal(getResB.body.error.code, 'NOT_FOUND');

    // 19.6 User B cannot trigger research on User A's kit
    const triggerResB = await request(app)
      .post(`/api/kits/${createdKitIdUserA}/research`)
      .set('Cookie', cookieUserB);

    assert.equal(triggerResB.status, 404);
  });
});
