const crypto = require('crypto');

const SECRET = process.env.ADMIN_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_EXP_MS = 24 * 60 * 60 * 1000; // 24 hours

function createToken(username) {
  const payload = JSON.stringify({ user: username, ts: Date.now() });
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + sig;
}

function parseToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const payloadB64 = parts[0];
  const sig = parts[1];
  let payloadStr;
  try {
    payloadStr = Buffer.from(payloadB64, 'base64').toString('utf8');
  } catch (e) {
    return null;
  }
  const expected = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (e) {
    return null;
  }
  try {
    const p = JSON.parse(payloadStr);
    if (Date.now() - p.ts > TOKEN_EXP_MS) return null;
    return p.user;
  } catch (e) {
    return null;
  }
}

module.exports = { createToken, parseToken };
