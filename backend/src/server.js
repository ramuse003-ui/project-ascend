const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { ZodError } = require('zod');
const config = require('./config');
const { purgeExpired } = require('./auth');
const db = require('./db');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // the frontend loads icon fonts/CSS from the IRIS CDN, Google Fonts and cdnjs, and uses data: photo previews
        'default-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.iris.nitk.ac.in', 'https://cdn.linearicons.com', 'https://cdnjs.cloudflare.com'],
        'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdn.iris.nitk.ac.in', 'https://cdn.linearicons.com', 'https://cdnjs.cloudflare.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https://cdn.iris.nitk.ac.in'],
        'script-src': ["'self'", "'unsafe-inline'"],
        'script-src-attr': ["'unsafe-inline'"],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  app.use(cookieParser());
  app.use(express.json({ limit: '6mb' })); // photo arrives as a base64 data URL (validated to 2 MB decoded)

  // Cross-site request guard for state-changing calls (cookies are SameSite=Lax; this is defence in depth).
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin) {
      let host;
      try { host = new URL(origin).host; } catch { return res.status(403).json({ error: 'Bad origin' }); }
      if (host !== req.get('host')) return res.status(403).json({ error: 'Cross-site request blocked' });
    }
    next();
  });

  // wait for the schema to exist before serving any API call
  app.use('/api', (req, res, next) => db.ready.then(() => next(), next));

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/me', require('./routes/me'));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the frontend from the same origin (no CORS needed).
  if (fs.existsSync(config.frontendDir)) {
    app.use(express.static(config.frontendDir, { index: 'index.html', dotfiles: 'ignore' }));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ZodError) {
      const fields = {};
      for (const i of err.issues) fields[i.path.join('.') || '_'] = i.message;
      return res.status(400).json({ error: err.issues[0].message, fields });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}

if (require.main === module) {
  db.ready.then(() => {
    const app = createApp();
    const purge = () => purgeExpired().catch((e) => console.error('purge failed:', e.message));
    purge();
    setInterval(purge, 6 * 60 * 60 * 1000).unref();
    app.listen(config.port, () => console.log(`IRIS backend listening on http://localhost:${config.port} (${db.kind})`));
  }).catch(() => process.exit(1));
}

module.exports = { createApp };
