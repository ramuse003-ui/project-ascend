# Build from the project root so the frontend is included:
#   docker build -f backend/Dockerfile -t iris .
FROM node:22-slim AS deps
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

FROM node:22-slim
# DATABASE_URL (Postgres) is set by the host; without it the app falls back to SQLite in /data
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY backend/package*.json ./backend/
COPY backend/src ./backend/src
COPY frontend ./frontend
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
WORKDIR /app/backend
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
