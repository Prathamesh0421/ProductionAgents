#!/bin/bash
# Coder Setup Script for New Laptop
# Run this on any machine with access to the ProductionAgents repo

set -e

echo "=========================================="
echo "Coder Server Setup - New Machine"
echo "=========================================="
echo ""

# 1. Install Homebrew (if not installed)
if ! command -v brew &> /dev/null; then
    echo "📦 Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    echo "✅ Homebrew already installed"
fi

# 2. Install Coder CLI
if ! command -v coder &> /dev/null; then
    echo "📦 Installing Coder CLI..."
    brew install coder
else
    echo "✅ Coder CLI already installed ($(coder version --client-only))"
fi

# 3. Install Terraform (latest version from HashiCorp)
echo "📦 Installing/Upgrading Terraform..."
if brew list terraform &> /dev/null; then
    brew uninstall terraform
fi
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
echo "✅ Terraform installed: $(terraform version | head -1)"

# 4. Install jq (for JSON parsing)
if ! command -v jq &> /dev/null; then
    echo "📦 Installing jq..."
    brew install jq
else
    echo "✅ jq already installed"
fi

# 5. Clone the repo (if not already cloned)
REPO_DIR="$HOME/ProductionAgents"
if [ ! -d "$REPO_DIR" ]; then
    echo "📦 Cloning ProductionAgents repository..."
    cd "$HOME"
    git clone https://github.com/Prathamesh0421/ProductionAgents.git
    cd ProductionAgents
else
    echo "✅ Repository already exists at $REPO_DIR"
    cd "$REPO_DIR"
    echo "📦 Pulling latest changes..."
    git pull
fi

# 6. Create .env file from example
if [ ! -f "$REPO_DIR/.env" ]; then
    echo "📝 Creating .env file from .env.example..."
    cp .env.example .env
    echo "⚠️  Remember to update .env with your actual credentials!"
else
    echo "✅ .env file already exists"
fi

# 7. Start Coder server
echo ""
echo "=========================================="
echo "Starting Coder Server"
echo "=========================================="
echo ""
echo "The Coder server will start in the background."
echo "Access it at: http://localhost:3000"
echo ""
echo "To stop the server later, run:"
echo "  pkill -f 'coder server'"
echo ""

# Start Coder server in background
cd "$REPO_DIR"
nohup coder server > coder-server.log 2>&1 &
CODER_PID=$!

echo "✅ Coder server started (PID: $CODER_PID)"
echo "📝 Logs: $REPO_DIR/coder-server.log"

# Wait for server to be ready
echo ""
echo "⏳ Waiting for Coder server to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:3000/api/v2/buildinfo > /dev/null 2>&1; then
        echo "✅ Coder server is ready!"
        break
    fi
    sleep 2
    echo -n "."
done
echo ""

# 8. Create first user
echo ""
echo "=========================================="
echo "Creating Admin User"
echo "=========================================="
echo ""

# Check if first user exists
FIRST_USER_CHECK=$(curl -s http://localhost:3000/api/v2/users/first)

if [[ "$FIRST_USER_CHECK" == *"The initial user has not been created"* ]]; then
    echo "Creating admin user..."
    curl -s -X POST http://localhost:3000/api/v2/users/first \
        -H "Content-Type: application/json" \
        -d '{
            "email": "admin@example.com",
            "username": "admin",
            "password": "SecurePassword123!",
            "name": "Admin"
        }' > /dev/null
    echo "✅ Admin user created"
else
    echo "✅ Admin user already exists"
fi

# 9. Login and get session token
echo ""
echo "=========================================="
echo "Getting Session Token"
echo "=========================================="
echo ""

curl -s -c cookies.txt -X POST http://localhost:3000/api/v2/users/login \
    -H "Content-Type: application/json" \
    -d '{
        "email": "admin@example.com",
        "password": "SecurePassword123!"
    }' > /dev/null

TOKEN=$(grep coder_session_token cookies.txt | awk '{print $7}')

if [ -z "$TOKEN" ]; then
    echo "❌ Failed to get session token"
    exit 1
fi

echo "✅ Session token acquired"

# 10. Push remediation template
echo ""
echo "=========================================="
echo "Pushing Remediation Template"
echo "=========================================="
echo ""

cd "$REPO_DIR/stream-c/week-2/terraform"

# Clean old terraform state
rm -rf .terraform .terraform.lock.hcl

# Initialize
terraform init > /dev/null 2>&1

# Push template
coder templates push remediation-template \
    --url http://localhost:3000 \
    --token "$TOKEN" \
    --directory . \
    --yes > /dev/null 2>&1

echo "✅ Template pushed successfully"

# 11. Get template ID
TEMPLATE_ID=$(curl -s -H "Coder-Session-Token: $TOKEN" \
    http://localhost:3000/api/v2/organizations/default/templates | \
    jq -r '.[] | select(.name=="remediation-template") | .id')

echo "✅ Template ID: $TEMPLATE_ID"

# 12. Update .env file
echo ""
echo "=========================================="
echo "Updating .env Configuration"
echo "=========================================="
echo ""

cd "$REPO_DIR"

# Remove old Coder config if exists
sed -i.bak '/^CODER_API_URL=/d; /^CODER_API_TOKEN=/d; /^CODER_TEMPLATE_ID=/d' .env 2>/dev/null || true

# Append new config
cat >> .env << EOF

# Coder Configuration (Stream C dependency)
CODER_API_URL=http://localhost:3000
CODER_API_TOKEN=$TOKEN
CODER_TEMPLATE_ID=$TEMPLATE_ID
EOF

echo "✅ .env file updated"

# 13. Cleanup
rm -f cookies.txt

# 14. Final summary
echo ""
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "Coder Server Details:"
echo "  URL:      http://localhost:3000"
echo "  Username: admin@example.com"
echo "  Password: SecurePassword123!"
echo ""
echo "Template:"
echo "  Name: remediation-template"
echo "  ID:   $TEMPLATE_ID"
echo ""
echo "Environment:"
echo "  Config file: $REPO_DIR/.env"
echo "  Log file:    $REPO_DIR/coder-server.log"
echo ""
echo "Next Steps:"
echo "  1. Open http://localhost:3000 in your browser"
echo "  2. Login with the credentials above"
echo "  3. Update other credentials in .env file"
echo ""
echo "To stop Coder server:"
echo "  pkill -f 'coder server'"
echo ""
echo "To view logs:"
echo "  tail -f $REPO_DIR/coder-server.log"
echo ""
