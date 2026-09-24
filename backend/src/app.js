import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import { config } from './config/index.js';
import { getMongoClientPromise, checkDatabaseHealth, connectToDatabase, getDatabase } from './config/database.js';
import authRoutes from './routes/auth.js';
import kitsRoutes from './routes/kits.js';
import jobsRoutes from './routes/jobs.js';

const app = express();

app.set('trust proxy', 1);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests or missing Origin header
    if (!origin) return callback(null, true);
    const origins = (process.env.CORS_ORIGIN || config.corsOrigin || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    if (origins.includes(origin)) {
      return callback(null, true);
    }
    if (config.corsOrigin === '*' || config.corsOrigin === 'true' || process.env.CORS_ORIGIN === '*') {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Set-Cookie'],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// Express session with MongoDB persistence
export const sessionStore = MongoStore.create({
  clientPromise: getMongoClientPromise(),
  dbName: 'interview_prep_elite',
  collectionName: 'sessions',
  ttl: 14 * 24 * 60 * 60,
  autoRemove: 'disabled'
});

app.use(session({
  name: 'ipe.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: '/',
    maxAge: 14 * 24 * 60 * 60 * 1000
  }
}));

// Ensure MongoDB connection is initialized for serverless environments
app.use(async (req, res, next) => {
  try {
    if (!getDatabase()) {
      await connectToDatabase();
    }
    next();
  } catch (err) {
    console.error('Database connection error in serverless request:', err.message);
    next(err);
  }
});

app.get('/api/health', async (req, res) => {
  const dbStatus = await checkDatabaseHealth();
  res.status(200).json({
    status: 'ok',
    environment: config.env,
    database: dbStatus,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/kits', kitsRoutes);
app.use('/api/generation-jobs', jobsRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'The requested endpoint was not found'
    }
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal server error occurred'
    }
  });
});

export default app;
