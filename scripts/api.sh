#!/usr/bin/env bash
# api.sh — QOL endpoint tester. Hit any endpoint without writing curl by hand.
#
# Usage:
#   ./scripts/api.sh health                          # GET /api/health
#   ./scripts/api.sh player '{"action":"init","deviceId":"dev1"}'
#   ./scripts/api.sh idle   '{"playerId":"<uuid>","action":"claim"}'
#   ./scripts/api.sh battle_v2 '{"difficulty":10,"rarity":5,"baseAttack":"2500000000","multipliers":[6,5,4],"critChance":3,"critMult":3,"armorPen":0.9}'
#
# Target defaults to production; override with API_BASE:
#   API_BASE=http://localhost:3000/api ./scripts/api.sh health
set -euo pipefail

API_BASE="${API_BASE:-https://sequence10.vercel.app/api}"
ENDPOINT="${1:?usage: api.sh <endpoint> [json-body]}"
BODY="${2:-}"

URL="$API_BASE/$ENDPOINT"

# health is GET, everything else POST
if [ "$ENDPOINT" = "health" ]; then
  METHOD="GET"
else
  METHOD="POST"
  BODY="${BODY:-{}}"
fi

echo "→ $METHOD $URL ${BODY:+($BODY)}" >&2

if [ "$METHOD" = "GET" ]; then
  RESP=$(curl -sS "$URL")
else
  RESP=$(curl -sS -X POST "$URL" -H "Content-Type: application/json" -d "$BODY")
fi

# pretty-print if jq present, else raw
if command -v jq >/dev/null 2>&1; then
  echo "$RESP" | jq .
else
  echo "$RESP"
fi
