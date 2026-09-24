# Interview Preparation Elite (IPE)

Interview Preparation Elite (IPE) is a production-grade full-stack interview preparation system. It transforms a target job description (JD) and company URL into a comprehensive, personalized interview preparation kit featuring grounded company research, role analysis, requirement extraction, targeted interview questions, flashcards, a deterministic requirement coverage engine, a deterministic day-by-day study schedule, a full Builder Mode for editing and pinning items, and an interactive Practice Mode.

---

## 1. Architecture & Tech Stack

### Frontend Stack
- **Framework**: Next.js 16 (App Router)
- **Language**: JavaScript (ES modules)
- **Styling**: Tailwind CSS with custom editorial design tokens (clean, high-contrast, professional monochrome palette)
- **State & Routing**: React Context (`AuthContext`), standard Next.js navigation and URL query state (`?mode=questions|flashcards`)

### Backend Stack
- **Runtime**: Node.js 24 LTS
- **Server Framework**: Express.js
- **Database Driver**: Native MongoDB Driver (`mongodb` v6)
- **Session & Auth**: `express-session` with `connect-mongo` session store, `bcrypt` password hashing
- **Validation**: Zod schema validation on all inputs, intermediate pipeline artifacts, and API request payloads
- **Testing**: Node.js native test runner (`node:test`, `node:assert/strict`), Supertest

### Database
- **MongoDB Atlas** / MongoDB 7+:
  - `users`: User profiles with unique indexes on `email` and `username`
  - `sessions`: Persistent HTTP-only session storage
  - `kits`: Master preparation kit documents (Appendix A compliant)
  - `generation_jobs`: Asynchronous pipeline background job tracking
  - `research_results`: Cached, sanitized external web research pages
  - `practice_states`: User practice telemetry, confidence ratings, and review metrics

### LLM Provider
- **Model**: Google Gemini 2.5/3.6 (`gemini-2.5-flash` / `gemini-3.6-flash`)
- **Integration**: Direct native REST API calls with strict structured JSON schema enforcement
- **Fallback / Testing**: `MockLlmProvider` for deterministic offline testing and CI/CD evaluation

---

## 2. Setup & Environment Variables

### Installation
```bash
# Install root dependencies
npm install

# Install backend and frontend dependencies
npm install --prefix backend
npm install --prefix frontend
```

### Environment Variables
Create a `.env` file in the project root:

```env
# Application
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000

# Security & Sessions
SESSION_SECRET=your-secure-random-session-secret-min-32-chars
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax

# Database
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/interview_prep_elite?retryWrites=true&w=majority

# LLM Provider
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-2.5-flash
LLM_TIMEOUT_MS=30000

# Frontend Public API Base
NEXT_PUBLIC_API_URL=http://localhost:5000
```

### Running Locally
```bash
# Run backend development server (http://localhost:5000)
npm run dev:backend

# Run frontend development server (http://localhost:3000)
npm run dev:frontend
```

---

## 3. Security, Authentication & Web Research Design

### Authentication & Session Design
- **Session Store**: User sessions are persisted in MongoDB via `connect-mongo`.
- **Session Cookie**: Named `ipe.sid`, configured with `httpOnly: true`, customizable `sameSite` (`lax` or `none`), and `secure` in production.
- **No LocalStorage**: Sensitive auth state is never stored in browser `localStorage`.
- **Multi-Tenant Ownership Isolation**: All kit access, generation jobs, updates, and practice records strictly enforce `user_id` checks. Users cannot read or mutate other users' kits.

### Web Research, Crawling & SSRF Protection
- **SSRF Protection**: Resolves target hostnames against DNS and strictly blocks IPv4/IPv6 private and loopback ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`).
- **robots.txt Compliance**: Crawls and parses `/robots.txt` before fetching. Respects user-agent disallow directives and crawl delays.
- **Content Limits & Cleaning**: Limits fetched document size (max 2MB), validates content-type (`text/html`), and sanitizes markup with Cheerio (strips `<script>`, `<style>`, navigation, and footer elements).
- **Prompt Injection Defense**: Fetched untrusted HTML and job description text are isolated into structured data payloads and never concatenated as raw prompt instructions to the LLM.

---

## 4. LLM Generation Pipeline Sequence

The pipeline executes as a multi-stage background job with granular progress tracking:

```
[Target URL] ---> [SSRF Guard & robots.txt] ---> [Cheerio Cleaner] ---> [Research Pages]
                                                                                |
[Job Description] -----------------------------------------------------> [Requirement Extraction] (r1..rn)
                                                                                |
                                         +--------------------------------------+
                                         v
                         [Company Brief Generation]
                                         v
                         [Role Analysis & Grounding]
                                         v
                      [Question Generation (q1..qn)]
                                         v
                      [Flashcard Generation (f1..fn)]
                                         v
                 [Deterministic Coverage Pass 1 Check]
                                         |
                       (Are Must/Should covered?)
                       /                        \
                    [Yes]                       [No]
                     |                            |
                     |                 [Pass 2 Targeted Generation]
                     |                            |
                     +----------------------------+
                                         v
                    [Deterministic Day Schedule Allocation]
                                         v
                         [Complete Kit Persisted]
```

### 1. Requirement Extraction
Extracts grounded technical, behavioral, and educational requirements categorized by priority (`must`, `should`, `nice`) and assigns deterministic IDs (`r1, r2, ...`).

### 2. Company Brief & Role Analysis
Synthesizes verified facts from crawled pages and aligns the job role, seniority level, and core responsibilities with the extracted requirements.

### 3. Question & Flashcard Generation
Generates targeted interview questions with categories, prompts, answer outlines, difficulty ratings (1–3), and linked requirement IDs. Generates complementary study flashcards (`f1, f2, ...`).

### 4. Coverage Engine (Two-Pass Guarantee)
- **Deterministic Code Logic**: Coverage is calculated by deterministic algorithms in backend code, not by LLM self-reporting.
- **Pass 1**: Checks whether all `must` and `should` requirements are covered by at least one generated question.
- **Pass 2**: If any `must` or `should` requirements remain uncovered, targeted questions covering *only* the uncovered requirements are generated and appended.
- **Honest Reporting**: Requirements still uncovered after Pass 2 are honestly reported in `coverage.uncovered_requirement_ids`. `nice` requirements are not forced to be covered.

### 5. Deterministic Study Scheduler
- **Zero LLM Logic**: Built entirely with deterministic code algorithms.
- **Configurable Days**: Generates exactly `days_available` days (supports boundary conditions from 1 up to 60 days).
- **Integer Minutes**: Allocates daily study minutes as positive integers (standard 60 min/day budget).
- **Prioritization**: Prioritizes `must` requirements first, harder difficulty questions earlier (`difficulty 3 > 2 > 1`), and uses stable question ID tie-breaking.

---

## 5. Builder Mode & State Management

Builder Mode (`/kits/:id`) allows users to inspect, modify, and customize their generated preparation kit:

- **States**: Every question and flashcard tracks state: `'generated'`, `'edited'`, or `'pinned'`.
- **Interactive Editing**: Inline editing for question prompts, answer outlines, difficulties, and flashcards.
- **Reordering & Deletion**: Drag/move questions up and down or delete unwanted questions.
- **Pinned State**: Pinned items are locked and preserved across regeneration passes.
- **Merge Logic**: `mergeGeneratedContent()` deterministically merges new generation passes with existing user edits, preserving user overrides and pinned content while refreshing unpinned generated items.

---

## 6. Practice Mode & Least-Confidence Ordering

Practice Mode (`/kits/:id/practice`) delivers an interactive study environment:

- **Dual Modes**: Question practice mode and Flashcard review mode.
- **Confidence Rating**: Users rate their confidence as `low`, `medium`, or `high`.
- **Coverage Status**: Users toggle whether they have sufficiently covered the topic.
- **Least-Confidence Ordering**: Practice items are deterministically sorted to present `low` confidence items first, followed by `medium`, then `high`, and unpracticed items sorted by priority and difficulty.
- **Creative Feature (Weak Spots)**: Integrated directly as the least-confidence practice prioritization algorithm, focusing immediate user attention on areas of lowest self-rated confidence.

---

## 7. Assessment Evaluator

The assessment evaluator executes the **exact same end-to-end generation pipeline** as the web application against batch test cases and validates output against Appendix A requirements.

### Command
```bash
# Run batch evaluation against fixtures
npm run evaluate -- --input fixtures/cases.json --output kits.json

# Run evaluation with deterministic Mock provider (offline / CI)
npm run evaluate -- --input fixtures/cases.json --output kits.json --provider mock
```

### Test Cases in `fixtures/cases.json`
1. `case-01-healthy`: Healthy full-stack engineering JD with public company URL.
2. `case-02-thin-jd`: Minimal 1-sentence job description testing grounded generation without hallucination.
3. `case-03-invalid-url`: Invalid / unreachable domain testing resilient crawl failure handling.
4. `case-04-limited-research`: Generic domain with limited content testing sparse company brief synthesis.
5. `case-05-unusual-schedule-1day`: Extreme schedule boundary test (1-day intensive schedule).
6. `case-06-unusual-schedule-60days`: Extended schedule boundary test (60-day study plan).

### Evaluator Output
- Generates `kits.json` containing total counts, pass rates, per-case execution times, retry counts, generated kit payloads, and validation error arrays.
- Fails safely per case without halting the entire batch.

---

## 8. Automated Testing

Run the comprehensive backend test suite:

```bash
npm run test:backend
```

The test suite covers:
- **Authentication**: Registration, login, session persistence, logout, duplicate handling.
- **Multi-Tenant Ownership**: Kit isolation, unauthorized access rejection.
- **Research & Crawling**: SSRF blocking, robots.txt compliance, content-type checks, Cheerio extraction.
- **Generation & LLM**: JSON schema validation, retry logic on malformed responses, sequential IDs (`r`, `q`, `f`).
- **Coverage & Schedule**: 2-pass coverage logic, 1-day & 60-day boundary tests, integer minutes, priority ordering.
- **Builder Mode**: Persistence of edits, reordering, deletion, pinning, and deterministic merge rules.
- **Practice Mode**: Confidence ratings, coverage toggling, least-confidence sorting, user data isolation.
- **Evaluator Validation**: Appendix A compliance checks, stable ID checks, foreign key reference integrity.

---

## 9. Deployment Readiness & Production Configuration

### Production Build
```bash
# Build frontend Next.js production bundle
npm run build:frontend
```

### Backend Deployment Guidelines
1. Set `NODE_ENV=production`.
2. Configure `MONGODB_URI` pointing to your managed MongoDB Atlas cluster.
3. Set `CORS_ORIGIN` to your frontend production domain (e.g., `https://ipe.example.com`).
4. Set `COOKIE_SECURE=true` and ensure reverse proxy (Nginx, Render, AWS ALB) passes `X-Forwarded-Proto: https` (Express `trust proxy` is enabled).
5. If deploying backend and frontend on separate top-level domains, configure `COOKIE_SAME_SITE=none` and `COOKIE_SECURE=true`.
6. Start backend using `npm start --prefix backend` or `node backend/src/server.js`.

---

## 10. Tradeoffs, Limitations & Known Constraints

- **LLM Rate Limits**: Free-tier Gemini API keys are subject to strict per-minute quota limits (e.g. 20 requests/min). In high-volume batch evaluation, requests may experience transient rate limiting. Use `--provider mock` for rapid offline testing or upgrade to a pay-as-you-go key.
- **Web Crawling Limitations**: Single-page applications (SPAs) relying heavily on client-side JavaScript rendering may yield minimal static text during crawling. The brief generator gracefully handles this by grounding its synthesis in available meta tags and job description context.
- **Schedule Granularity**: Study schedules are budgeted on a per-day basis (60 min standard default) rather than per-hour calendar time slots, ensuring flexibility across diverse candidate preparation styles.