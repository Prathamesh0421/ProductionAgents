#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Coder Installation...${NC}"

# 1. Add Coder Helm repo
echo "Adding Coder Helm repo..."
helm repo add coder-v2 https://helm.coder.com/v2
helm repo update

# 2. Apply Namespace and Secrets
echo "Applying Namespace and Secrets..."
kubectl apply -f ../k8s/namespace.yaml

# 3. Install PostgreSQL (Ephemeral for Week 1)
echo "Installing PostgreSQL..."
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm upgrade --install postgresql bitnami/postgresql \
    --namespace coder \
    --set auth.username=coder \
    --set auth.password=coder \
    --set auth.database=coder \
    --set primary.persistence.enabled=false \
    --wait

# 4. Install/Upgrade Coder
echo "Installing Coder..."
helm upgrade --install coder coder-v2/coder \
    --namespace coder \
    --values ../k8s/values.yaml \
    --wait

# 5. Apply Ingress
echo "Applying Ingress..."
kubectl apply -f ../k8s/ingress.yaml

echo -e "${GREEN}Coder installed successfully!${NC}"
echo "Waiting for pods to be ready..."
kubectl get pods -n coder
