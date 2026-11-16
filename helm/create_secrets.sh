#!/bin/bash
# Creates `app-secrets` in the default namespace from helm/.env: API keys and settings for
# the agents service and its CronJob. The database settings aren't here; the chart points
# the pods at its CloudNativePG cluster (values.yaml).
#
# AUTH_SECRET must match the UI's BACKEND_AUTH_TOKEN on Vercel.
set -euo pipefail

ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found. It needs:"
  echo "  AUTH_SECRET OPENROUTER_API_KEY TAVILY_API_KEY GDRIVE_DOC_ID"
  echo "  and optionally LANGSMITH_API_KEY"
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

for var in AUTH_SECRET OPENROUTER_API_KEY TAVILY_API_KEY GDRIVE_DOC_ID; do
  if [ -z "${!var:-}" ]; then
    echo "Error: $var is not set in $ENV_FILE"
    exit 1
  fi
done

tracing=false
[ -n "${LANGSMITH_API_KEY:-}" ] && tracing=true

kubectl -n default create secret generic app-secrets \
  --from-literal=USE_FAKE_MODEL=false \
  --from-literal=AUTH_SECRET="${AUTH_SECRET}" \
  --from-literal=HOST=0.0.0.0 \
  --from-literal=PORT=8080 \
  --from-literal=OPENROUTER_API_KEY="${OPENROUTER_API_KEY}" \
  --from-literal=DEFAULT_MODEL="google/gemini-3.1-flash-lite-preview" \
  --from-literal=LANGSMITH_TRACING="${tracing}" \
  --from-literal=LANGSMITH_API_KEY="${LANGSMITH_API_KEY:-}" \
  --from-literal=LANGSMITH_PROJECT=default \
  --from-literal=TAVILY_API_KEY="${TAVILY_API_KEY}" \
  --from-literal=GDRIVE_DOC_ID="${GDRIVE_DOC_ID}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "app-secrets applied"
