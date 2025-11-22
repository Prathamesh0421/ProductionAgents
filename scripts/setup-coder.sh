#!/bin/bash
set -e

# Configuration
CODER_URL=${CODER_API_URL:-"http://localhost:7080"}
# Force the email to the user's preference, ignoring the env var if it's invalid
ADMIN_EMAIL="pranavtrivedi@gmail.com"
ADMIN_USER=${CODER_ADMIN_USERNAME:-"admin"}
# Force secure password, ignoring env var
ADMIN_PASSWORD="ChangeMe!123456"

echo "Waiting for Coder to be ready at $CODER_URL..."
echo "DEBUG: Env var CODER_API_URL is '${CODER_API_URL}'"

while true; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$CODER_URL/healthz")
  if [ "$STATUS" = "200" ]; then
    echo "Coder is up! (Status: $STATUS)"
    break
  fi
  echo "Waiting for $CODER_URL/healthz... (Status: $STATUS)"
  sleep 2
done

# Login or Create First User
echo "Attempting to login/create admin user..."

# Wait a bit for first user to be auto-created by env vars
sleep 3

# Try to create first user with timeout (only works on fresh install)
echo "Trying to create first user via CLI (will timeout if user exists)..."
timeout 10s coder login "$CODER_URL" \
  --first-user-email "$ADMIN_EMAIL" \
  --first-user-username "$ADMIN_USER" \
  --first-user-password "$ADMIN_PASSWORD" \
  --first-user-trial=true \
  --use-token-as-session=false \
  --no-open \
  --force-tty=false > /dev/null 2>&1 && echo "First user created successfully via CLI." || echo "First user creation failed or timed out (user may already exist)."

# Now try to login via API to get session token
echo "Attempting login via API..."
LOGIN_RESPONSE=$(curl -s -X POST "$CODER_URL/api/v2/users/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\", \"password\":\"$ADMIN_PASSWORD\"}")

# Extract session token using sed (since jq might not be installed)
SESSION_TOKEN=$(echo "$LOGIN_RESPONSE" | sed 's/.*"session_token":"\([^"]*\)".*/\1/')

if [ -n "$SESSION_TOKEN" ] && [ "$SESSION_TOKEN" != "$LOGIN_RESPONSE" ]; then
  echo "Login successful via API."
  export CODER_SESSION_TOKEN="$SESSION_TOKEN"
else
  echo "Failed to login via API. Response: $LOGIN_RESPONSE"
  echo ""
  echo "=== MANUAL SETUP REQUIRED ==="
  echo "1. Open http://localhost:7080 in your browser"
  echo "2. Login with:"
  echo "   Email: $ADMIN_EMAIL"
  echo "   Username: $ADMIN_USER"
  echo "   Password: $ADMIN_PASSWORD"
  echo "3. Go to Account Settings → Tokens"
  echo "4. Create a new token and add to .env file:"
  echo "   CODER_API_TOKEN=<your-token>"
  echo "============================="
  exit 1
fi

# Generate API Token
echo "Generating API Token for OCP..."
# Request 7 days (168h) to comply with default max lifetime
TOKEN_OUTPUT=$(coder tokens create --name="ocp-agent-$(date +%s)" --lifetime=168h)
# Extract token (compatible with both BSD and GNU grep)
API_TOKEN=$(echo "$TOKEN_OUTPUT" | grep "Token:" | sed 's/.*Token: *//')

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
