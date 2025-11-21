#!/bin/bash
set -e

# Configuration
CODER_URL=${CODER_API_URL:-"http://localhost:7080"}
ADMIN_EMAIL=${CODER_ADMIN_EMAIL:-"admin@localhost"}
ADMIN_USER=${CODER_ADMIN_USERNAME:-"admin"}
ADMIN_PASSWORD=${CODER_ADMIN_PASSWORD:-"changeme123"}

echo "Waiting for Coder to be ready at $CODER_URL..."
until curl -s --head "$CODER_URL/healthz" | grep "200 OK" > /dev/null; do
  sleep 2
done

echo "Coder is up!"

# Login or Create First User
echo "Attempting to login/create admin user..."
# Try to create first user (only works on fresh install)
coder login "$CODER_URL" \
  --first-user-email "$ADMIN_EMAIL" \
  --first-user-username "$ADMIN_USER" \
  --first-user-password "$ADMIN_PASSWORD" \
  --first-user-trial=true \
  --use-token-as-session=false \
  --no-open \
  --force-tty=false || true

# If login failed (already exists), we can't easily login non-interactively 
# WITHOUT an API key. But we are bootstrapping.
# If the user already exists, we assume the admin has set up CODER_API_TOKEN in .env
# OR we can try to login with password if the CLI supports it (it usually doesn't, expects token).

# However, for the INITIAL setup, the above command works.

# Generate API Token
echo "Generating API Token for OCP..."
TOKEN_OUTPUT=$(coder tokens create --name="ocp-agent-$(date +%s)" --lifetime=8760h)
API_TOKEN=$(echo "$TOKEN_OUTPUT" | grep -oP '(?<=Token: ).*')

echo "API Token Generated: $API_TOKEN"

# Create Template
echo "Creating 'remediation-sandbox' template..."
# Initialize from 'docker' starter
mkdir -p /tmp/docker-template
cd /tmp/docker-template
coder templates init --id docker --yes
coder templates push --name remediation-sandbox --yes --message "Initial commit"

echo "Template created!"

# Output for .env
echo "=================================================="
echo "SETUP COMPLETE! Update your .env file with:"
echo ""
echo "CODER_API_TOKEN=$API_TOKEN"
echo "CODER_TEMPLATE_ID=remediation-sandbox"
echo "=================================================="
