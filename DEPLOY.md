# Deploying for free: Render (app) + Neon (Postgres database)

Accounts, photos and everything else are stored in a Neon Postgres database, so nothing is lost when Render redeploys or restarts the app.

## 1. Create the database (Neon)
1. Sign up at neon.tech (free, no card).
2. Create a project. In the dashboard click **Connect** and copy the connection string. It looks like
   `postgresql://user:password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`
3. Keep it secret. It is the password to your data.

The tables are created automatically the first time the app starts.

## 2. Push the project to GitHub
```
git add .
git commit -m "describe the change"
git push
```

## 3. Create the web service (Render, free plan)
1. render.com -> **New** -> **Web Service** -> pick your GitHub repo.
2. Language/Runtime: **Docker**. Dockerfile path: `backend/Dockerfile`. Docker build context: `.` (the repo root).
3. Instance type: **Free**.
4. Environment variables (Advanced):
   - `NODE_ENV` = `production`
   - `DATABASE_URL` = the Neon connection string
   - `JWT_ACCESS_SECRET` = a random string, 32+ characters
   - `JWT_REFRESH_SECRET` = a different random string, 32+ characters

   To make a random string: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
5. Health check path: `/api/health`.
6. Create. When the log says `listening ... (postgres)`, open the `https://<name>.onrender.com` link.

## 4. Changing things afterwards
Edit, run `npm test` in `backend/`, then `git add . && git commit -m "..." && git push`. Render redeploys by itself. Your data stays in Neon.

## Free-plan behaviour
- Render's free service goes to sleep after about 15 minutes with no visitors. The next visit takes up to a minute to wake it. Logged-in users stay logged in.
- Neon's free database also pauses when idle and wakes automatically on the next request.
- Use the https link. Login cookies are `Secure` in production.

## Running locally
Leave `DATABASE_URL` empty and the app uses a local SQLite file (`npm install`, `npm start`, open http://localhost:3000).
To try it against Postgres locally, set `DATABASE_URL` and start as usual. To run the tests on Postgres, use a database whose URL contains `test`: the tests empty it first and refuse to run otherwise.
