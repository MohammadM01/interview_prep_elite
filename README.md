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