#!/usr/bin/env bash
# Fresh demo state: new Allowance on testnet, empty payment history, agent gas top-up.
# Run from agent/ with the server stopped. Uses the local Sui keystore alias "owner"
# only for this one setup transaction; the key never touches .env.
set -euo pipefail
cd "$(dirname "$0")/.."

SUI=${SUI_BIN:-$HOME/.local/bin/sui}
OWNER_ALIAS=${OWNER_ALIAS:-owner}

if curl -s -m 2 -o /dev/null http://127.0.0.1:8787/; then
  echo "서버가 켜져 있습니다. Ctrl+C로 끈 뒤 다시 실행하세요." >&2
  exit 1
fi

rm -f data/activity.json data/activity.json.tmp
echo "결제 기록을 비웠습니다."

SETUP_OWNER_SECRET_KEY=$("$SUI" keytool export --key-identity "$OWNER_ALIAS" --json 2>/dev/null \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["exportedPrivateKey"])')
export SETUP_OWNER_SECRET_KEY
npm run setup
unset SETUP_OWNER_SECRET_KEY

echo
echo "완료. 이제 npm start 후 http://localhost:8787/?present=1 을 여세요."
