#!/usr/bin/env bash
# Switch the live server between testnet (default) and a mainnet pilot.
# Each network has its own database, so testnet shops and sales are untouched by the pilot.
# Usage: bash server/deploy/network.sh mainnet|testnet
set -euo pipefail
cd "$(dirname "$0")/../.."
NET="${1:?mainnet or testnet}"
HOST="${DEPLOY_HOST:-canned-vps}"
case "$NET" in
  mainnet) DB=/opt/shoptill/data/shoptill-mainnet.db; JC=/opt/shoptill/mainnet.config.json ;;
  testnet) DB=/opt/shoptill/data/shoptill.db; JC=/opt/shoptill/testnet.config.json ;;
  *) echo "mainnet or testnet"; exit 1 ;;
esac
scp packages/core/mainnet.config.json "$HOST:/opt/shoptill/mainnet.config.json"
# Edits only these three lines; secrets in the file are never printed.
ssh "$HOST" "set -e; f=/opt/shoptill/.env; cp \$f \$f.bak; chmod 600 \$f.bak
  for kv in NETWORK=$NET DB_PATH=$DB JETTON_CONFIG=$JC; do k=\${kv%%=*}
    if grep -q \"^\$k=\" \$f; then sed -i \"s|^\$k=.*|\$kv|\" \$f; else echo \"\$kv\" >> \$f; fi; done
  systemctl restart shoptill; sleep 2; systemctl is-active shoptill
  journalctl -u shoptill -n 4 --no-pager | grep -E 'database|listening'"
