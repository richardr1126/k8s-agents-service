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
  echo "GITHUB_PAT=your_github_personal_access_token"
  exit 1
fi

# Load environment variables from .env file
echo "Loading environment variables from $ENV_FILE"
set -a  # automatically export all variables
source "$ENV_FILE"
set +a  # stop automatically exporting

# Validate that required variables are set
required_vars=("ADMIN_POSTGRES_PASSWORD" "APP_POSTGRES_PASSWORD" "GITHUB_PAT")
for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "Error: $var is not set in .env file"
    exit 1
  fi
done

# Docker login and build configuration
echo $GITHUB_PAT | docker login ghcr.io -u richardr1126 --password-stdin

REGISTRY="ghcr.io"
BASE_IMAGE_NAME="richardr1126/k8s-agents"

# Generate timestamp tag
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
IMAGE_TAG="${TIMESTAMP}"

# Build and push agents-service image
AGENTS_SERVICE_IMAGE="${REGISTRY}/${BASE_IMAGE_NAME}-service"
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

# Build and push agents-streamlit image
AGENTS_STREAMLIT_IMAGE="${REGISTRY}/${BASE_IMAGE_NAME}-streamlit"
echo "Building and pushing agents-streamlit image with tag: ${IMAGE_TAG}..."
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t $AGENTS_STREAMLIT_IMAGE:$IMAGE_TAG \
  -t $AGENTS_STREAMLIT_IMAGE:latest \
  --push \
  --file "../docker/Dockerfile.app" \
  --label "org.opencontainers.image.source=https://github.com/richardr1126/k8s-agents-service" \
  --label "org.opencontainers.image.description=Kubernetes Agents Streamlit" \
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

# Upgrade or install the Helm chart
helm upgrade --install agents-service ./agents-service \
  --set image.repository="${REGISTRY}/${BASE_IMAGE_NAME}-service" \
  --set image.tag="${IMAGE_TAG}" \
  --set agents-streamlit.image.repository="${REGISTRY}/${BASE_IMAGE_NAME}-streamlit" \
  --set agents-streamlit.image.tag="${IMAGE_TAG}"

echo "Platform deployment completed successfully with image tag: ${IMAGE_TAG}!"