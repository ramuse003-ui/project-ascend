const config = require('./config');

// Photos live in the database (not on disk), so they survive redeploys on hosts with no persistent disk.
const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

// Verify the bytes really are the claimed image type (don't trust the data-URL header).
function sniff(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

/** Validates a data URL and returns { mime, buf }, or throws an Error with .status = 400. */
function parsePhoto(dataUrl) {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl);
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > config.maxPhotoBytes) { const e = new Error('Photo is larger than 2 MB'); e.status = 400; throw e; }
  const kind = sniff(buf);
  if (!kind) { const e = new Error('File is not a valid image'); e.status = 400; throw e; }
  return { mime: MIME[kind], buf };
}

// q is the db or a transaction handle
const putPhoto = (q, studentId, { mime, buf }) => q.run(
  `INSERT INTO student_photos (student_id, mime, data, updated_at) VALUES (?, ?, ?, ?)
   ON CONFLICT (student_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
  [studentId, mime, buf, Date.now()]
);
const removePhoto = (q, studentId) => q.run('DELETE FROM student_photos WHERE student_id = ?', [studentId]);
const getPhoto = (q, studentId) => q.get('SELECT mime, data FROM student_photos WHERE student_id = ?', [studentId]);

module.exports = { parsePhoto, putPhoto, removePhoto, getPhoto };
