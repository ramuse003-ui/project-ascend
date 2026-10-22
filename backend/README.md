# IRIS backend

Node.js (22.13 or newer) + Express + a database: PostgreSQL when `DATABASE_URL` is set (production), otherwise SQLite (Node's built-in `node:sqlite`, nothing to compile). Photos are stored in the database too. It also serves the `../frontend` folder, so one command runs the whole site.

## Run locally
```bash
cd backend
cp .env.example .env   # Windows: copy .env.example .env      # dev works with no secrets set (sessions reset on restart)
npm install
npm start                 # http://localhost:3000
npm test                  # 7 integration tests against a throwaway database
```

## Run with Docker (from the project root)
```bash
# .env in the project root:  JWT_ACCESS_SECRET=...  JWT_REFRESH_SECRET=...  (32+ random chars each)
docker compose up --build
```
Without `DATABASE_URL`, data (SQLite file) lives in the `iris-data` volume. See `../DEPLOY.md` for the free Render + Neon setup.

## API
All bodies are JSON. Sessions are httpOnly cookies (`access` 15 min, `refresh` 7 days, rotated on every use).

| Method | Path | What it does |
|---|---|---|
| POST | `/api/auth/register` | `{roll, password, name, semester, credits, cgpa, courses[], details{}, photo?}` creates the account and signs in |
| POST | `/api/auth/login` | `{roll, password}` |
| POST | `/api/auth/refresh` | rotates the refresh token (old one stops working) |
| POST | `/api/auth/logout` | revokes the refresh token, clears cookies |
| GET | `/api/me` | name, roll, semester, credits, photoUrl, courses with `percent`, `safe`, `needed` (no CGPA) |
| GET | `/api/me/cgpa` | CGPA, fetched only when the eye icon is pressed |
| PUT | `/api/me` | update any of `name, semester, credits, cgpa` |
| GET/PUT/DELETE | `/api/me/photo` | photo (PUT takes `{photo: "data:image/png;base64,..."}`) |
| PUT | `/api/me/courses` | replace the whole course list |
| POST | `/api/me/courses` | add one course |
| PATCH/DELETE | `/api/me/courses/:id` | edit attendance / remove a course |
| POST | `/api/me/password` | `{currentPassword, newPassword}`, signs out other devices |
| DELETE | `/api/me` | delete the account and its data |

Errors look like `{ "error": "message", "fields": { "roll": "..." } }`.

## Security notes
- Passwords: bcrypt (cost 12, via `bcryptjs`), minimum 8 characters.
- Tokens: short-lived access JWT + rotating refresh JWT stored only as a SHA-256 hash; reusing an old refresh token revokes the whole session family.
- Helmet (CSP, nosniff, frame protection), rate limiting on login/register, Zod validation on every body.
- Photos: type checked by magic bytes (PNG/JPEG/WebP only, 2 MB), stored under generated names, served only to their owner.
- All queries are parameterised; every course route is scoped to the signed-in student.
- Unknown roll numbers take the same time as wrong passwords, and the error text is identical.
- Production refuses to start without strong JWT secrets. Serve it behind HTTPS (cookies are `Secure` in production).
