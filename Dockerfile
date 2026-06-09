# agent-social — production image (Node 22+ for node:sqlite).
FROM node:22-slim
WORKDIR /app

# Install deps first (better layer caching).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# App source.
COPY src ./src
COPY web ./web

# SQLite lives here — mount a volume to persist across restarts.
RUN mkdir -p /app/data
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8088 \
    DB_PATH=/app/data/agent-social.db
EXPOSE 8088

# Basic healthcheck against the public endpoint.
HEALTHCHECK --interval=30s --timeout=4s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8088)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings", "src/server.js"]
