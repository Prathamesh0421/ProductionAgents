#!/bin/bash
set -e

# Week 2 – Full End‑to‑End Run
# ------------------------------------------------
# Prerequisites (already installed):
#   - Terraform (installed via brew)
#   - Coder CLI (installed via brew)
#   - Coder is reachable at localhost:8080 (port‑forwarded)
#   - Admin credentials are admin@example.com / SecurePassword123!

# 1. Port‑forward Coder (background)
PORT_FORWARD_PID=""
if ! pgrep -f "kubectl port-forward -n coder svc/coder 8080:80" >/dev/null; then
  echo "Starting port‑forward to Coder..."
  kubectl port-forward -n coder svc/coder 8080:80 > /dev/null 2>&1 &
  PORT_FORWARD_PID=$!
  sleep 5
fi

# 2. Login via API and export session token
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="SecurePassword123!"
LOGIN_RESPONSE=$(curl -s -c cookies.txt -X POST "http://127.0.0.1:8080/api/v2/users/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
SESSION_TOKEN=$(grep "coder_session_token" cookies.txt | awk '{print $7}')
if [ -z "$SESSION_TOKEN" ]; then
  echo "❌ Failed to obtain Coder session token"
  [ -n "$PORT_FORWARD_PID" ] && kill $PORT_FORWARD_PID
  exit 1
fi
CODER_URL="http://127.0.0.1:8080"
export CODER_SESSION_TOKEN="$SESSION_TOKEN"
echo "✅ Session token acquired"

# 3. Push the Terraform remediation template to Coder
cd "$(dirname "$0")/../terraform"
# Initialise Terraform (already done, but safe to run)
terraform init -input=false > /dev/null
# Create/Update Coder template (name: remediation-template)
if coder templates list --url "$CODER_URL" --token "$SESSION_TOKEN" | grep -q "remediation-template"; then
  echo "Updating existing template..."
  coder templates push remediation-template --url "$CODER_URL" --token "$SESSION_TOKEN" -y
else
  echo "Creating new template..."
  coder templates create remediation-template --url "$CODER_URL" --token "$SESSION_TOKEN" -y
fi
# Capture the UUID of the remediation template we just pushed/created
# Use the Coder API (JSON) – works even when CLI output lacks the UUID column
if ! command -v jq >/dev/null 2>&1; then
  echo "⚙️ Installing jq..."
  brew install jq
fi

TEMPLATE_UUID=$(curl -s -H "Coder-Session-Token: $SESSION_TOKEN" \
  http://127.0.0.1:8080/api/v2/organizations/default/templates | \
  jq -r '.[] | select(.name=="remediation-template") | .id')

if [ -z "$TEMPLATE_UUID" ] || [ "$TEMPLATE_UUID" = "null" ]; then
  echo "❌ Could not find remediation-template UUID via API"
  exit 1
fi
echo "Template UUID: $TEMPLATE_UUID"

# 4. Create a workspace using the template
WORKSPACE_NAME="remediation-test-$(date +%s)"
echo "Creating workspace $WORKSPACE_NAME"
# Use the API to create the workspace (simpler than CLI for parameters)
CREATE_RESP=$(curl -s -X POST -H "Coder-Session-Token: $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  "http://127.0.0.1:8080/api/v2/users/admin/workspaces" \
  -d "{\"template_id\":\"$TEMPLATE_UUID\",\"name\":\"$WORKSPACE_NAME\",\"autostart_if_dormant\":true}")
echo "Create response: $CREATE_RESP"

# 5. Wait for the workspace pod to become Ready
echo "Waiting for workspace pod..."
for i in {1..30}; do
  POD=$(kubectl get pods -n coder -l "coder.workspace=$WORKSPACE_NAME" -o jsonpath="{.items[0].metadata.name}" 2>/dev/null || true)
  if [ -n "$POD" ]; then
    STATUS=$(kubectl get pod -n coder $POD -o jsonpath="{.status.phase}")
    if [ "$STATUS" == "Running" ]; then
      echo "Workspace pod $POD is Running"
      break
    fi
  fi
  sleep 5
done

# 6. Verify remediation script is present inside the workspace
echo "Listing remediation script inside workspace..."
kubectl exec -n coder $POD -- ls -l /home/coder/scripts || true

# 7. Execute the remediation script (high‑cpu fix) inside the workspace
echo "Running remediation script..."
kubectl exec -n coder $POD -- /home/coder/scripts/remediate.sh || true

# 8. Verify NetworkPolicy is applied (list it)
echo "NetworkPolicy applied to workspace:"
kubectl get networkpolicy -n coder -l "coder.workspace=$WORKSPACE_NAME" -o yaml

# 9. Cleanup – kill port‑forward if we started it
if [ -n "$PORT_FORWARD_PID" ]; then
  kill $PORT_FORWARD_PID
fi

echo "✅ Week‑2 end‑to‑end run complete"
