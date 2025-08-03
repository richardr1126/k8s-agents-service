#!/bin/bash

# Script to build and deploy the k8s-agents-service platform
# This script builds a multi-architecture Docker image and pushes it to GitHub Container Registry
# The image is made public and properly linked to the repository with OCI labels

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found at $ENV_FILE"
  echo "Please create a .env file with the following variables:"
  echo "ADMIN_POSTGRES_PASSWORD=your_postgres_password"
  echo "APP_POSTGRES_PASSWORD=your_postgres_password"
  echo "OPENROUTER_API_KEY=your_openrouter_api_key"
  echo "LANGSMITH_API_KEY=your_langsmith_api_key"
  echo "AZURE_OPENAI_API_KEY=your_azure_openai_api_key"
  echo "GITHUB_PAT=your_github_personal_access_token"
  exit 1
fi

# Load environment variables from .env file
echo "Loading environment variables from $ENV_FILE"
set -a  # automatically export all variables
source "$ENV_FILE"
set +a  # stop automatically exporting

# Validate that required variables are set
required_vars=("ADMIN_POSTGRES_PASSWORD" "APP_POSTGRES_PASSWORD" "OPENROUTER_API_KEY" "LANGSMITH_API_KEY" "AZURE_OPENAI_API_KEY" "GITHUB_PAT")
for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "Error: $var is not set in .env file"
    exit 1
  fi
done

# Docker login and build configuration
echo $GITHUB_PAT | docker login ghcr.io -u richardr1126 --password-stdin

REGISTRY="ghcr.io"
IMAGE_NAME="richardr1126/k8s-agents-service"
AGENTS_SERVICE_IMAGE="${REGISTRY}/${IMAGE_NAME}"

# Generate timestamp tag
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
IMAGE_TAG="${TIMESTAMP}"

echo "Building and pushing agents-service image with tag: ${IMAGE_TAG}..."
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t $AGENTS_SERVICE_IMAGE:$IMAGE_TAG \
  -t $AGENTS_SERVICE_IMAGE:latest \
  --push \
  --file "../docker/Dockerfile.service" \
  --label "org.opencontainers.image.source=https://github.com/richardr1126/k8s-agents-service" \
  --label "org.opencontainers.image.description=Kubernetes Agents Service" \
  --label "org.opencontainers.image.licenses=MIT" \
  ../. 

# Create the user and database
echo "Creating user..."
kubectl exec --namespace yugabyte -it yb-tserver-0 -- /bin/bash -c "export PGPASSWORD='${ADMIN_POSTGRES_PASSWORD}'; /home/yugabyte/bin/ysqlsh -h yb-tserver-0.yb-tservers.yugabyte -U ysqladmin -d yugabyte -c \"CREATE USER agentsservice WITH PASSWORD '${APP_POSTGRES_PASSWORD}' SUPERUSER CREATEDB CREATEROLE;\"" || true

echo "Creating database..."
kubectl exec --namespace yugabyte -it yb-tserver-0 -- /bin/bash -c "export PGPASSWORD='${ADMIN_POSTGRES_PASSWORD}'; /home/yugabyte/bin/ysqlsh -h yb-tserver-0.yb-tservers.yugabyte -U ysqladmin -d yugabyte -c \"CREATE DATABASE agentsservice OWNER agentsservice;\"" || true

# Connect to ysql shell
echo "Adding vector extension to YugabyteDB..."
kubectl exec --namespace yugabyte -it yb-tserver-0 -- /bin/bash -c "export PGPASSWORD='${APP_POSTGRES_PASSWORD}'; /home/yugabyte/bin/ysqlsh -h yb-tserver-0.yb-tservers.yugabyte -U agentsservice -d agentsservice -c \"CREATE EXTENSION vector;\"" || true

# Delete existing secrets and create new ones
kubectl delete secret app-secrets --ignore-not-found

# Create application secrets
kubectl create secret generic app-secrets \
  --from-literal=USE_FAKE_MODEL=false \
  --from-literal=HOST=0.0.0.0 \
  --from-literal=PORT=8080 \
  --from-literal=DATABASE_TYPE=postgres \
  --from-literal=POSTGRES_USER=agentsservice \
  --from-literal=POSTGRES_PASSWORD="${APP_POSTGRES_PASSWORD}" \
  --from-literal=POSTGRES_HOST=yb-tserver-0.yb-tservers.yugabyte.svc.cluster.local,yb-tserver-1.yb-tservers.yugabyte.svc.cluster.local \
  --from-literal=POSTGRES_PORT=5433 \
  --from-literal=POSTGRES_DB=agentsservice \
  --from-literal=OPENROUTER_API_KEY="${OPENROUTER_API_KEY}" \
  --from-literal=DEFAULT_MODEL="google/gemini-2.5-flash" \
  --from-literal=AUTH_SECRET="" \
  --from-literal=LANGSMITH_TRACING=true \
  --from-literal=LANGSMITH_API_KEY="${LANGSMITH_API_KEY}" \
  --from-literal=LANGSMITH_PROJECT=default \
  --from-literal=AZURE_OPENAI_API_KEY="${AZURE_OPENAI_API_KEY}" \
  --from-literal=AZURE_OPENAI_ENDPOINT="https://openai-research-pod.openai.azure.com/" \
  --from-literal=AZURE_OPENAI_API_VERSION="2025-02-01-preview" \
  --from-literal=AZURE_OPENAI_DEPLOYMENT_MAP='{"gpt-4o": "gpt-4o", "gpt-4o-mini": "gpt-4o-mini"}'

# Upgrade or install the Helm chart
helm upgrade --install agents-service ./agents-service \
  --set image.repository="${REGISTRY}/${IMAGE_NAME}" \
  --set image.tag="${IMAGE_TAG}"

echo "Platform deployment completed successfully with image tag: ${IMAGE_TAG}!"