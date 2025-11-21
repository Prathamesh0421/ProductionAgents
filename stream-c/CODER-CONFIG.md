# Coder Configuration Values

## ✅ Issue Resolved: Terraform Upgraded

**Problem**: Terraform v1.5.7 was too old for Coder modules (required >= 1.9)  
**Solution**: Upgraded to Terraform v1.14.0 via HashiCorp tap  
**Status**: ✅ Template now initializes successfully

---

## Environment Variables for `.env`

Based on your Stream C implementation, here are the actual values to use:

### 1. CODER_API_URL

Since you're running Coder server locally, use:

```bash
CODER_API_URL=http://127.0.0.1:3000
```

**Note**: Your Coder server is running on the default port 3000 (process ID: 22677)

To verify the URL, run:
```bash
curl http://127.0.0.1:3000/api/v2/buildinfo
```

---

### 2. CODER_API_TOKEN (Session Token)

You need to generate a session token by logging in. Run this:

```bash
# Create first user (if not already created)
curl -X POST http://127.0.0.1:3000/api/v2/users/first \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "username": "admin",
    "password": "SecurePassword123!",
    "name": "Admin"
  }'

# Login to get session token
curl -c cookies.txt -X POST http://127.0.0.1:3000/api/v2/users/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SecurePassword123!"
  }'

# Extract the token
grep coder_session_token cookies.txt | awk '{print $7}'
```

Copy the output token and use it as:
```bash
CODER_API_TOKEN=<your-actual-token-here>
```

---

### 3. CODER_TEMPLATE_ID

You need to push your template first, then get its ID.

#### Option A: Use the Stream C template (recommended)

```bash
cd /Users/mohit/ProductionAgents/stream-c/week-2/terraform

# Initialize (already done with new Terraform version)
terraform init

# Push template to Coder
coder templates push remediation-template --directory . --yes

# Get the template ID
curl -s -H "Coder-Session-Token: <your-token>" \
  http://127.0.0.1:3000/api/v2/organizations/default/templates | \
  jq -r '.[] | select(.name=="remediation-template") | .id'
```

#### Option B: Use the src template

```bash
cd /Users/mohit/ProductionAgents/src/templates/coder/terraform

# Push template
coder templates push production-remediation --directory . --yes

# Get the template ID
curl -s -H "Coder-Session-Token: <your-token>" \
  http://127.0.0.1:3000/api/v2/organizations/default/templates | \
  jq -r '.[] | select(.name=="production-remediation") | .id'
```

The output will be a UUID like: `f729d45a-f1db-4975-ad21-c8cc61e8e2c1`

Use it as:
```bash
CODER_TEMPLATE_ID=<your-template-uuid>
```

---

## Complete .env Configuration

Add these lines to your `/Users/mohit/ProductionAgents/.env` file:

```bash
# Coder Configuration (Stream C dependency)
CODER_API_URL=http://127.0.0.1:3000
CODER_API_TOKEN=<get-from-login-command-above>
CODER_TEMPLATE_ID=<get-after-pushing-template>
```

---

## Quick Setup Script

Run this to set everything up:

```bash
#!/bin/bash
set -e

cd /Users/mohit/ProductionAgents

# 1. Login and get token
echo "Getting Coder session token..."
curl -c cookies.txt -X POST http://127.0.0.1:3000/api/v2/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"SecurePassword123!"}'

TOKEN=$(grep coder_session_token cookies.txt | awk '{print $7}')
echo "Token: $TOKEN"

# 2. Push template
echo "Pushing template..."
cd stream-c/week-2/terraform
coder templates push remediation-template --url http://127.0.0.1:3000 --token "$TOKEN" --yes

# 3. Get template ID
echo "Getting template ID..."
TEMPLATE_ID=$(curl -s -H "Coder-Session-Token: $TOKEN" \
  http://127.0.0.1:3000/api/v2/organizations/default/templates | \
  jq -r '.[] | select(.name=="remediation-template") | .id')

echo ""
echo "=== Add these to your .env file ==="
echo "CODER_API_URL=http://127.0.0.1:3000"
echo "CODER_API_TOKEN=$TOKEN"
echo "CODER_TEMPLATE_ID=$TEMPLATE_ID"
```

Save this as `stream-c/setup-coder-env.sh` and run it:
```bash
chmod +x stream-c/setup-coder-env.sh
./stream-c/setup-coder-env.sh
```

---

## Verification

After adding the values to `.env`, verify they work:

```bash
# Load environment
source .env

# Test API access
curl -H "Coder-Session-Token: $CODER_API_TOKEN" \
  "$CODER_API_URL/api/v2/users/me" | jq

# Test template access
curl -H "Coder-Session-Token: $CODER_API_TOKEN" \
  "$CODER_API_URL/api/v2/templates/$CODER_TEMPLATE_ID" | jq
```

Both should return valid JSON responses.

---

## Troubleshooting

### Coder server not responding
```bash
# Check if server is running
ps aux | grep "coder server"

# If not running, start it
cd /Users/mohit/ProductionAgents
coder server &
```

### Template push fails
```bash
# Make sure you're authenticated
coder login http://127.0.0.1:3000

# Try pushing again
cd stream-c/week-2/terraform
coder templates push remediation-template --yes
```

### Token expired
Session tokens expire after 24 hours. Re-run the login command to get a new one.

---

**Status**: Ready to configure! Run the setup script above to get your actual values.
