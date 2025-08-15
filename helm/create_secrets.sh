#!/bin/bash

# Script to create Kubernetes secrets for the k8s-agents-service
# This script only handles creating the application secrets from environment variables

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found at $ENV_FILE"
  echo "Please create a .env file with the following variables:"
  echo "APP_POSTGRES_PASSWORD=your_postgres_password"
  echo "OPENROUTER_API_KEY=your_openrouter_api_key"
  echo "LANGSMITH_API_KEY=your_langsmith_api_key"
  echo "AZURE_OPENAI_API_KEY=your_azure_openai_api_key"
  echo "TAVILY_API_KEY=your_tavily_api_key"
  exit 1
fi

# Load environment variables from .env file
echo "Loading environment variables from $ENV_FILE"
set -a  # automatically export all variables
source "$ENV_FILE"
set +a  # stop automatically exporting

# Validate that required variables are set
required_vars=("APP_POSTGRES_PASSWORD" "OPENROUTER_API_KEY" "LANGSMITH_API_KEY" "AZURE_OPENAI_API_KEY" "AUTH_SECRET" "TAVILY_API_KEY")
for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "Error: $var is not set in .env file"
    exit 1
  fi
done

# Delete existing secrets and create new ones
echo "Deleting existing app-secrets..."
kubectl delete secret app-secrets --ignore-not-found
echo "Deleting existing streamlit-secrets..."
kubectl delete secret streamlit-secrets --ignore-not-found

# Create application secrets
echo "Creating app-secrets..."
kubectl create secret generic app-secrets \
  --from-literal=USE_FAKE_MODEL=false \
  --from-literal=AUTH_SECRET="${AUTH_SECRET}" \
  --from-literal=HOST=0.0.0.0 \
  --from-literal=PORT=8080 \
  --from-literal=DATABASE_TYPE=postgres \
  --from-literal=POSTGRES_USER=agentsservice \
  --from-literal=POSTGRES_PASSWORD="${APP_POSTGRES_PASSWORD}" \
  --from-literal=POSTGRES_HOST=yb-tserver-0.yb-tservers.yugabyte.svc.cluster.local,yb-tserver-1.yb-tservers.yugabyte.svc.cluster.local \
  --from-literal=POSTGRES_PORT=5433 \
  --from-literal=POSTGRES_DB=agentsservice \
  --from-literal=OPENROUTER_API_KEY="${OPENROUTER_API_KEY}" \
  --from-literal=DEFAULT_MODEL="gpt-4o" \
  --from-literal=LANGSMITH_TRACING=true \
  --from-literal=LANGSMITH_API_KEY="${LANGSMITH_API_KEY}" \
  --from-literal=LANGSMITH_PROJECT=default \
  --from-literal=TAVILY_API_KEY="${TAVILY_API_KEY}" \
  --from-literal=AZURE_OPENAI_API_KEY="${AZURE_OPENAI_API_KEY}" \
  --from-literal=AZURE_OPENAI_ENDPOINT="https://k8s-agents-service.openai.azure.com/" \
  --from-literal=AZURE_OPENAI_API_VERSION="2025-04-01-preview" \
  --from-literal=AZURE_OPENAI_DEPLOYMENT_MAP='{"gpt-4o": "gpt-4o", "gpt-4.1": "gpt-4.1", "gpt-5-chat": "gpt-5-chat"}'

echo "Creating streamlit-secrets..."
kubectl create secret generic streamlit-secrets \
  --from-literal=AGENT_URL="https://agents.richardr.dev" \
  --from-literal=AUTH_SECRET="${AUTH_SECRET}"

echo "Secrets created successfully!"
