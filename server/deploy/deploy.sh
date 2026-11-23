#!/usr/bin/env bash
# Build locally, copy the bundle + Mini App to the VPS, restart. No node_modules needed on the box.
# First time only: scp server/deploy/shoptill.service canned-vps:/etc/systemd/system/ ; create /opt/shoptill/.env ;
# append server/deploy/Caddyfile.snippet to the Caddyfile and `systemctl reload caddy`; `systemctl enable shoptill`.
set -euo pipefail
cd "$(dirname "$0")/../.."
HOST="${DEPLOY_HOST:-canned-vps}"
npm run build -w @shoptill/server
npm run build -w shoptill-pay
ssh "$HOST" 'mkdir -p /opt/shoptill/dist /opt/shoptill/pay && touch /opt/shoptill/.env && chmod 600 /opt/shoptill/.env'
scp server/dist/server.mjs "$HOST:/opt/shoptill/dist/server.mjs"
rsync -a --delete apps/pay/dist/ "$HOST:/opt/shoptill/pay/" 2>/dev/null || scp -r apps/pay/dist/. "$HOST:/opt/shoptill/pay/"
ssh "$HOST" 'systemctl restart shoptill && sleep 1 && systemctl is-active shoptill && curl -fsS http://127.0.0.1:8799/healthz'
