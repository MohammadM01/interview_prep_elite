import dns from 'node:dns';
import { MongoClient, ServerApiVersion } from 'mongodb';
import { config } from './index.js';

// Ensure resilient SRV resolution on Windows and various DNS networks
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Use default OS DNS servers if custom setServers is restricted
}

let client = null;
let db = null;
let clientPromise = null;

const clientOptions = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  },
  maxPoolSize: 20,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 8000
};

export async function connectToDatabase() {
  if (db) {
    return { client, db };
  }

  if (!config.mongodbUri) {
    throw new Error('MONGODB_URI is not defined in configuration');
  }

  try {
    if (!clientPromise) {
      client = new MongoClient(config.mongodbUri, clientOptions);
      clientPromise = client.connect();
    }

    await clientPromise;
    db = client.db('interview_prep_elite');

    await db.command({ ping: 1 });
    console.log('MongoDB Atlas connection established');

    await initDatabaseIndexes();

    return { client, db };
  } catch (error) {
    console.error('Failed to connect to MongoDB Atlas:', error.message);
    clientPromise = null;
    client = null;
    db = null;
    throw error;
  }
}

export async function initDatabaseIndexes() {
  if (!db) return;

  try {
    const usersCollection = db.collection('users');
    await usersCollection.createIndex({ email: 1 }, { unique: true });

    const kitsCollection = db.collection('kits');
    await kitsCollection.createIndex({ user_id: 1, created_at: -1 });

    const jobsCollection = db.collection('generation_jobs');
    await jobsCollection.createIndex({ user_id: 1, created_at: -1 });
    await jobsCollection.createIndex({ kit_id: 1 });

    const researchCollection = db.collection('research_results');
    await researchCollection.createIndex({ user_id: 1, created_at: -1 });
    await researchCollection.createIndex({ kit_id: 1 });

    console.log('Database indexes initialized successfully');
  } catch (error) {
    console.error('Error initializing database indexes:', error.message);
  }
}

export function getDatabase() {
  return db;
}

export function getMongoClient() {
  return client;
}

export function getMongoClientPromise() {
  if (!clientPromise) {
    client = new MongoClient(config.mongodbUri, clientOptions);
    clientPromise = client.connect();
  }
  return clientPromise;
}

export async function checkDatabaseHealth() {
  if (!db) {
    return 'disconnected';
  }
  try {
    await db.command({ ping: 1 });
    return 'connected';
  } catch {
    return 'disconnected';
  }
}

export async function closeDatabaseConnection() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    clientPromise = null;
    console.log('MongoDB connection closed cleanly');
  }
}

process.on('SIGINT', async () => {
  await closeDatabaseConnection();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDatabaseConnection();
  process.exit(0);
});
