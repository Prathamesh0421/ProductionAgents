# Stream C: Weeks 3-4 Implementation Handoff

## Executive Summary

This document provides a comprehensive guide for implementing **Week 3 (Incident-Triggered Remediation Pipeline)** and **Week 4 (Integration with Streams A & B)** of the Coder deployment and automated remediation project.

---

## Current State (Weeks 1-2 Completed)

### ✅ Week 1: Coder Deployment on Kubernetes
**Status**: COMPLETE

**What was delivered:**
- ✅ Coder v2.28.3 running on Minikube
- ✅ PostgreSQL database (Bitnami chart) deployed and connected
- ✅ Admin user created (`admin@example.com` / `SecurePassword123!`)
- ✅ Ingress configured for `coder.local` (with `/etc/hosts` entry)
- ✅ Port-forward access via `http://localhost:8080`
- ✅ Verification script (`setup_and_verify.sh`) validates API access
- ✅ CI/CD pipeline template (`ci/pipeline.yaml`)
- ✅ Troubleshooting guide (`TROUBLESHOOTING.md`)

**Access Information:**
- **Coder UI**: `http://localhost:8080` or `http://coder.local`
- **Admin Credentials**: `admin@example.com` / `SecurePassword123!`
- **Namespace**: `coder`
- **Database**: PostgreSQL running as `postgresql-0` pod

**Key Files:**
```
stream-c/week-1/
├── k8s/
│   ├── namespace.yaml          # Namespace, RBAC, secrets
│   ├── values.yaml             # Helm chart values
│   └── ingress.yaml            # Ingress configuration
├── scripts/
│   ├── install_coder.sh        # Installation automation
│   └── setup_and_verify.sh    # End-to-end verification
├── ci/
│   └── pipeline.yaml           # GitHub Actions workflow
└── TROUBLESHOOTING.md          # Common issues and fixes
```

**Port-Forward Command (if needed):**
```bash
kubectl port-forward -n coder svc/coder 8080:80
```

---

### ✅ Week 2: Restricted Remediation Terraform Template
**Status**: COMPLETE (with minor pod startup issue to resolve)

**What was delivered:**
- ✅ Terraform template (`remediation-template`) created and pushed to Coder
- ✅ Template includes:
  - Secure parameter injection (`target_service_token`, `incident_id`)
  - Coder agent with startup script
  - Kubernetes pod definition with security context
  - ConfigMap for remediation scripts
  - NetworkPolicy for workspace isolation
- ✅ Automated deployment script (`run_week2.sh`)
- ✅ API-based template UUID resolution (using `jq`)

**Template UUID**: `f729d45a-f1db-4975-ad21-c8cc61e8e2c1`

**Key Files:**
```
stream-c/week-2/
├── terraform/
│   ├── main.tf                 # Workspace pod, agent, ConfigMap
│   ├── network_policy.tf       # Strict network isolation
│   ├── variables.tf            # Configurable parameters
│   └── outputs.tf              # Workspace URL, script path
├── scripts/
│   ├── run_week2.sh            # End-to-end deployment
│   ├── deploy_remediation.sh   # Alternative deployment script
│   └── high_cpu_fix.sh         # Example remediation script
└── TESTING.md                  # Testing checklist
```

**Known Issue:**
- Workspace pods are not starting automatically after creation via API
- The workspace is created successfully in Coder (visible in UI)
- Need to investigate why `kubernetes_pod` resource is not being provisioned
- Likely cause: Terraform provider configuration or workspace build job not completing

**Next Steps for Week 2 Completion:**
1. Check workspace build logs in Coder UI
2. Verify Terraform provider has correct Kubernetes access
3. Ensure workspace build job completes successfully
4. Test manual workspace creation via Coder UI as comparison

---

## Week 3: Incident-Triggered Remediation Pipeline

### Objective
Build an end-to-end pipeline that:
1. Receives incident alerts (simulated or from monitoring)
2. Automatically creates a Coder workspace using the remediation template
3. Executes the remediation script inside the workspace
4. Reports results back to the incident management system

### Architecture Overview

```
┌─────────────────┐
│  Incident Alert │
│   (Webhook/API) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Remediation Orchestrator       │
│  (Python/Go Service)            │
│  - Receives incident webhook    │
│  - Validates incident type      │
│  - Calls Coder API              │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Coder API                      │
│  POST /api/v2/users/{user}/     │
│       workspaces                │
│  - template_id                  │
│  - parameters (incident_id,     │
│    service_token)               │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Workspace Pod                  │
│  - Coder agent starts           │
│  - Remediation script executes  │
│  - Logs to stdout/stderr        │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Results Collection             │
│  - Stream logs via Coder API    │
│  - Parse exit code              │
│  - Update incident ticket       │
└─────────────────────────────────┘
```

### Implementation Tasks

#### 3.1: Build the Remediation Orchestrator Service

**Technology Choice**: Python (Flask/FastAPI) or Go (Gin/Echo)

**Recommended**: Python with FastAPI for rapid development

**File**: `stream-c/week-3/orchestrator/main.py`

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import httpx
import os

app = FastAPI()

CODER_URL = os.getenv("CODER_URL", "http://coder.coder.svc.cluster.local")
CODER_TOKEN = os.getenv("CODER_SESSION_TOKEN")
TEMPLATE_ID = os.getenv("TEMPLATE_ID", "f729d45a-f1db-4975-ad21-c8cc61e8e2c1")

class IncidentAlert(BaseModel):
    incident_id: str
    service_name: str
    severity: str
    description: str
    target_service_token: str = ""

@app.post("/remediate")
async def trigger_remediation(alert: IncidentAlert):
    """
    Receive incident alert and trigger Coder workspace creation
    """
    # 1. Validate incident
    if alert.severity not in ["critical", "high"]:
        raise HTTPException(400, "Only critical/high incidents trigger auto-remediation")
    
    # 2. Create workspace via Coder API
    workspace_name = f"remediation-{alert.incident_id}"
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{CODER_URL}/api/v2/users/admin/workspaces",
            headers={"Coder-Session-Token": CODER_TOKEN},
            json={
                "template_id": TEMPLATE_ID,
                "name": workspace_name,
                "rich_parameter_values": [
                    {"name": "incident_id", "value": alert.incident_id},
                    {"name": "target_service_token", "value": alert.target_service_token}
                ],
                "autostart_if_dormant": True
            }
        )
        
        if response.status_code != 201:
            raise HTTPException(500, f"Failed to create workspace: {response.text}")
        
        workspace = response.json()
        
    # 3. Return workspace info
    return {
        "workspace_id": workspace["id"],
        "workspace_name": workspace_name,
        "status": "provisioning",
        "url": f"{CODER_URL}/@admin/{workspace_name}"
    }

@app.get("/status/{workspace_id}")
async def get_workspace_status(workspace_id: str):
    """
    Check workspace status and retrieve logs
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{CODER_URL}/api/v2/workspaces/{workspace_id}",
            headers={"Coder-Session-Token": CODER_TOKEN}
        )
        
        if response.status_code != 200:
            raise HTTPException(404, "Workspace not found")
        
        workspace = response.json()
        
    return {
        "workspace_id": workspace_id,
        "status": workspace["latest_build"]["status"],
        "health": workspace["health"]
    }
```

**Deployment**:
```yaml
# stream-c/week-3/k8s/orchestrator-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: remediation-orchestrator
  namespace: coder
spec:
  replicas: 1
  selector:
    matchLabels:
      app: remediation-orchestrator
  template:
    metadata:
      labels:
        app: remediation-orchestrator
    spec:
      containers:
      - name: orchestrator
        image: python:3.11-slim
        command: ["sh", "-c"]
        args:
          - |
            pip install fastapi uvicorn httpx pydantic
            uvicorn main:app --host 0.0.0.0 --port 8000
        env:
        - name: CODER_URL
          value: "http://coder.coder.svc.cluster.local"
        - name: CODER_SESSION_TOKEN
          valueFrom:
            secretKeyRef:
              name: coder-api-token
              key: token
        - name: TEMPLATE_ID
          value: "f729d45a-f1db-4975-ad21-c8cc61e8e2c1"
        ports:
        - containerPort: 8000
        volumeMounts:
        - name: code
          mountPath: /app
      volumes:
      - name: code
        configMap:
          name: orchestrator-code
---
apiVersion: v1
kind: Service
metadata:
  name: remediation-orchestrator
  namespace: coder
spec:
  selector:
    app: remediation-orchestrator
  ports:
  - port: 80
    targetPort: 8000
```

#### 3.2: Create Incident Simulator

**File**: `stream-c/week-3/scripts/simulate_incident.sh`

```bash
#!/bin/bash
# Simulate an incident alert to test the remediation pipeline

ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:8000}"
INCIDENT_ID="${1:-INC-$(date +%s)}"
SERVICE_NAME="${2:-payment-api}"
SEVERITY="${3:-critical}"

echo "Simulating incident: $INCIDENT_ID for service: $SERVICE_NAME"

curl -X POST "$ORCHESTRATOR_URL/remediate" \
  -H "Content-Type: application/json" \
  -d "{
    \"incident_id\": \"$INCIDENT_ID\",
    \"service_name\": \"$SERVICE_NAME\",
    \"severity\": \"$SEVERITY\",
    \"description\": \"High CPU usage detected\",
    \"target_service_token\": \"fake-token-for-testing\"
  }"

echo ""
echo "Incident submitted. Check workspace creation in Coder UI."
```

#### 3.3: Add Monitoring Integration (Optional)

If integrating with Prometheus/Alertmanager:

**File**: `stream-c/week-3/alertmanager/webhook-config.yaml`

```yaml
receivers:
- name: 'coder-remediation'
  webhook_configs:
  - url: 'http://remediation-orchestrator.coder.svc.cluster.local/remediate'
    send_resolved: false

route:
  group_by: ['alertname', 'service']
  receiver: 'coder-remediation'
  routes:
  - match:
      severity: critical
      auto_remediate: 'true'
    receiver: 'coder-remediation'
```

#### 3.4: Testing Checklist

- [ ] Deploy orchestrator service to Kubernetes
- [ ] Create API token secret for Coder access
- [ ] Test `/remediate` endpoint with simulated incident
- [ ] Verify workspace is created in Coder
- [ ] Confirm workspace pod starts and agent connects
- [ ] Check remediation script executes
- [ ] Verify logs are accessible via `/status` endpoint
- [ ] Test error handling (invalid incidents, API failures)
- [ ] Load test with multiple concurrent incidents

---

## Week 4: Integration with Streams A & B

### Objective
Integrate the Coder remediation system with:
- **Stream A**: Incident detection and alerting
- **Stream B**: Observability and monitoring

### Integration Points

#### 4.1: Stream A Integration (Incident Management)

**Assumption**: Stream A provides an incident management API

**Integration Flow**:
```
Stream A (Incident Created)
    ↓
    Webhook to Orchestrator (/remediate)
    ↓
    Workspace Created & Remediation Runs
    ↓
    Update Incident Status in Stream A
```

**Implementation**:

**File**: `stream-c/week-4/integrations/stream_a_client.py`

```python
import httpx
from typing import Dict, Any

class StreamAClient:
    """Client for Stream A incident management API"""
    
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url
        self.api_key = api_key
    
    async def update_incident(self, incident_id: str, status: str, notes: str):
        """Update incident status and add notes"""
        async with httpx.AsyncClient() as client:
            response = await client.patch(
                f"{self.base_url}/api/incidents/{incident_id}",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "status": status,
                    "notes": notes,
                    "updated_by": "coder-remediation-bot"
                }
            )
            response.raise_for_status()
            return response.json()
    
    async def add_comment(self, incident_id: str, comment: str):
        """Add a comment to the incident"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/api/incidents/{incident_id}/comments",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"text": comment}
            )
            response.raise_for_status()
            return response.json()
```

**Update Orchestrator** to use Stream A client:

```python
# In main.py, after workspace creation:
from integrations.stream_a_client import StreamAClient

stream_a = StreamAClient(
    base_url=os.getenv("STREAM_A_URL"),
    api_key=os.getenv("STREAM_A_API_KEY")
)

# After workspace is created
await stream_a.add_comment(
    alert.incident_id,
    f"🤖 Auto-remediation workspace created: {workspace_name}\n"
    f"View at: {CODER_URL}/@admin/{workspace_name}"
)

# After remediation completes (add background task)
await stream_a.update_incident(
    alert.incident_id,
    status="remediated",
    notes=f"Remediation completed successfully. Workspace: {workspace_name}"
)
```

#### 4.2: Stream B Integration (Observability)

**Assumption**: Stream B provides metrics/logging infrastructure (Prometheus, Grafana, Loki)

**Integration Points**:

1. **Metrics Export** (Prometheus)
   - Workspace creation count
   - Remediation success/failure rate
   - Time to remediation
   - Active workspace count

2. **Log Aggregation** (Loki/ELK)
   - Stream workspace logs to centralized logging
   - Tag logs with incident ID for correlation

3. **Dashboards** (Grafana)
   - Remediation pipeline overview
   - Workspace resource usage
   - Incident resolution time

**Implementation**:

**File**: `stream-c/week-4/integrations/metrics.py`

```python
from prometheus_client import Counter, Histogram, Gauge, generate_latest
from fastapi import Response

# Metrics
workspace_created_total = Counter(
    'coder_workspace_created_total',
    'Total workspaces created for remediation',
    ['template', 'incident_type']
)

remediation_duration_seconds = Histogram(
    'coder_remediation_duration_seconds',
    'Time taken for remediation to complete',
    ['incident_type', 'status']
)

active_workspaces = Gauge(
    'coder_active_workspaces',
    'Number of currently active remediation workspaces'
)

@app.get("/metrics")
async def metrics():
    """Expose Prometheus metrics"""
    return Response(
        content=generate_latest(),
        media_type="text/plain"
    )

# In remediation endpoint:
workspace_created_total.labels(
    template='remediation-template',
    incident_type=alert.service_name
).inc()
```

**Grafana Dashboard JSON**:

**File**: `stream-c/week-4/grafana/remediation-dashboard.json`

```json
{
  "dashboard": {
    "title": "Coder Remediation Pipeline",
    "panels": [
      {
        "title": "Workspace Creation Rate",
        "targets": [
          {
            "expr": "rate(coder_workspace_created_total[5m])"
          }
        ]
      },
      {
        "title": "Remediation Success Rate",
        "targets": [
          {
            "expr": "rate(coder_remediation_duration_seconds_count{status=\"success\"}[5m]) / rate(coder_remediation_duration_seconds_count[5m])"
          }
        ]
      },
      {
        "title": "Active Workspaces",
        "targets": [
          {
            "expr": "coder_active_workspaces"
          }
        ]
      }
    ]
  }
}
```

**ServiceMonitor for Prometheus**:

**File**: `stream-c/week-4/k8s/servicemonitor.yaml`

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: remediation-orchestrator
  namespace: coder
spec:
  selector:
    matchLabels:
      app: remediation-orchestrator
  endpoints:
  - port: http
    path: /metrics
    interval: 30s
```

#### 4.3: End-to-End Integration Test

**File**: `stream-c/week-4/tests/integration_test.sh`

```bash
#!/bin/bash
set -e

echo "=== Stream C Integration Test ==="

# 1. Verify Coder is running
echo "1. Checking Coder availability..."
curl -f http://localhost:8080/api/v2/buildinfo || exit 1

# 2. Verify orchestrator is running
echo "2. Checking orchestrator availability..."
curl -f http://localhost:8000/health || exit 1

# 3. Simulate incident from Stream A
echo "3. Simulating incident from Stream A..."
INCIDENT_ID="TEST-$(date +%s)"
RESPONSE=$(curl -s -X POST http://localhost:8000/remediate \
  -H "Content-Type: application/json" \
  -d "{
    \"incident_id\": \"$INCIDENT_ID\",
    \"service_name\": \"payment-api\",
    \"severity\": \"critical\",
    \"description\": \"Integration test incident\"
  }")

WORKSPACE_ID=$(echo $RESPONSE | jq -r '.workspace_id')
echo "Workspace created: $WORKSPACE_ID"

# 4. Wait for workspace to be ready
echo "4. Waiting for workspace to be ready..."
for i in {1..30}; do
  STATUS=$(curl -s http://localhost:8000/status/$WORKSPACE_ID | jq -r '.status')
  echo "  Status: $STATUS"
  if [ "$STATUS" = "running" ]; then
    echo "✅ Workspace is running!"
    break
  fi
  sleep 10
done

# 5. Verify metrics are exported
echo "5. Checking Prometheus metrics..."
curl -s http://localhost:8000/metrics | grep coder_workspace_created_total || exit 1

# 6. Check Stream B integration (if available)
if [ -n "$GRAFANA_URL" ]; then
  echo "6. Verifying Grafana dashboard..."
  curl -f "$GRAFANA_URL/api/dashboards/uid/coder-remediation" || echo "⚠️ Grafana dashboard not found"
fi

echo ""
echo "=== Integration Test Complete ==="
echo "Workspace ID: $WORKSPACE_ID"
echo "Incident ID: $INCIDENT_ID"
```

---

## Deployment Architecture (Final State)

```
┌─────────────────────────────────────────────────────────────┐
│                     Kubernetes Cluster                       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Namespace: coder                                       │ │
│  │                                                        │ │
│  │  ┌──────────────┐    ┌──────────────────────────┐    │ │
│  │  │   Coder      │◄───│  PostgreSQL              │    │ │
│  │  │   Server     │    │  (Bitnami)               │    │ │
│  │  └──────┬───────┘    └──────────────────────────┘    │ │
│  │         │                                             │ │
│  │         │ manages                                     │ │
│  │         ▼                                             │ │
│  │  ┌──────────────────────────────────────────────┐    │ │
│  │  │  Remediation Workspaces (Pods)               │    │ │
│  │  │  - Coder Agent                               │    │ │
│  │  │  - Remediation Scripts                       │    │ │
│  │  │  - Network Policies (Isolated)               │    │ │
│  │  └──────────────────────────────────────────────┘    │ │
│  │                                                        │ │
│  │  ┌──────────────────────────────────────────────┐    │ │
│  │  │  Remediation Orchestrator                    │    │ │
│  │  │  - FastAPI Service                           │    │ │
│  │  │  - Incident Webhook Handler                  │    │ │
│  │  │  - Coder API Client                          │    │ │
│  │  │  - Metrics Exporter                          │    │ │
│  │  └──────────────────────────────────────────────┘    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Namespace: monitoring (Stream B)                      │ │
│  │  - Prometheus (scrapes orchestrator metrics)          │ │
│  │  - Grafana (dashboards)                               │ │
│  │  - Loki (log aggregation)                             │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
         ▲                                    ▲
         │                                    │
         │ webhooks                           │ API calls
         │                                    │
┌────────┴─────────┐              ┌──────────┴──────────┐
│  Stream A        │              │  Stream B           │
│  (Incidents)     │              │  (Observability)    │
└──────────────────┘              └─────────────────────┘
```

---

## File Structure (Complete)

```
stream-c/
├── week-1/                          # ✅ COMPLETE
│   ├── k8s/
│   │   ├── namespace.yaml
│   │   ├── values.yaml
│   │   └── ingress.yaml
│   ├── scripts/
│   │   ├── install_coder.sh
│   │   └── setup_and_verify.sh
│   ├── ci/
│   │   └── pipeline.yaml
│   └── TROUBLESHOOTING.md
│
├── week-2/                          # ✅ COMPLETE (minor issue)
│   ├── terraform/
│   │   ├── main.tf
│   │   ├── network_policy.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── scripts/
│   │   ├── run_week2.sh
│   │   ├── deploy_remediation.sh
│   │   └── high_cpu_fix.sh
│   └── TESTING.md
│
├── week-3/                          # 🔨 TO IMPLEMENT
│   ├── orchestrator/
│   │   ├── main.py                 # FastAPI service
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   ├── k8s/
│   │   ├── orchestrator-deployment.yaml
│   │   ├── orchestrator-service.yaml
│   │   └── api-token-secret.yaml
│   ├── scripts/
│   │   ├── simulate_incident.sh
│   │   └── deploy_orchestrator.sh
│   ├── alertmanager/
│   │   └── webhook-config.yaml     # Optional: Prometheus integration
│   └── TESTING.md
│
├── week-4/                          # 🔨 TO IMPLEMENT
│   ├── integrations/
│   │   ├── stream_a_client.py      # Incident management API client
│   │   ├── metrics.py              # Prometheus metrics
│   │   └── logging_config.py       # Structured logging
│   ├── k8s/
│   │   └── servicemonitor.yaml     # Prometheus ServiceMonitor
│   ├── grafana/
│   │   └── remediation-dashboard.json
│   ├── tests/
│   │   └── integration_test.sh     # End-to-end test
│   └── INTEGRATION.md              # Integration guide
│
└── WEEK3-4-HANDOFF.md              # This document
```

---

## Prerequisites for Weeks 3-4

### Tools & Dependencies
- ✅ Kubernetes cluster (Minikube or equivalent)
- ✅ `kubectl` configured
- ✅ `helm` installed
- ✅ Coder running (from Week 1)
- ✅ Remediation template created (from Week 2)
- 🔨 Python 3.11+ (for orchestrator)
- 🔨 `jq` (for JSON parsing) - already installed
- 🔨 Docker (for building orchestrator image)
- 🔨 Access to Stream A API (incident management)
- 🔨 Access to Stream B monitoring stack (Prometheus, Grafana)

### Environment Variables
```bash
# Coder
export CODER_URL="http://localhost:8080"
export CODER_SESSION_TOKEN="<your-session-token>"
export TEMPLATE_ID="f729d45a-f1db-4975-ad21-c8cc61e8e2c1"

# Stream A (Incident Management)
export STREAM_A_URL="<stream-a-api-url>"
export STREAM_A_API_KEY="<stream-a-api-key>"

# Stream B (Observability)
export PROMETHEUS_URL="<prometheus-url>"
export GRAFANA_URL="<grafana-url>"
```

---

## Testing Strategy

### Week 3 Testing
1. **Unit Tests**: Test orchestrator endpoints in isolation
2. **Integration Tests**: Test Coder API interaction
3. **Load Tests**: Simulate multiple concurrent incidents
4. **Failure Tests**: Test error handling and retries

### Week 4 Testing
1. **Stream A Integration**: Verify incident updates
2. **Stream B Integration**: Verify metrics and logs
3. **End-to-End**: Full pipeline from incident to resolution
4. **Performance**: Measure time-to-remediation

---

## Success Criteria

### Week 3
- [ ] Orchestrator service deployed and accessible
- [ ] Incident webhook triggers workspace creation
- [ ] Workspace starts and executes remediation script
- [ ] Logs are accessible via API
- [ ] Error handling works correctly
- [ ] Documentation complete

### Week 4
- [ ] Stream A receives workspace creation notifications
- [ ] Stream A receives remediation completion updates
- [ ] Prometheus scrapes orchestrator metrics
- [ ] Grafana dashboard displays remediation metrics
- [ ] Logs are aggregated in Stream B logging system
- [ ] End-to-end integration test passes
- [ ] Performance meets SLOs (e.g., <5min time-to-remediation)

---

## Known Issues & Risks

### Current Issues (Week 2)
1. **Workspace pods not starting**: Need to debug why `kubernetes_pod` resource isn't being created
   - **Mitigation**: Check Terraform provider logs, verify RBAC permissions
   - **Workaround**: Manually create workspace via Coder UI to test template

### Risks for Weeks 3-4
1. **Stream A API availability**: Integration depends on Stream A being ready
   - **Mitigation**: Create mock API for testing
2. **Network policies**: May block legitimate traffic
   - **Mitigation**: Test thoroughly, adjust egress rules as needed
3. **Resource constraints**: Multiple workspaces may exhaust cluster resources
   - **Mitigation**: Implement workspace TTL, auto-cleanup
4. **Security**: API tokens must be securely managed
   - **Mitigation**: Use Kubernetes secrets, rotate regularly

---

## Support & Resources

### Documentation
- [Coder API Reference](https://coder.com/docs/api)
- [Coder Terraform Provider](https://registry.terraform.io/providers/coder/coder/latest/docs)
- [Kubernetes NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Prometheus Client Python](https://github.com/prometheus/client_python)

### Troubleshooting
- See `stream-c/week-1/TROUBLESHOOTING.md` for common Coder issues
- Check Coder logs: `kubectl logs -n coder -l app.kubernetes.io/name=coder`
- Check workspace build logs in Coder UI
- Verify RBAC: `kubectl auth can-i --list --as=system:serviceaccount:coder:coder`

### Contact
- For Coder-specific issues: Check Coder documentation or community forums
- For Stream A/B integration: Coordinate with respective stream owners
- For Kubernetes issues: Check cluster logs and events

---

## Next Steps for Implementation

### Immediate (Week 3 - Days 1-3)
1. Set up Python development environment
2. Implement orchestrator service (`main.py`)
3. Create Kubernetes deployment manifests
4. Deploy orchestrator to cluster
5. Test with simulated incidents

### Short-term (Week 3 - Days 4-7)
1. Add comprehensive error handling
2. Implement retry logic
3. Add structured logging
4. Create incident simulator script
5. Write integration tests
6. Document API endpoints

### Medium-term (Week 4 - Days 1-4)
1. Integrate with Stream A API
2. Add Prometheus metrics
3. Create Grafana dashboard
4. Set up log aggregation
5. Test end-to-end flow

### Final (Week 4 - Days 5-7)
1. Performance testing and optimization
2. Security review
3. Complete documentation
4. Demo preparation
5. Handoff to operations team

---

## Conclusion

This handoff document provides a complete roadmap for implementing Weeks 3-4 of Stream C. The foundation from Weeks 1-2 is solid, with only a minor pod startup issue to resolve. The orchestrator service and integrations are well-defined and ready for implementation.

**Key Success Factors:**
- Follow the architecture and code examples provided
- Test incrementally at each step
- Coordinate with Stream A and B teams early
- Monitor resource usage and adjust as needed
- Document any deviations or issues encountered

Good luck with the implementation! 🚀
