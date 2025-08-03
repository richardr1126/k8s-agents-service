#!/bin/bash

# Check for required arguments
if [ "$#" -ne 6 ]; then
    echo "Usage: $0 <postgres_password> <aws_secret_access_key> <langfuse_secret_key> <aws_account_id> <ci_commit_short_sha> <aws_region>"
    exit 1
fi

# Assign arguments to variables
APP_POSTGRES_PASSWORD="$1"
CI_COMMIT_SHORT_SHA="$2"

# Delete existing secrets and create new ones
kubectl delete secret agents-service-platform-postgresql-auth --ignore-not-found
kubectl delete secret app-secrets --ignore-not-found

# Create PostgreSQL authentication secret
kubectl create secret generic agents-service-platform-postgresql-auth \
  --from-literal=postgres-password="${APP_POSTGRES_PASSWORD}" \
  --from-literal=password="${APP_POSTGRES_PASSWORD}" \
  --from-literal=replication-password="${APP_POSTGRES_PASSWORD}"

# Create application secrets
kubectl create secret generic app-secrets \
  --from-literal=USE_FAKE_MODEL=false \
  --from-literal=HOST=0.0.0.0 \
  --from-literal=PORT=8080 \
  --from-literal=DATABASE_TYPE=postgres \
  --from-literal=POSTGRES_USER=agents-service-platform \
  --from-literal=POSTGRES_PASSWORD="${APP_POSTGRES_PASSWORD}" \
  --from-literal=POSTGRES_HOST=agents-service-platform-postgresql.default.svc.cluster.local \
  --from-literal=POSTGRES_PORT=5432 \
  --from-literal=POSTGRES_DB=postgres

# Upgrade or install the Helm chart
helm upgrade --install agents-service-platform ./agents-service-platform \
  --set image.repository="" \
  --set image.tag="${CI_COMMIT_SHORT_SHA}"

echo "Platform deployment completed successfully!"