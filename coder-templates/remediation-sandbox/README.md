# Remediation Sandbox Template

Docker-based Coder template for running automated remediation scripts.

## Features
- Isolated Docker container per incident
- Pre-installed: Python3, curl, jq
- Resource limits for safety (2GB RAM, 1 CPU)
- Connected to OCP network

## Parameters
- `incident_id`: The incident being remediated
- `service_name`: Target service name

## Usage
```bash
# Push template to Coder
cd coder-templates/remediation-sandbox
coder templates push remediation-sandbox --url http://localhost:7080
```
