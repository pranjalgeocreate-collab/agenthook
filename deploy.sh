#!/usr/bin/env bash
# Deploy agent-social to a VPS over SSH. Builds + runs via Docker, persists the
# SQLite DB on a named volume, and (optionally) fronts it with Caddy for HTTPS.
#
# Usage:
#   SSH_HOST=1.2.3.4 SSH_USER=root [SSH_PORT=22] [DOMAIN=agents.example.com] ./deploy.sh
#
# Prereqs on the server: Docker installed (script installs it if missing on Debian/Ubuntu).
set -euo pipefail

: "${SSH_HOST:?set SSH_HOST}"
: "${SSH_USER:=root}"
: "${SSH_PORT:=22}"
APP=agent-social
REMOTE_DIR="/opt/${APP}"
DOMAIN="${DOMAIN:-}"

SSH="ssh -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST}"

echo "▶ 1/4  copying source to ${SSH_USER}@${SSH_HOST}:${REMOTE_DIR}"
$SSH "mkdir -p ${REMOTE_DIR}"
rsync -az --delete -e "ssh -p ${SSH_PORT}" \
  --exclude node_modules --exclude data --exclude '.git' --exclude '*.mp4' --exclude '/tmp' \
  ./ "${SSH_USER}@${SSH_HOST}:${REMOTE_DIR}/"

echo "▶ 2/4  ensuring Docker is present"
$SSH 'command -v docker >/dev/null 2>&1 || (curl -fsSL https://get.docker.com | sh)'

echo "▶ 3/4  build + run container (port 8088, persistent DB volume)"
$SSH "cd ${REMOTE_DIR} && docker build -t ${APP} . && \
  docker rm -f ${APP} 2>/dev/null || true && \
  docker volume create ${APP}-data >/dev/null && \
  docker run -d --name ${APP} --restart unless-stopped \
    -p 8088:8088 -e HOST=0.0.0.0 -e PORT=8088 -e DB_PATH=/app/data/agent-social.db \
    -v ${APP}-data:/app/data ${APP}"

if [ -n "$DOMAIN" ]; then
  echo "▶ 4/4  fronting with Caddy for automatic HTTPS on ${DOMAIN}"
  $SSH "docker rm -f ${APP}-caddy 2>/dev/null || true; \
    printf '%s {\n  reverse_proxy localhost:8088\n}\n' '${DOMAIN}' > /etc/${APP}.Caddyfile; \
    docker run -d --name ${APP}-caddy --restart unless-stopped --network host \
      -v /etc/${APP}.Caddyfile:/etc/caddy/Caddyfile \
      -v ${APP}-caddy-data:/data caddy:2"
  echo "✅ deployed → https://${DOMAIN}"
else
  echo "✅ deployed → http://${SSH_HOST}:8088   (set DOMAIN=... to add HTTPS)"
fi
