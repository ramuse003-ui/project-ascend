const db = require('./db');

// camelCase API field  ->  snake_case column
const MAP = {
  fatherName: 'father_name', gender: 'gender', dob: 'dob', bloodGroup: 'blood_group',
  nameHindi: 'name_hindi', motherTongue: 'mother_tongue', email: 'email', nitkEmail: 'nitk_email',
  nationality: 'nationality', aadhaar: 'aadhaar', phone: 'phone', parentsPhone: 'parents_phone',
  address: 'address', pincode: 'pincode', country: 'country', regNo: 'reg_no', branch: 'branch',
  degree: 'degree', category: 'category', admissionDate: 'admission_date', hostelRoom: 'hostel_room',
  apaarId: 'apaar_id',
};
const KEYS = Object.keys(MAP);
const COLS = KEYS.map((k) => MAP[k]);

// q is the db or a transaction handle
function saveDetails(q, studentId, d) {
  return q.run(
    `INSERT INTO student_details (student_id, ${COLS.join(', ')})
     VALUES (?, ${COLS.map(() => '?').join(', ')})
     ON CONFLICT (student_id) DO UPDATE SET ${COLS.map((c) => `${c} = excluded.${c}`).join(', ')}`,
    [studentId, ...KEYS.map((k) => d[k])]
  );
}

// Returns null for accounts created before these fields existed.
async function loadDetails(studentId) {
  const row = await db.get('SELECT * FROM student_details WHERE student_id = ?', [studentId]);
  if (!row) return null;
  const out = {};
  for (const k of KEYS) out[k] = row[MAP[k]];
  return out;
}

module.exports = { saveDetails, loadDetails, KEYS };
