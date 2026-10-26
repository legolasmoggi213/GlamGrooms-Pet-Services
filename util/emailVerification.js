const crypto = require('crypto');
const { firestore } = require('../config/firebase');
const { sendLoginVerificationCode } = require('./mailer');

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const RESEND_DELAY_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const HASH_SECRET = process.env.ADMIN_SECRET || crypto.randomBytes(32).toString('hex');
const challenges = firestore.collection('loginVerificationCodes');

class VerificationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'VerificationError';
    this.status = status;
  }
}

const challengeKey = (purpose, email) => crypto
  .createHash('sha256')
  .update(`${purpose}:${String(email).trim().toLowerCase()}`)
  .digest('hex');

const codeHash = (challengeId, code) => crypto
  .createHmac('sha256', HASH_SECRET)
  .update(`${challengeId}:${code}`)
  .digest('hex');

const createVerificationChallenge = async ({ email, purpose, metadata = {} }) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const ref = challenges.doc(challengeKey(purpose, normalizedEmail));
  const previous = await ref.get();
  const now = Date.now();
  if (previous.exists && now - Number(previous.data().sentAt || 0) < RESEND_DELAY_MS) {
    throw new VerificationError('A verification code was sent recently. Please wait a minute before requesting another.', 429);
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const challengeId = crypto.randomUUID();
  const sent = await sendLoginVerificationCode({ to: normalizedEmail, code, purpose });
  if (!sent) throw new Error('Email verification is not configured. Configure SMTP or Resend before enabling sign-in.');

  await ref.set({
    challengeId,
    email: normalizedEmail,
    purpose,
    codeHash: codeHash(challengeId, code),
    metadata,
    attempts: 0,
    sentAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
  });
  return { challengeId };
};

const verifyAtRef = async ({ ref, email, purpose, challengeId, code }) => {
  const result = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new VerificationError('Request a new verification code and try again.');

    const challenge = snapshot.data();
    if (challenge.challengeId !== challengeId || challenge.purpose !== purpose
      || (email && challenge.email !== String(email).trim().toLowerCase())) {
      throw new VerificationError('That verification code is invalid. Request a new code and try again.');
    }
    if (Date.now() > challenge.expiresAt) {
      transaction.delete(ref);
      return { error: new VerificationError('That verification code has expired. Request a new code and try again.') };
    }
    if (challenge.attempts >= MAX_ATTEMPTS) {
      transaction.delete(ref);
      return { error: new VerificationError('Too many incorrect codes. Request a new code and try again.', 429) };
    }

    const submittedHash = codeHash(challengeId, String(code || '').trim());
    const valid = /^[0-9]{6}$/.test(String(code || '').trim())
      && crypto.timingSafeEqual(Buffer.from(submittedHash), Buffer.from(challenge.codeHash));
    if (!valid) {
      transaction.update(ref, { attempts: challenge.attempts + 1 });
      return { error: new VerificationError('That verification code is incorrect.') };
    }

    transaction.delete(ref);
    return { metadata: challenge.metadata || {} };
  });
  if (result.error) throw result.error;
  return result.metadata;
};

const verifyChallenge = async ({ email, purpose, challengeId, code }) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  return verifyAtRef({
    ref: challenges.doc(challengeKey(purpose, normalizedEmail)),
    email: normalizedEmail,
    purpose,
    challengeId,
    code,
  });
};

const verifyChallengeById = async ({ purpose, challengeId, code }) => {
  const matches = await challenges.where('challengeId', '==', challengeId).limit(1).get();
  if (matches.empty) throw new VerificationError('Request a new verification code and try again.');
  return verifyAtRef({ ref: matches.docs[0].ref, purpose, challengeId, code });
};

module.exports = { createVerificationChallenge, verifyChallenge, verifyChallengeById, VerificationError };
