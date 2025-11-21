#!/bin/bash
set -e

cd /Users/mohit/ProductionAgents

echo "=== Coder Environment Setup ==="
echo ""

# 1. Check if Coder server is running
if ! curl -s http://127.0.0.1:3000/api/v2/buildinfo > /dev/null 2>&1; then
  echo "❌ Coder server is not responding at http://127.0.0.1:3000"
  echo "Please start it with: coder server"
  exit 1
fi
echo "✅ Coder server is running"

# 2. Login and get token
echo "Getting Coder session token..."
curl -s -c cookies.txt -X POST http://127.0.0.1:3000/api/v2/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"SecurePassword123!"}' > /dev/null

TOKEN=$(grep coder_session_token cookies.txt | awk '{print $7}')

if [ -z "$TOKEN" ]; then
  echo "❌ Failed to get session token. Check credentials."
  exit 1
fi
echo "✅ Session token acquired"

# 3. Push template
echo "Pushing remediation template..."
cd stream-c/week-2/terraform

# Clean old terraform state
rm -rf .terraform .terraform.lock.hcl

# Initialize with new Terraform version
terraform init > /dev/null 2>&1

# Push template using Coder CLI
if command -v coder > /dev/null 2>&1; then
  coder templates push remediation-template \
    --url http://127.0.0.1:3000 \
    --token "$TOKEN" \
    --directory . \
    --yes > /dev/null 2>&1
  echo "✅ Template pushed via CLI"
else
  echo "⚠️  Coder CLI not found, skipping template push"
  echo "   Install with: brew install coder"
fi

# 4. Get template ID
echo "Getting template ID..."
TEMPLATE_ID=$(curl -s -H "Coder-Session-Token: $TOKEN" \
  http://127.0.0.1:3000/api/v2/organizations/default/templates | \
  jq -r '.[] | select(.name=="remediation-template") | .id')

if [ -z "$TEMPLATE_ID" ] || [ "$TEMPLATE_ID" = "null" ]; then
  echo "⚠️  Template not found. You may need to push it manually."
  TEMPLATE_ID="<push-template-first>"
else
  echo "✅ Template ID: $TEMPLATE_ID"
fi

# 5. Output the values
echo ""
echo "================================================"
echo "Add these lines to your .env file:"
echo "================================================"
echo ""
echo "# Coder Configuration (Stream C dependency)"
echo "CODER_API_URL=http://127.0.0.1:3000"
echo "CODER_API_TOKEN=$TOKEN"
echo "CODER_TEMPLATE_ID=$TEMPLATE_ID"
echo ""
echo "================================================"
echo ""

# 6. Optionally append to .env
read -p "Append these to .env file? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  cd /Users/mohit/ProductionAgents
  
  # Remove old Coder config if exists
  sed -i.bak '/^CODER_API_URL=/d; /^CODER_API_TOKEN=/d; /^CODER_TEMPLATE_ID=/d' .env 2>/dev/null || true
  
  # Append new config
  echo "" >> .env
  echo "# Coder Configuration (Stream C dependency)" >> .env
  echo "CODER_API_URL=http://127.0.0.1:3000" >> .env
  echo "CODER_API_TOKEN=$TOKEN" >> .env
  echo "CODER_TEMPLATE_ID=$TEMPLATE_ID" >> .env
  
  echo "✅ Configuration added to .env"
else
  echo "Copy the values manually to your .env file"
fi

# Cleanup
rm -f cookies.txt

echo ""
echo "✅ Setup complete!"
