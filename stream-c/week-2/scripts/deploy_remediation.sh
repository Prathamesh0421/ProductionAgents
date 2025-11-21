#!/bin/bash
set -e

# Week 2 – Deploy Remediation Terraform Template
# ------------------------------------------------
# Prerequisites:
#   - Terraform installed (brew install terraform)
#   - Coder CLI installed (brew install coder)
#   - Coder is running and reachable (port-forwarded to localhost:8080)
#   - Admin credentials (admin@example.com / SecurePassword123!)
#   - Environment variable CODER_SESSION_TOKEN set (generated below)

# 1. Ensure Terraform is available
if ! command -v terraform >/dev/null 2>&1; then
  echo "Terraform not found – installing via Homebrew..."
  brew install terraform
fi

# 2. Ensure Coder CLI is available
if ! command -v coder >/dev/null 2>&1; then
  echo "Coder CLI not found – installing via Homebrew..."
  brew install coder
fi

# 3. Port‑forward Coder service (background)
echo "Starting port‑forward to Coder (localhost:8080)..."
kubectl port-forward -n coder svc/coder 8080:80 > /dev/null 2>&1 &
PF_PID=$!
sleep 5

# 4. Obtain a session token via the API (admin credentials)
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="SecurePassword123!"
LOGIN_RESPONSE=$(curl -s -c cookies.txt -X POST "http://127.0.0.1:8080/api/v2/users/login" \
  -H "Content-Type: application/json" \
  -d "{\"email":"$ADMIN_EMAIL","password":"$ADMIN_PASSWORD"}")
SESSION_TOKEN=$(grep "coder_session_token" cookies.txt | awk '{print $7}')
if [ -z "$SESSION_TOKEN" ]; then
  echo "Failed to obtain Coder session token – aborting."
  kill $PF_PID
  exit 1
fi
export CODER_SESSION_TOKEN="$SESSION_TOKEN"
echo "Session token acquired."

# 5. Change to the Terraform directory and initialise
cd "$(dirname "$0")/../terraform"
terraform init
terraform validate

# 6. Apply the Terraform configuration (auto‑approve for demo)
terraform apply -auto-approve

# 7. Clean up background port‑forward
kill $PF_PID

echo "Week‑2 remediation Terraform deployment complete."
