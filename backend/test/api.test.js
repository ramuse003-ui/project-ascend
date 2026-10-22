const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-test-'));
process.env.DATA_DIR = tmp;
process.env.AUTH_RATE_LIMIT = '1000';
const { createApp } = require('../src/server');

let server, base;
test.before(async () => {
  const db = require('../src/db');
  await db.ready;
  if (db.kind === 'postgres') {
    // never wipe a real database: only databases with "test" in the URL are accepted
    assert.ok(/test/i.test(process.env.DATABASE_URL), 'Refusing to run tests against a DATABASE_URL without "test" in it');
    await db.exec('TRUNCATE students RESTART IDENTITY CASCADE');
  }
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await require('../src/db').close(); // Windows can't delete a database file that is still open
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch { /* leftover temp folder is harmless; the OS cleans it up */ }
});

// minimal cookie jar
function client() {
  const jar = {};
  return async (method, url, body, headers = {}) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';'); const i = pair.indexOf('=');
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(sc)) delete jar[k]; else jar[k] = v;
    }
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, jar, data: ct.includes('json') ? await res.json() : await res.arrayBuffer() };
  };
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const user = {
  roll: 'TEST001', password: 'correct horse', name: 'Test Student', semester: 7, credits: 124, cgpa: 6.03,
  courses: [
    { code: 'IT365', name: 'Advanced Computer Networks', attended: 2, total: 6 },
    { code: 'IT488', name: 'Large Language Models', attended: 14, total: 21 },
    { code: 'IT400', name: 'Perfect', attended: 10, total: 10 },
  ],
  photo: PNG,
  details: {
    fatherName: 'Test Father', gender: 'Male', dob: '2004-07-15', bloodGroup: 'B+',
    nameHindi: 'टेस्ट नाम', motherTongue: 'Hindi', email: 'student@example.com',
    nitkEmail: 'student.test001@nitk.edu.in', nationality: 'India', aadhaar: '123456789012',
    phone: '9000000000', parentsPhone: '9000000000', address: '12 Sample Street\nSample City\nSample State',
    pincode: '560001', country: 'India', regNo: '1234567', branch: 'Information Technology',
    degree: 'B Tech', category: 'Scheduled Caste', admissionDate: '2023-08-17',
    hostelRoom: 'Hostel A - Room 101', apaarId: '',
  },
};

test('register -> dashboard data, CGPA hidden until requested', async () => {
  const api = client();
  const r = await api('POST', '/api/auth/register', user);
  assert.strictEqual(r.status, 201);
  assert.ok(r.jar.access && r.jar.refresh, 'cookies set');

  const me = await api('GET', '/api/me');
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.data.name, 'Test Student');
  assert.strictEqual(me.data.cgpa, undefined, 'cgpa must not be in dashboard payload');
  assert.strictEqual(me.data.password_hash, undefined);
  assert.strictEqual(me.data.courses.length, 3);
  const [a, b, c] = me.data.courses;
  assert.deepStrictEqual([a.percent, a.safe, a.needed], [33, false, 10]);  // matches the original screenshot
  assert.deepStrictEqual([b.percent, b.safe, b.needed], [67, false, 7]);   // matches the original screenshot
  assert.deepStrictEqual([c.percent, c.safe, c.needed], [100, true, 0]);

  const cg = await api('GET', '/api/me/cgpa');
  assert.strictEqual(cg.data.cgpa, '6.03');

  const photo = await api('GET', me.data.photoUrl);
  assert.strictEqual(photo.status, 200);
  assert.strictEqual(photo.headers.get('content-type'), 'image/png');
});

test('duplicate roll, bad input, wrong password', async () => {
  const api = client();
  assert.strictEqual((await api('POST', '/api/auth/register', user)).status, 409);
  assert.strictEqual((await api('POST', '/api/auth/register', { ...user, roll: 'X1', password: 'short' })).status, 400);
  assert.strictEqual((await api('POST', '/api/auth/register', { ...user, roll: 'B1B2B3', courses: [{ code: 'A', name: 'x', attended: 9, total: 3 }] })).status, 400);
  assert.strictEqual((await api('POST', '/api/auth/login', { roll: 'TEST001', password: 'wrong' })).status, 401);
  assert.strictEqual((await api('POST', '/api/auth/login', { roll: 'NOPE999', password: 'whatever1' })).status, 401);
  assert.strictEqual((await api('GET', '/api/me')).status, 401);
});

test('login is case-insensitive on roll; logout ends the session', async () => {
  const api = client();
  assert.strictEqual((await api('POST', '/api/auth/login', { roll: 'test001', password: 'correct horse' })).status, 200);
  assert.strictEqual((await api('GET', '/api/me')).status, 200);
  await api('POST', '/api/auth/logout');
  assert.strictEqual((await api('GET', '/api/me')).status, 401);
});

test('refresh rotates; reusing an old refresh token kills the session family', async () => {
  const api = client();
  await api('POST', '/api/auth/login', { roll: 'TEST001', password: 'correct horse' });
  const oldRefresh = api; // jar holds the first refresh token
  const first = (await api('GET', '/api/me')).jar.refresh;
  const r = await api('POST', '/api/auth/refresh');
  assert.strictEqual(r.status, 200);
  const second = r.jar.refresh;
  assert.notStrictEqual(first, second);

  // replay the stolen/old token
  const thief = client();
  const res = await fetch(base + '/api/auth/refresh', { method: 'POST', headers: { cookie: `refresh=${first}` } });
  assert.strictEqual(res.status, 401);
  // legit holder of the newer token is now also revoked
  const res2 = await fetch(base + '/api/auth/refresh', { method: 'POST', headers: { cookie: `refresh=${second}` } });
  assert.strictEqual(res2.status, 401);
});

test('course CRUD is scoped to the signed-in student', async () => {
  const a = client(), b = client();
  await a('POST', '/api/auth/login', { roll: 'TEST001', password: 'correct horse' });
  await b('POST', '/api/auth/register', { ...user, roll: 'OTHER01', name: 'Someone Else', courses: [{ code: 'ZZ1', name: 'Other', attended: 1, total: 2 }] });

  const bCourse = (await b('GET', '/api/me')).data.courses[0];
  assert.strictEqual((await a('PATCH', `/api/me/courses/${bCourse.id}`, { attended: 2 })).status, 404);
  assert.strictEqual((await a('DELETE', `/api/me/courses/${bCourse.id}`)).status, 404);

  const add = await a('POST', '/api/me/courses', { code: 'IT999', name: 'New', attended: 3, total: 4 });
  assert.strictEqual(add.status, 201);
  const mine = add.data.courses.find((c) => c.code === 'IT999');
  const upd = await a('PATCH', `/api/me/courses/${mine.id}`, { attended: 4, total: 4 });
  assert.strictEqual(upd.data.courses.find((c) => c.code === 'IT999').percent, 100);
  assert.strictEqual((await a('PATCH', `/api/me/courses/${mine.id}`, { attended: 9 })).status, 400);
  assert.strictEqual((await a('DELETE', `/api/me/courses/${mine.id}`)).status, 200);
});

test('photo validation: wrong bytes rejected, cross-site POST blocked', async () => {
  const a = client();
  await a('POST', '/api/auth/login', { roll: 'TEST001', password: 'correct horse' });
  const fake = 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64');
  assert.strictEqual((await a('PUT', '/api/me/photo', { photo: fake })).status, 400);
  assert.strictEqual((await a('PUT', '/api/me/photo', { photo: 'data:image/svg+xml;base64,AAAA' })).status, 400);
  assert.strictEqual((await a('PUT', '/api/me/photo', { photo: PNG })).status, 200);
  assert.strictEqual((await a('PUT', '/api/me', { cgpa: 7.1 }, { origin: 'https://evil.example' })).status, 403);
});

test('profile update + password change signs out other devices', async () => {
  const a = client(), other = client();
  await a('POST', '/api/auth/login', { roll: 'TEST001', password: 'correct horse' });
  await other('POST', '/api/auth/login', { roll: 'TEST001', password: 'correct horse' });
  const up = await a('PUT', '/api/me', { semester: 8, cgpa: 7.25 });
  assert.strictEqual(up.data.semester, 8);
  assert.strictEqual((await a('GET', '/api/me/cgpa')).data.cgpa, '7.25');

  assert.strictEqual((await a('POST', '/api/me/password', { currentPassword: 'nope nope', newPassword: 'brand new pass' })).status, 403);
  assert.strictEqual((await a('POST', '/api/me/password', { currentPassword: 'correct horse', newPassword: 'brand new pass' })).status, 200);
  assert.strictEqual((await a('GET', '/api/me')).status, 200);
  assert.strictEqual((await other('POST', '/api/auth/refresh')).status, 401, 'other device refresh token revoked');
  assert.strictEqual((await client()('POST', '/api/auth/login', { roll: 'TEST001', password: 'brand new pass' })).status, 200);
});

test('profile details: stored at registration, returned only to the owner, editable', async () => {
  const api = client();
  assert.strictEqual((await api('GET', '/api/me/details')).status, 401);
  await api('POST', '/api/auth/register', { ...user, roll: 'DET001' });
  const r = await api('GET', '/api/me/details');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.roll, 'DET001');
  assert.deepStrictEqual(r.data.details, user.details);
  // dashboard payload must not leak the sensitive fields
  const dash = await api('GET', '/api/me');
  assert.ok(!JSON.stringify(dash.data).includes('123456789012'));
  const up = await api('PUT', '/api/me/details', { ...user.details, name: 'T Student', hostelRoom: 'Hostel B - Room 202', apaarId: '210987654321' });
  assert.strictEqual(up.status, 200);
  assert.strictEqual(up.data.details.hostelRoom, 'Hostel B - Room 202');
  assert.strictEqual((await api('GET', '/api/me')).data.name, 'T Student');
});

test('profile details: validation rejects bad input', async () => {
  const api = client();
  const bad = (patch) => api('POST', '/api/auth/register', { ...user, roll: 'BAD' + Math.random().toString(36).slice(2, 7), details: { ...user.details, ...patch } });
  assert.strictEqual((await bad({ aadhaar: '123' })).status, 400);
  assert.strictEqual((await bad({ phone: '12345abcde' })).status, 400);
  assert.strictEqual((await bad({ pincode: '12' })).status, 400);
  assert.strictEqual((await bad({ email: 'nope' })).status, 400);
  assert.strictEqual((await bad({ dob: '2004-02-31' })).status, 400);
  assert.strictEqual((await bad({ dob: '2999-01-01' })).status, 400);
  assert.strictEqual((await bad({ admissionDate: '2003-01-01' })).status, 400);
  assert.strictEqual((await bad({ gender: 'x' })).status, 400);
  assert.strictEqual((await bad({ fatherName: '' })).status, 400);
  assert.strictEqual((await api('POST', '/api/auth/register', { ...user, roll: 'NODET1', details: undefined })).status, 400);
  // optional fields may be blank
  assert.strictEqual((await bad({ aadhaar: '', hostelRoom: '', nameHindi: '', apaarId: '' })).status, 201);
});
