# Interview Preparation Elite

Interview Preparation Elite is a full-stack application that transforms a job description and company website into a personalized interview preparation kit using structured company research, requirement extraction, categorized interview questions, flashcards, and a deterministic study schedule.

## Technology Stack

Frontend: Next.js 16 (App Router), JavaScript, Tailwind CSS
Backend: Node.js 24 LTS, Express, Native MongoDB driver
Database: MongoDB Atlas
Validation: Zod
Testing: Node Test Runner, Supertest

## Folder Structure

frontend/
  app/
  components/
  hooks/
  lib/
  public/

backend/
  src/
    config/
    controllers/
    middleware/
    models/
    pipeline/
    providers/
    routes/
    services/
    utils/
    app.js
    server.js
  tests/

scripts/
  evaluate.js

fixtures/
  cases.json

## Setup Instructions

1. Install root and service dependencies:

npm install --prefix backend
npm install --prefix frontend

2. Configure environment variables:

Copy .env.example to .env and configure the required values.

3. Run the development servers:

Frontend: npm run dev:frontend (runs on http://localhost:3000)
Backend: npm run dev:backend (runs on http://localhost:5000)

4. Run the batch evaluation command:

npm run evaluate -- --input fixtures/cases.json --output scratch/kits.json

## Pipeline & Deterministic Architecture

1. **Research & Crawling**: Deterministic crawling adhering to robots.txt, SSRF protection, cheerio cleaning, and deterministic page ranking.
2. **Requirement Extraction & Role Analysis**: Extracts grounded hiring requirements (`must`, `should`, `nice`) with deterministic `r1, r2...` IDs, grounded company brief, and role details.
3. **Question & Flashcard Generation**: Generates targeted interview questions (`q1, q2...`) and study flashcards (`f1, f2...`) strictly grounded in extracted requirements.
4. **Coverage Checking**:
   - Pure deterministic backend logic. The LLM does NOT decide coverage.
   - Evaluates whether all `must` and `should` requirements are covered by generated questions.
   - Performs at most two passes: Pass 1 on initial questions; Pass 2 generates targeted questions for uncovered requirements.
   - If requirements remain uncovered after Pass 2, they are preserved honestly in `coverage.uncovered_requirement_ids`.
5. **Deterministic Study Scheduler**:
   - Pure code logic (no LLM used for study schedule creation or time budgeting).
   - Generates exactly `days_available` days (from 1 up to 60 days).
   - Allocates deterministic integer study minutes (60 min/day standard budget).
   - Priority and difficulty ordering: `must` before `should` before `nice`, harder questions (`difficulty 3 > 2 > 1`) earlier, deterministic tie-breaking by ID.
   - Thin data produces an honest schedule without fabricated questions or fake company facts.