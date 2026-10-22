require('dotenv').config();
const path = require('path');
const crypto = require('crypto');

const isProd = process.env.NODE_ENV === 'production';

function secret(name) {
  const v = process.env[name];
  if (v && v.length >= 32) return v;
  if (isProd) throw new Error(`${name} must be set (32+ chars) in production`);
  // dev only: random per start, so sessions reset on restart
  return crypto.randomBytes(48).toString('hex');
}

module.exports = {
  isProd,
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || '',
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),
  frontendDir: path.resolve(process.env.FRONTEND_DIR || path.join(__dirname, '..', '..', 'frontend')),
  accessSecret: secret('JWT_ACCESS_SECRET'),
  refreshSecret: secret('JWT_REFRESH_SECRET'),
  accessTtlSec: 15 * 60,
  refreshTtlSec: 7 * 24 * 60 * 60,
  maxPhotoBytes: 2 * 1024 * 1024,
};
