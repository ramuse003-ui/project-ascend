const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const v = require('../validators');
const { requireAuth, revokeAll, clearTokens, issueTokens } = require('../auth');
const { parsePhoto, putPhoto, removePhoto, getPhoto } = require('../photos');
const { saveDetails, loadDetails } = require('../details');

const router = express.Router();
router.use(requireAuth);

// Express 4 does not catch rejected promises, so every async handler goes through this.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const SAFE_THRESHOLD = 0.75;

function classesNeeded(attended, total) {
  if (total === 0 || attended / total >= SAFE_THRESHOLD) return { safe: true, needed: 0 };
  // smallest n with (attended+n)/(total+n) >= 0.75  ->  n = ceil((0.75*total - attended) / 0.25)
  const n = Math.ceil((SAFE_THRESHOLD * total - attended) / (1 - SAFE_THRESHOLD));
  return { safe: false, needed: Math.max(n, 0) };
}

function courseView(c) {
  const percent = c.total > 0 ? Math.round((c.attended / c.total) * 100) : 0;
  return { id: c.id, code: c.code, name: c.name, attended: c.attended, total: c.total, percent, ...classesNeeded(c.attended, c.total) };
}

async function profile(studentId) {
  const s = await db.get(
    `SELECT s.roll, s.name, s.semester, s.credits, p.updated_at AS photo_ver
       FROM students s LEFT JOIN student_photos p ON p.student_id = s.id WHERE s.id = ?`, [studentId]);
  const courses = (await db.all('SELECT * FROM courses WHERE student_id = ? ORDER BY id', [studentId])).map(courseView);
  return {
    roll: s.roll, name: s.name, semester: s.semester, credits: s.credits,
    photoUrl: s.photo_ver != null ? '/api/me/photo?v=' + encodeURIComponent(String(s.photo_ver)) : null,
    courses,
  };
}

// Dashboard data. CGPA is deliberately NOT here: it is only sent when the user presses the eye icon.
router.get('/', h(async (req, res) => res.json(await profile(req.studentId))));

router.get('/cgpa', h(async (req, res) => {
  const { cgpa } = await db.get('SELECT cgpa FROM students WHERE id = ?', [req.studentId]);
  res.json({ cgpa: Number(cgpa).toFixed(2) });
}));

// Full profile page data (personal, academic, hostel, additional). Sent only to the signed-in owner.
router.get('/details', h(async (req, res) => {
  const s = await db.get('SELECT roll, name, semester FROM students WHERE id = ?', [req.studentId]);
  res.json({ roll: s.roll, name: s.name, semester: s.semester, details: await loadDetails(req.studentId) });
}));

router.put('/details', h(async (req, res) => {
  const { name, ...d } = v.updateDetails.parse(req.body);
  await db.tx(async (t) => {
    await t.run('UPDATE students SET name = ? WHERE id = ?', [name, req.studentId]);
    await saveDetails(t, req.studentId, d);
  });
  const { roll } = await db.get('SELECT roll FROM students WHERE id = ?', [req.studentId]);
  res.json({ roll, name, details: await loadDetails(req.studentId) });
}));

router.put('/', h(async (req, res) => {
  const d = v.updateProfile.parse(req.body);
  const cols = Object.keys(d); // keys come from the validator's fixed schema, never from the request
  await db.run(`UPDATE students SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => d[c]), req.studentId]);
  res.json(await profile(req.studentId));
}));

// ---- photo ----
router.get('/photo', h(async (req, res) => {
  const p = await getPhoto(db, req.studentId);
  if (!p) return res.status(404).json({ error: 'No photo' });
  res.set('Content-Type', p.mime);
  res.set('Cache-Control', 'private, max-age=3600');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(p.data));
}));

router.put('/photo', h(async (req, res) => {
  const { photo } = v.photoBody.parse(req.body);
  await putPhoto(db, req.studentId, parsePhoto(photo));
  res.json(await profile(req.studentId));
}));

router.delete('/photo', h(async (req, res) => {
  await removePhoto(db, req.studentId);
  res.json(await profile(req.studentId));
}));

// ---- courses / attendance ----
router.put('/courses', h(async (req, res) => {
  const { courses } = v.replaceCourses.parse(req.body);
  await db.tx(async (t) => {
    await t.run('DELETE FROM courses WHERE student_id = ?', [req.studentId]);
    for (const c of courses) {
      await t.run('INSERT INTO courses (student_id, code, name, attended, total) VALUES (?, ?, ?, ?, ?)', [req.studentId, c.code, c.name, c.attended, c.total]);
    }
  });
  res.json(await profile(req.studentId));
}));

router.post('/courses', h(async (req, res) => {
  const { n } = await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM courses WHERE student_id = ?', [req.studentId]);
  if (n >= 30) return res.status(400).json({ error: 'Course limit reached' });
  const c = v.replaceCourses.shape.courses.element.parse(req.body);
  await db.run('INSERT INTO courses (student_id, code, name, attended, total) VALUES (?, ?, ?, ?, ?)', [req.studentId, c.code, c.name, c.attended, c.total]);
  res.status(201).json(await profile(req.studentId));
}));

router.patch('/courses/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'Course not found' });
  const cur = await db.get('SELECT * FROM courses WHERE id = ? AND student_id = ?', [id, req.studentId]);
  if (!cur) return res.status(404).json({ error: 'Course not found' });
  const d = v.updateCourse.parse(req.body);
  const next = { ...cur, ...d };
  if (next.attended > next.total) return res.status(400).json({ error: 'Attended classes cannot exceed total classes' });
  if (!next.code && !next.name) return res.status(400).json({ error: 'Course needs a code or a name' });
  await db.run('UPDATE courses SET code = ?, name = ?, attended = ?, total = ? WHERE id = ?', [next.code, next.name, next.attended, next.total, id]);
  res.json(await profile(req.studentId));
}));

router.delete('/courses/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  const r = Number.isInteger(id) ? await db.run('DELETE FROM courses WHERE id = ? AND student_id = ?', [id, req.studentId]) : { changes: 0 };
  if (!r.changes) return res.status(404).json({ error: 'Course not found' });
  res.json(await profile(req.studentId));
}));

// ---- password / account ----
router.post('/password', h(async (req, res) => {
  const d = v.changePassword.parse(req.body);
  const { password_hash } = await db.get('SELECT password_hash FROM students WHERE id = ?', [req.studentId]);
  if (!bcrypt.compareSync(d.currentPassword, password_hash)) return res.status(403).json({ error: 'Current password is incorrect' });
  await db.run('UPDATE students SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(d.newPassword, 12), req.studentId]);
  await revokeAll(req.studentId);           // sign out every other device
  await issueTokens(res, req.studentId);    // keep this one signed in
  res.json({ ok: true });
}));

router.delete('/', h(async (req, res) => {
  await db.run('DELETE FROM students WHERE id = ?', [req.studentId]); // photos, courses, details and tokens cascade
  clearTokens(res);
  res.json({ ok: true });
}));

module.exports = router;
