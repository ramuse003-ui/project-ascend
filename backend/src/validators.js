const { z } = require('zod');

const roll = z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9]+$/, 'Roll number must be letters/digits only');
const password = z.string().min(8, 'Password must be at least 8 characters').max(72);
const text = (max) => z.string().trim().max(max);

const course = z.object({
  code: text(20).default(''),
  name: text(120).default(''),
  attended: z.coerce.number().int().min(0).max(1000).default(0),
  total: z.coerce.number().int().min(0).max(1000).default(0),
}).refine((c) => c.code || c.name, { message: 'Course needs a code or a name' })
  .refine((c) => c.attended <= c.total, { message: 'Attended classes cannot exceed total classes' });

const profileFields = {
  name: text(80).min(1),
  semester: z.coerce.number().int().min(1).max(12),
  credits: z.coerce.number().int().min(0).max(400),
  cgpa: z.coerce.number().min(0).max(10),
};

// ---- extended student details (shown on the Profile page) ----
const GENDERS = ['Male', 'Female', 'Other'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const CATEGORIES = ['General', 'EWS', 'OBC-NCL', 'Scheduled Caste', 'Scheduled Tribe'];
const DEGREES = ['B Tech', 'M Tech', 'MCA', 'MBA', 'M Sc', 'Ph D'];

const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').refine((s) => {
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getTime() <= Date.now() && d.getUTCFullYear() >= 1950;
}, 'Use a valid date that is not in the future');
const digits = (n, label) => z.string().trim().regex(new RegExp('^\\d{' + n + '}$'), label + ' must be exactly ' + n + ' digits');
const optional = (schema) => z.union([z.literal(''), schema]).default('');
const email = z.string().trim().toLowerCase().max(120).email('Enter a valid email address');

const detailFields = {
  fatherName: text(80).min(1, "Father's name is required"),
  gender: z.enum(GENDERS),
  dob: isoDate,
  bloodGroup: z.enum(BLOOD_GROUPS),
  nameHindi: text(80).default(''),
  motherTongue: text(40).default(''),
  email,
  nitkEmail: email,
  nationality: text(40).min(1, 'Nationality is required'),
  aadhaar: optional(digits(12, 'Aadhaar number')),
  phone: digits(10, 'Phone number'),
  parentsPhone: digits(10, "Parents' phone number"),
  address: text(300).min(1, 'Permanent address is required'),
  pincode: digits(6, 'Pincode'),
  country: text(40).min(1, 'Country is required'),
  regNo: text(20).min(1, 'Registration number is required').regex(/^[A-Za-z0-9]+$/, 'Registration number must be letters/digits only'),
  branch: text(80).min(1, 'Branch is required'),
  degree: z.enum(DEGREES),
  category: z.enum(CATEGORIES),
  admissionDate: isoDate,
  hostelRoom: text(80).default(''),
  apaarId: optional(digits(12, 'APAAR ID')),
};
const details = z.object(detailFields).refine((d) => d.admissionDate > d.dob, { message: 'Date of admission must be after date of birth', path: ['admissionDate'] });
const updateDetails = z.object({ ...detailFields, name: text(80).min(1) }).refine((d) => d.admissionDate > d.dob, { message: 'Date of admission must be after date of birth', path: ['admissionDate'] });

const photo = z.string().max(4_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Photo must be a PNG, JPEG or WebP image');

const register = z.object({
  roll, password, ...profileFields,
  courses: z.array(course).max(30).default([]),
  photo: photo.optional(),
  details,
});

const login = z.object({ roll, password: z.string().min(1).max(72) });
const updateProfile = z.object(profileFields).partial().refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });
const replaceCourses = z.object({ courses: z.array(course).max(30) });
const updateCourse = z.object({
  code: text(20), name: text(120),
  attended: z.coerce.number().int().min(0).max(1000),
  total: z.coerce.number().int().min(0).max(1000),
}).partial().refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });
const changePassword = z.object({ currentPassword: z.string().min(1).max(72), newPassword: password });
const photoBody = z.object({ photo });

module.exports = { details, updateDetails, register, login, updateProfile, replaceCourses, updateCourse, changePassword, photoBody };
