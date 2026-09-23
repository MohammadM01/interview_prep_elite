import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '../../../.env');

dotenv.config();
dotenv.config({ path: rootEnvPath });

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  mongodbUri: process.env.MONGODB_URI || '',
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-change-in-production',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash'
};
