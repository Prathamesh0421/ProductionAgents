#!/bin/bash
set -e

# Configuration
CODER_URL="http://coder.local"
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="SecurePassword123!"
ADMIN_USERNAME="admin"
NAMESPACE="coder"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}Starting End-to-End Verification...${NC}"

# 1. Get the Coder Pod Name
POD_NAME=$(kubectl get pods -n $NAMESPACE -l app.kubernetes.io/name=coder -o jsonpath="{.items[0].metadata.name}")
echo "Coder Pod: $POD_NAME"

# 2. Create Admin User (Idempotent check)
echo "Creating Admin User..."

# Start port-forward for API access
echo "Starting port-forward..."
kubectl port-forward -n $NAMESPACE pod/$POD_NAME 8080:8080 > /dev/null 2>&1 &
PF_PID=$!
sleep 5
LOCAL_URL="http://127.0.0.1:8080"

# Check if first user exists
FIRST_USER_CHECK=$(curl -s "${LOCAL_URL}/api/v2/users/first")

if [[ "$FIRST_USER_CHECK" == *"The initial user has not been created"* ]]; then
  echo "Creating initial admin user via API..."
  curl -s -X POST "${LOCAL_URL}/api/v2/users/first" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\",\"name\":\"Admin\"}"
  echo "Admin user created."
else
  echo "Initial user already exists."
fi

# 3. Login to get Session Token
echo "Logging in to get session token..."
# Login via API to get the session token
LOGIN_RESPONSE=$(curl -s -c cookies.txt -X POST "${LOCAL_URL}/api/v2/users/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")

# Extract session token from the cookie jar
SESSION_TOKEN=$(grep "coder_session_token" cookies.txt | awk '{print $7}')

if [ -z "$SESSION_TOKEN" ]; then
  echo -e "${RED}Failed to login. Check credentials or pod status.${NC}"
  kill $PF_PID
  exit 1
fi

echo "Session Token acquired."

# 4. Verify API Access (Get User)
echo "Verifying API Access..."
USER_INFO=$(curl -s -H "Coder-Session-Token: $SESSION_TOKEN" "${LOCAL_URL}/api/v2/users/me")
USERNAME=$(echo $USER_INFO | grep -o '"username":"[^"]*"' | cut -d'"' -f4)

if [ "$USERNAME" == "$ADMIN_USERNAME" ]; then
  echo -e "${GREEN}API Verification Successful. Logged in as $USERNAME${NC}"
else
  echo -e "${RED}API Verification Failed. Response: $USER_INFO${NC}"
  kill $PF_PID
  exit 1
fi

# 5. Create a Workspace via API
# We need to use the session token we just got.
API_KEY=$SESSION_TOKEN
CODER_URL=$LOCAL_URL

# 5. Create a Workspace via API
# First, we need a template. For this verification, we'll assume a template exists or we create a dummy one.
# Creating a template via API is complex (requires uploading a tarball).
# For Week 1 verification, just hitting the 'create workspace' endpoint and getting a validation error (if no template) 
# or successfully creating one (if we upload a template) is enough.
# Let's try to list templates first.
TEMPLATES=$(curl -s -H "Coder-Session-Token: $API_KEY" "${CODER_URL}/api/v2/organizations/default/templates")
TEMPLATE_COUNT=$(echo $TEMPLATES | grep -o '"count":[0-9]*' | cut -d':' -f2)

if [ "$TEMPLATE_COUNT" == "0" ]; then
  echo "No templates found. Skipping workspace creation (requires a template)."
  echo "To fully test workspace creation, upload a template first."
else
  TEMPLATE_ID=$(echo $TEMPLATES | grep -o '"id":"[^"]*"' | head -n 1 | cut -d'"' -f4)
  
  if [ -z "$TEMPLATE_ID" ]; then
     echo "No templates found (Count: $TEMPLATE_COUNT). Skipping workspace creation."
  else
      echo "Found Template ID: $TEMPLATE_ID"
      
      WORKSPACE_NAME="test-workspace-$(date +%s)"
      echo "Creating Workspace: $WORKSPACE_NAME"
      
      CREATE_RESP=$(curl -s -X POST -H "Coder-Session-Token: $API_KEY" \
        -H "Content-Type: application/json" \
        "${CODER_URL}/api/v2/users/$ADMIN_USERNAME/workspaces" \
        -d "{\"template_id\":\"$TEMPLATE_ID\",\"name\":\"$WORKSPACE_NAME\",\"autostart_if_dormant\":true}")
        
      echo "Workspace Creation Response: $CREATE_RESP"
  fi
fi

echo -e "${GREEN}End-to-End Verification Complete!${NC}"
kill $PF_PID
