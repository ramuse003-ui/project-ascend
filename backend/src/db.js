// One small async interface over two drivers:
//   - PostgreSQL when DATABASE_URL is set (production: Neon, Supabase, Render Postgres, ...)
//   - SQLite (Node's built-in node:sqlite) otherwise (local development and tests)
// SQL is written once with "?" placeholders and works unchanged on both.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const usePg = !!config.databaseUrl;
const ID = usePg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
const NOW = usePg ? 'TIMESTAMPTZ NOT NULL DEFAULT now()' : "TEXT NOT NULL DEFAULT (datetime('now'))";
const BLOB = usePg ? 'BYTEA' : 'BLOB';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS students (
  id            ${ID},
  roll          TEXT NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  semester      INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 12),
  credits       INTEGER NOT NULL CHECK (credits >= 0),
  cgpa          DOUBLE PRECISION NOT NULL CHECK (cgpa BETWEEN 0 AND 10),
  created_at    ${NOW}
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_roll ON students (lower(roll));

CREATE TABLE IF NOT EXISTS student_photos (
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  data       ${BLOB} NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS student_details (
  student_id     INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  father_name    TEXT NOT NULL,
  gender         TEXT NOT NULL,
  dob            TEXT NOT NULL,
  blood_group    TEXT NOT NULL,
  name_hindi     TEXT NOT NULL DEFAULT '',
  mother_tongue  TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL,
  nitk_email     TEXT NOT NULL,
  nationality    TEXT NOT NULL,
  aadhaar        TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL,
  parents_phone  TEXT NOT NULL,
  address        TEXT NOT NULL,
  pincode        TEXT NOT NULL,
  country        TEXT NOT NULL,
  reg_no         TEXT NOT NULL,
  branch         TEXT NOT NULL,
  degree         TEXT NOT NULL,
  category       TEXT NOT NULL,
  admission_date TEXT NOT NULL,
  hostel_room    TEXT NOT NULL DEFAULT '',
  apaar_id       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS courses (
  id         ${ID},
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  code       TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL DEFAULT '',
  attended   INTEGER NOT NULL DEFAULT 0 CHECK (attended >= 0),
  total      INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  CHECK (attended <= total)
);
CREATE INDEX IF NOT EXISTS idx_courses_student ON courses(student_id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         ${ID},
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0
);
`;

const asBuffers = (row) => {
  if (!row) return row;
  for (const k of Object.keys(row)) if (row[k] instanceof Uint8Array && !Buffer.isBuffer(row[k])) row[k] = Buffer.from(row[k]);
  return row;
};

function makeSqlite() {
  const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+, no native build step
  fs.mkdirSync(config.dataDir, { recursive: true });
  const raw = new DatabaseSync(process.env.DB_FILE || path.join(config.dataDir, 'iris.db'));
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  // The connection is shared, so run one operation (or one whole transaction) at a time.
  let chain = Promise.resolve();
  const exclusive = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

  const ops = {
    get: async (sql, p = []) => asBuffers(raw.prepare(sql).get(...p)),
    all: async (sql, p = []) => raw.prepare(sql).all(...p).map(asBuffers),
    run: async (sql, p = []) => ({ changes: Number(raw.prepare(sql).run(...p).changes) }),
  };
  return {
    kind: 'sqlite',
    get: (s, p) => exclusive(() => ops.get(s, p)),
    all: (s, p) => exclusive(() => ops.all(s, p)),
    run: (s, p) => exclusive(() => ops.run(s, p)),
    tx: (fn) => exclusive(async () => {
      raw.exec('BEGIN');
      try { const r = await fn(ops); raw.exec('COMMIT'); return r; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
    }),
    exec: (sql) => exclusive(async () => raw.exec(sql)),
    close: async () => { await chain; raw.close(); },
    raw,
  };
}

function makePg() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: config.databaseUrl, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });
  pool.on('error', (e) => console.error('Postgres pool error:', e.message)); // idle connections may be closed by the host
  const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };
  const mk = (q) => ({
    get: async (sql, p = []) => (await q.query(toPg(sql), p)).rows[0],
    all: async (sql, p = []) => (await q.query(toPg(sql), p)).rows,
    run: async (sql, p = []) => ({ changes: (await q.query(toPg(sql), p)).rowCount }),
  });
  const ops = mk(pool);
  return {
    kind: 'postgres',
    ...ops,
    tx: async (fn) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn(mk(c));
        await c.query('COMMIT');
        return r;
      } catch (e) { try { await c.query('ROLLBACK'); } catch { /* connection already gone */ } throw e; }
      finally { c.release(); }
    },
    exec: (sql) => pool.query(sql),
    close: () => pool.end(),
  };
}

const db = usePg ? makePg() : makeSqlite();

// Older local SQLite databases kept photos as files; copy them into the database once.
async function migrateSqlitePhotos() {
  const cols = db.raw.prepare('PRAGMA table_info(students)').all().map((c) => c.name);
  if (!cols.includes('photo_file')) return;
  const dir = path.join(config.dataDir, 'uploads');
  const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
  for (const r of db.raw.prepare('SELECT id, photo_file FROM students WHERE photo_file IS NOT NULL').all()) {
    const file = path.basename(r.photo_file);
    try {
      const data = fs.readFileSync(path.join(dir, file));
      db.raw.prepare('INSERT OR IGNORE INTO student_photos (student_id, mime, data, updated_at) VALUES (?, ?, ?, ?)')
        .run(r.id, MIME[path.extname(file).slice(1)] || 'image/jpeg', data, Date.now());
    } catch { /* file missing: skip */ }
  }
}

db.ready = (async () => {
  await db.exec(SCHEMA);
  if (!usePg) await migrateSqlitePhotos();
})();
db.ready.catch((e) => { console.error('Database setup failed:', e.message); });

module.exports = db;
