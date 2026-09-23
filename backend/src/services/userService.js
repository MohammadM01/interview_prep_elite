import { ObjectId } from 'mongodb';
import argon2 from 'argon2';
import { getDatabase } from '../config/database.js';

export async function findUserByEmail(email) {
  const db = getDatabase();
  const normalizedEmail = email.trim().toLowerCase();
  return db.collection('users').findOne({ email: normalizedEmail });
}

export async function findUserById(id) {
  const db = getDatabase();
  try {
    const objectId = typeof id === 'string' ? new ObjectId(id) : id;
    return db.collection('users').findOne({ _id: objectId });
  } catch {
    return null;
  }
}

export async function createUser({ email, password }) {
  const db = getDatabase();
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    const error = new Error('An account with this email address already exists');
    error.code = 'EMAIL_ALREADY_EXISTS';
    error.status = 409;
    throw error;
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  });

  const now = new Date();
  const userDoc = {
    email: normalizedEmail,
    password_hash: passwordHash,
    created_at: now,
    updated_at: now
  };

  const result = await db.collection('users').insertOne(userDoc);
  userDoc._id = result.insertedId;

  return toSafeUser(userDoc);
}

export async function verifyUserPassword(storedHash, plainPassword) {
  try {
    return await argon2.verify(storedHash, plainPassword);
  } catch {
    return false;
  }
}

export function toSafeUser(user) {
  if (!user) return null;
  return {
    id: user._id.toString(),
    email: user.email,
    created_at: user.created_at
  };
}
