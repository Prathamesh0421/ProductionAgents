<div align="center">

# VIGIL

### Autonomous Self-Healing DevOps Engine

**Always Watching. Always Healing.**

[![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Anthropic](https://img.shields.io/badge/Anthropic-Claude-6B4FBB?style=for-the-badge&logo=anthropic&logoColor=white)](https://anthropic.com/)
[![Docker](https://img.shields.io/badge/Docker-Container-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-Orchestration-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white)](https://kubernetes.io/)

*AI-powered incident detection, diagnosis, and remediationwithout waking you up at 3 AM.*

[Demo](#demo) | [Architecture](#architecture) | [Sponsors](#-powered-by-amazing-sponsors) | [Setup](#-quick-start) | [Documentation](#-documentation)

</div>

---

## The Problem

Every night, thousands of engineers are jolted awake by alerts. They spend hours debugging complex distributed systems, correlating logs, and applying fixesonly to repeat the cycle the next night.

- **Alert fatigue** is burning out SRE teams
- **MTTR (Mean Time to Resolution)** keeps climbing
- **Microservice complexity** has outpaced human cognitive capacity
- **3 AM debugging** leads to mistakes and revenue loss

**What if your infrastructure could heal itself?**

---

## The Solution

**Vigil** is an autonomous reliability engine that transforms incident response from "Human-in-the-Loop" to "Human-on-the-Loop."

It doesn't just alert youit **investigates**, **reasons**, **executes**, and **verifies** fixes autonomously, escalating to humans only when confidence is low.

### The OODA Loop

Vigil implements the military decision-making framework adapted for infrastructure:

| Phase | Action | Technology |
|-------|--------|------------|
| **Observe** | Detect anomalies | Datadog, PagerDuty |
| **Orient** | Investigate & contextualize | Cleric AI, Sanity CMS |
| **Decide** | Reason & synthesize fix | Anthropic Claude |
| **Act** | Execute & verify | Coder, Lightpanda |

---

## Powered by Amazing Sponsors

Vigil is built on an ecosystem of best-in-class technologies. Each sponsor plays a critical role in the autonomous healing pipeline.

---

### Anthropic Claude

> **The Brain**  Cognitive Reasoning Engine

Claude is the reasoning core of Vigil. When an incident occurs, Claude synthesizes the investigation data and runbook context to generate safe, effective remediation scripts.

**How we use it:**
- **Chain-of-Thought Reasoning**: 5-step analytical process before generating any fix
- **Risk Assessment**: Evaluates LOW/MEDIUM/HIGH risk for each remediation
- **Safety Prompts**: "Cautious Senior SRE" persona with built-in guardrails
- **Code Generation**: Produces executable remediation scripts

```javascript
// Chain-of-Thought Prompt Structure
Step 1: Analyze the Cleric investigation
Step 2: Review Sanity runbook context
Step 3: Evaluate potential risks
Step 4: Generate remediation code
Step 5: Define verification steps
```

**Built-in Safety Rules:**
- Never `DROP TABLE` or `rm -rf`
- Never hardcode credentials
- Never disable security features
- Always prefer graceful shutdown
- Always request approval for destructive actions

---

### Sanity CMS

> **The Memory**  Context Operating System

Sanity serves as Vigil's long-term memory and ground truth. It prevents AI hallucination by grounding every decision in verified documentation.

**How we use it:**
- **Runbook Storage**: Structured incident response procedures
- **Semantic Search**: GROQ queries to find relevant context
- **Past Incidents**: Historical resolutions with effectiveness ratings
- **Schema Validation**: Ensures knowledge quality and consistency

```javascript
// Sanity Query for Context Retrieval
const query = `*[_type == "runbook" &&
  service == $service &&
  $failureType in failureTypes] {
    title,
    steps,
    verificationProcedure,
    riskLevel
  }`;
```

**Knowledge Schema:**
```yaml
---
title: "High Latency API Response"
service: api-gateway
failure_types: [cpu_saturation, memory_exhaustion, dependency_timeout]
severity: sev2
keywords: [latency, slow, timeout, p99]
---
```

---

### Coder

> **The Hands**  Sandboxed Execution Environment

Coder provides ephemeral, isolated workspaces where AI-generated remediation scripts execute safely. Zero blast radius.

**How we use it:**
- **Ephemeral Workspaces**: Spun up per-incident, destroyed after execution
- **Kubernetes Isolation**: NetworkPolicy restricts all unnecessary access
- **Rich Parameters**: Incident context injected via Terraform variables
- **Short-lived Credentials**: No persistent access to production

```hcl
# Coder Workspace with Security Context
resource "kubernetes_pod" "remediation" {
  spec {
    security_context {
      run_as_non_root = true
      run_as_user     = 1000
    }
    container {
      env {
        name  = "INCIDENT_ID"
        value = data.coder_parameter.incident_id.value
      }
    }
  }
}
```

**Security Features:**
- Non-root container execution
- Network policies (deny-all ingress)
- Ephemeral credentials via workload identity
- Automatic workspace destruction post-execution

---

### Lightpanda

> **The Eyes**  High-Velocity Synthetic Verification

Lightpanda is a Zig-based headless browser that's 10x faster and uses 10x less memory than Chrome. It verifies that fixes actually work.

**How we use it:**
- **Pre-flight Checks**: Confirm the incident before remediation
- **Post-fix Verification**: Validate the fix resolved the issue
- **Verification Swarm**: Hundreds of concurrent browser sessions
- **User Journey Simulation**: Test real user flows, not just health endpoints

```javascript
// Lightpanda Connection via CDP
const browser = await puppeteer.connect({
  browserWSEndpoint: "ws://lightpanda:9222"
});

// Verification Swarm - 100 concurrent checks
const results = await Promise.all(
  endpoints.map(url => healthCheck(browser, url))
);
```

**Verification Library:**
- Endpoint health checks
- API response validation
- Form submission tests
- Performance benchmarks
- User journey flows

---

### Skyflow

> **The Guardian**  Privacy & PII Protection

Production incidents often contain sensitive data. Skyflow ensures PII never reaches the LLM.

**How we use it:**
- **PII Detection**: Scans logs and context before LLM processing
- **Automatic Redaction**: Removes emails, API keys, session tokens
- **Compliance**: Maintains privacy even during incident response

```javascript
// Skyflow PII Redaction
const redactedContext = await skyflow.detect({
  text: incidentLogs,
  entities: ['EMAIL', 'API_KEY', 'SSN', 'CREDIT_CARD']
});

// Only redacted data reaches Claude
const remediation = await claude.synthesize(redactedContext);
```

**Protected Data Types:**
- Email addresses
- API keys & tokens
- Credit card numbers
- Personal identifiers

---

### PagerDuty

> **The Trigger**  Incident Management & Alerting

PagerDuty is the entry point for Vigil. It receives alerts from monitoring systems and triggers the autonomous healing pipeline.

**How we use it:**
- **Webhook Integration**: `incident.trigger` and `incident.annotate` events
- **HMAC Verification**: Cryptographic signature validation
- **Cleric Integration**: AI investigation posts findings as incident notes
- **Resolution Updates**: Automatic incident closure with audit trail

```javascript
// PagerDuty Webhook Handler
app.post('/webhooks/pagerduty', async (req, res) => {
  // Verify HMAC signature (timing-safe)
  const isValid = verifySignature(req);

  if (event.type === 'incident.triggered') {
    await orchestrator.startIncidentWorkflow(incident);
  }
});
```

---

### Slack

> **The Safety Net**  Human-in-the-Loop Approval

When confidence is low or risk is high, Vigil doesn't auto-execute. It asks for human approval via Slack.

**How we use it:**
- **Interactive Messages**: Approve/Reject buttons for remediation
- **Context Display**: Shows hypothesis, runbook, and generated fix
- **Audit Trail**: All approvals logged for compliance
- **Escalation Path**: Human oversight when AI is uncertain

```javascript
// Slack Approval Request
await slack.postMessage({
  channel: APPROVAL_CHANNEL,
  blocks: [
    { type: "header", text: "Remediation Approval Required" },
    { type: "section", text: `*Incident:* ${incident.title}` },
    { type: "section", text: `*Confidence:* ${confidence}%` },
    { type: "actions", elements: [
      { type: "button", text: "Approve", action_id: "approve" },
      { type: "button", text: "Reject", action_id: "reject" }
    ]}
  ]
});
```

---

## Architecture

```
                                                                                         
                                         VIGIL                                           
                                                                                         $
                                                                                         
                                                                                  
    Datadog     �PagerDuty    �         ORCHESTRATION CONTROL PLANE               
    Monitor        Alert                     (Node.js + Express)                  
                                                                            
                                       Redis    Skyflow    State Machine        
                                       State      PII        (9 stages)         
                                                                                
                                                          ,                           
                                                                                       
                                                          <                           
                                                                                     
                                                  4                        
       Cleric    �  Sanity    �  Claude    �  Coder     �Lightpanda        
        RCA        Context      Reasoning    Execute       Verify          
                                   ,                                       
                                                                                    
         ORIENT          ORIENT                     ACT            VERIFY           
                                        �                                            
                                                                                   
                                    Slack                                          
                                   Approval                                        
                                                                                   
                                     DECIDE                                          
                                                                                     
                                                                                        
                                                                                        
```

---

## Incident Lifecycle (9 Stages)

```
TRIGGERED � INVESTIGATING � HYPOTHESIS_RECEIVED � CONTEXT_RETRIEVED � SYNTHESIZING
                                                                           �
                                              RESOLVED � VERIFYING � EXECUTING
                                                  �
                                              ESCALATED (if needed)
```

| Stage | Description | Technology |
|-------|-------------|------------|
| `TRIGGERED` | Alert received from monitoring | PagerDuty |
| `INVESTIGATING` | Root cause analysis in progress | Cleric AI |
| `HYPOTHESIS_RECEIVED` | Investigation complete | Cleric AI |
| `CONTEXT_RETRIEVED` | Runbooks and context loaded | Sanity CMS |
| `SYNTHESIZING` | Generating remediation script | Anthropic Claude |
| `EXECUTING` | Running fix in sandbox | Coder |
| `VERIFYING` | Confirming fix works | Lightpanda |
| `RESOLVED` | Incident closed, pattern learned | - |
| `ESCALATED` | Human intervention required | Slack |

---

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Kubernetes cluster (Minikube for local dev)

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/vigil.git
cd vigil
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your API keys:

```env
# AI Providers
ANTHROPIC_API_KEY=sk-ant-...
LLM_PROVIDER=anthropic

# Sanity CMS
SANITY_PROJECT_ID=your-project-id
SANITY_DATASET=production
SANITY_TOKEN=sk...

# Coder
CODER_API_URL=http://localhost:7080
CODER_API_TOKEN=...

# Lightpanda
LIGHTPANDA_WS_ENDPOINT=ws://localhost:9222

# Skyflow
SKYFLOW_VAULT_ID=...
SKYFLOW_BEARER_TOKEN=...

# PagerDuty
PAGERDUTY_API_KEY=...
PAGERDUTY_WEBHOOK_SECRET=...

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_APPROVAL_CHANNEL=C0123456789

# Confidence Thresholds
CONFIDENCE_AUTO_EXECUTE_THRESHOLD=90
CONTEXT_MATCH_THRESHOLD=85
```

### 3. Start Services

```bash
docker-compose up -d
```

### 4. Ingest Runbooks

```bash
npm run ingest:runbooks ./runbooks
```

### 5. Verify Setup

```bash
curl http://localhost:3000/health
```

---

## Project Structure

```
vigil/
   src/
      index.js                 # Express server entry
      config/                  # Environment configuration
      webhooks/                # PagerDuty, Slack handlers
      services/                # External service clients
         orchestrator.js      # Main OODA loop (481 lines)
         anthropic.js         # Claude integration
         sanity.js            # Sanity CMS client
         coder.js             # Coder workspace API
         lightpanda.js        # Browser verification
         skyflow.js           # PII redaction
         slack.js             # Approval workflow
      cognition/               # AI & Knowledge pipeline
         prompts/             # Chain-of-Thought templates
         ingestion/           # Runbook importers
         verification/        # Health check library
      parsers/                 # Cleric output parsing
      state/                   # Redis state machine
   runbooks/                    # Knowledge base
   stream-c/                    # Coder infrastructure
      k8s/                     # Kubernetes manifests
      terraform/               # Workspace templates
   docker/                      # Container definitions
   docker-compose.yml           # Full stack deployment
   package.json
```

---

## Security Features

| Feature | Implementation |
|---------|----------------|
| **PII Redaction** | Skyflow scans all data before LLM processing |
| **Webhook Verification** | HMAC-SHA256 signature validation |
| **Sandboxed Execution** | Isolated Kubernetes pods with NetworkPolicy |
| **Ephemeral Credentials** | Short-lived tokens, no persistent secrets |
| **Non-root Containers** | All images run as unprivileged users |
| **Human Approval Gate** | Low-confidence actions require Slack approval |
| **Audit Logging** | Every decision logged for compliance |

---

## Metrics

- **2,172+ lines** of production service code
- **9-stage** incident lifecycle
- **12 integrated** external services
- **5-step** Chain-of-Thought reasoning
- **90%+ confidence** threshold for auto-execution

---

## Roadmap

- [ ] Predictive healing (fix before alerts fire)
- [ ] Multi-cloud Coder templates (AWS, GCP, Azure)
- [ ] Feedback learning loop
- [ ] Autonomous chaos engineering
- [ ] Cross-organization pattern sharing

---

## Team

Built with love for the hackathon.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">

**Vigil**  *From reactive to proactive. From firefighting to oversight.*

**Always watching. Always healing.**

</div>
