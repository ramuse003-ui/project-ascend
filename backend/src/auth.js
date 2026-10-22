const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const cookieBase = { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/' };

async function issueTokens(res, studentId) {
  const access = jwt.sign({ sub: studentId }, config.accessSecret, { expiresIn: config.accessTtlSec });
  const jti = crypto.randomBytes(16).toString('hex');
  const refresh = jwt.sign({ sub: studentId, jti }, config.refreshSecret, { expiresIn: config.refreshTtlSec });
  await db.run('INSERT INTO refresh_tokens (student_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [studentId, sha256(refresh), Math.floor(Date.now() / 1000) + config.refreshTtlSec]);
  res.cookie('access', access, { ...cookieBase, maxAge: config.accessTtlSec * 1000 });
  res.cookie('refresh', refresh, { ...cookieBase, path: '/api/auth', maxAge: config.refreshTtlSec * 1000 });
}

function clearTokens(res) {
  res.clearCookie('access', cookieBase);
  res.clearCookie('refresh', { ...cookieBase, path: '/api/auth' });
}

/** Rotate: a refresh token works once. Reuse of a revoked token revokes the whole family (stolen-token signal). */
async function rotateRefresh(req, res) {
  const token = req.cookies && req.cookies.refresh;
  if (!token) return null;
  let payload;
  try { payload = jwt.verify(token, config.refreshSecret); } catch { return null; }
  const row = await db.get('SELECT * FROM refresh_tokens WHERE token_hash = ?', [sha256(token)]);
  if (!row) return null;
  if (row.revoked) {
    await db.run('UPDATE refresh_tokens SET revoked = 1 WHERE student_id = ?', [row.student_id]);
    return null;
  }
  await db.run('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', [row.id]);
  await issueTokens(res, payload.sub);
  return payload.sub;
}

async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.access;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  let sub;
  try { ({ sub } = jwt.verify(token, config.accessSecret)); }
  catch { return res.status(401).json({ error: 'Session expired', code: 'TOKEN_EXPIRED' }); }
  try {
    const student = await db.get('SELECT id FROM students WHERE id = ?', [sub]);
    if (!student) return res.status(401).json({ error: 'Account no longer exists' });
    req.studentId = sub;
    next();
  } catch (e) { next(e); }
}

function revokeAll(studentId) {
  return db.run('UPDATE refresh_tokens SET revoked = 1 WHERE student_id = ?', [studentId]);
}

function purgeExpired() {
  return db.run('DELETE FROM refresh_tokens WHERE expires_at < ?', [Math.floor(Date.now() / 1000)]);
}

module.exports = { issueTokens, clearTokens, rotateRefresh, requireAuth, revokeAll, purgeExpired, sha256 };
