#!/bin/bash

# Script to update Helm chart dependencies
# This script should be run from the helm directory

set -e

echo "🔄 Updating Helm chart dependencies..."

# Navigate to the agents-service chart directory
cd agents-service

# Update dependencies
echo "📦 Updating dependencies for agents-service chart..."
helm dependency update

echo "✅ Dependencies updated successfully!"

# List the dependency status
echo "📋 Dependency status:"
helm dependency list

echo ""
echo "🚀 Ready to deploy! You can now run:"
echo "   helm install my-agents ./agents-service"
echo "   or"
echo "   helm upgrade my-agents ./agents-service"
echo ""
echo "💡 To deploy with custom values:"
echo "   helm install my-agents ./agents-service -f custom-values.yaml"
echo ""
echo "🔧 To disable streamlit deployment:"
echo "   helm install my-agents ./agents-service --set streamlit.enabled=false"
