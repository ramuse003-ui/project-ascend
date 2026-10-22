const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const v = require('../validators');
const { issueTokens, clearTokens, rotateRefresh, revokeAll, sha256 } = require('../auth');
const { parsePhoto, putPhoto } = require('../photos');
const { saveDetails } = require('../details');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT || 20),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

// Compared against when the roll number is unknown, so response time doesn't reveal which rolls exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const isUniqueViolation = (e) => e && (e.code === '23505' || /UNIQUE constraint failed/i.test(e.message || ''));

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const d = v.register.parse(req.body);
    const photo = d.photo ? parsePhoto(d.photo) : null; // validate before touching the database
    const taken = { error: 'An account with this roll number already exists' };
    if (await db.get('SELECT 1 AS x FROM students WHERE lower(roll) = lower(?)', [d.roll])) return res.status(409).json(taken);
    const hash = bcrypt.hashSync(d.password, 12);

    let studentId;
    try {
      studentId = await db.tx(async (t) => {
        const row = await t.get(
          'INSERT INTO students (roll, name, password_hash, semester, credits, cgpa) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
          [d.roll, d.name, hash, d.semester, d.credits, d.cgpa]
        );
        const id = Number(row.id);
        for (const c of d.courses) {
          await t.run('INSERT INTO courses (student_id, code, name, attended, total) VALUES (?, ?, ?, ?, ?)', [id, c.code, c.name, c.attended, c.total]);
        }
        await saveDetails(t, id, d.details);
        if (photo) await putPhoto(t, id, photo);
        return id;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return res.status(409).json(taken); // two sign-ups raced for the same roll number
      throw e;
    }

    await issueTokens(res, studentId);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const d = v.login.parse(req.body);
    const row = await db.get('SELECT id, password_hash FROM students WHERE lower(roll) = lower(?)', [d.roll]);
    const ok = bcrypt.compareSync(d.password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !ok) return res.status(401).json({ error: 'Incorrect roll number or password' });
    await issueTokens(res, row.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const id = await rotateRefresh(req, res);
    if (!id) { clearTokens(res); return res.status(401).json({ error: 'Please sign in again' }); }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies && req.cookies.refresh;
    if (token) await db.run('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?', [sha256(token)]);
    clearTokens(res);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.revokeAll = revokeAll;
