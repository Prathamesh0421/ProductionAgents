# VIGIL

### Autonomous Self-Healing DevOps Engine

**Always Watching. Always Healing.**

[![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=for-the-badge\&logo=node.js\&logoColor=white)](https://nodejs.org/)
[![Anthropic](https://img.shields.io/badge/Anthropic-Claude-6B4FBB?style=for-the-badge\&logo=anthropic\&logoColor=white)](https://anthropic.com/)
[![Docker](https://img.shields.io/badge/Docker-Container-2496ED?style=for-the-badge\&logo=docker\&logoColor=white)](https://docker.com/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-Orchestration-326CE5?style=for-the-badge\&logo=kubernetes\&logoColor=white)](https://kubernetes.io/)

AI-powered incident detection, diagnosis, and remediation without waking you up at 3 AM.

[Demo](#demo) | [Architecture](#architecture) | [Sponsors](#powered-by-amazing-sponsors) | [Quick Start](#quick-start) | [Documentation](#documentation)

---

## The Problem

Every night, thousands of engineers are jolted awake by alerts. They spend hours debugging complex distributed systems, correlating logs, and applying fixes only to repeat the cycle the next night.

* **Alert fatigue** is burning out SRE teams
* **MTTR** keeps climbing
* **Microservice complexity** has outpaced human cognitive capacity
* **3 AM debugging** leads to mistakes and revenue loss

**What if your infrastructure could heal itself?**

---

## The Solution

**Vigil** is an autonomous reliability engine that transforms incident response from human in the loop to human on the loop.

It does not just alert you. It **investigates**, **reasons**, **executes**, and **verifies** fixes autonomously. It escalates to humans only when confidence is low.

### The OODA Loop

Vigil implements the military decision making framework adapted for infrastructure.

| Phase       | Action                        | Technology            |
| ----------- | ----------------------------- | --------------------- |
| **Observe** | Detect anomalies              | Datadog, PagerDuty    |
| **Orient**  | Investigate and contextualize | Cleric AI, Sanity CMS |
| **Decide**  | Reason and synthesize fix     | Anthropic Claude      |
| **Act**     | Execute and verify            | Coder, Lightpanda     |

---

## Powered by Amazing Sponsors

Vigil is built on an ecosystem of best in class technologies. Each sponsor plays a critical role in the autonomous healing pipeline.

### Anthropic Claude

> **The Brain**  •  Cognitive Reasoning Engine

Claude is the reasoning core of Vigil. When an incident occurs, Claude synthesizes the investigation data and runbook context to generate safe, effective remediation scripts.

**How we use it**

* Chain-of-thought style internal reasoning steps before generating any fix
* Risk assessment with LOW, MEDIUM, HIGH for each remediation
* Safety prompts with a cautious senior SRE persona and guardrails
* Code generation that produces executable remediation scripts

```javascript
// Prompt framing (high level)
Step 1: Analyze the Cleric investigation
Step 2: Review Sanity runbook context
Step 3: Evaluate potential risks
Step 4: Generate remediation code
Step 5: Define verification steps
```

**Built in safety rules**

* Never run destructive commands such as `DROP TABLE` or `rm -rf`
* Never hardcode credentials
* Never disable security features
* Prefer graceful shutdown when possible
* Request human approval for destructive actions

---

### Sanity CMS

> **The Memory**  •  Context Operating System

Sanity serves as Vigil's long term memory and ground truth. It prevents AI hallucination by grounding every decision in verified documentation.

**How we use it**

* Runbook storage with structured incident response procedures
* Semantic search with GROQ queries to find relevant context
* Past incidents stored with effectiveness ratings
* Schema validation to ensure knowledge quality and consistency

```javascript
// Sanity query for context retrieval
const query = `*[_type == "runbook" &&
  service == $service &&
  $failureType in failureTypes] {
    title,
    steps,
    verificationProcedure,
    riskLevel
  }`;
```

**Knowledge schema**

```yaml
title: "High Latency API Response"
service: api-gateway
failure_types: [cpu_saturation, memory_exhaustion, dependency_timeout]
severity: sev2
keywords: [latency, slow, timeout, p99]
```

---

### Coder

> **The Hands**  •  Sandboxed Execution Environment

Coder provides ephemeral, isolated workspaces where AI generated remediation scripts execute safely. Zero blast radius.

**How we use it**

* Ephemeral workspaces created per incident and destroyed after execution
* Kubernetes isolation with NetworkPolicy that restricts unnecessary access
* Rich parameters with incident context injected via Terraform variables
* Short lived credentials. No persistent access to production

```hcl
# Coder workspace with security context
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

**Security features**

* Non root container execution
* Network policies with deny all ingress by default
* Ephemeral credentials through workload identity
* Automatic workspace destruction after execution

---

### Lightpanda

> **The Eyes**  •  High Velocity Synthetic Verification

Lightpanda is a Zig based headless browser that is faster and uses less memory than Chrome. It verifies that fixes actually work.

**How we use it**

* Pre flight checks to confirm the incident before remediation
* Post fix verification to validate resolution
* Verification swarm with hundreds of concurrent browser sessions
* User journey simulation that tests real flows rather than only health endpoints

```javascript
// Lightpanda connection via CDP
const browser = await puppeteer.connect({
  browserWSEndpoint: "ws://lightpanda:9222"
});

// Verification swarm example
const results = await Promise.all(
  endpoints.map(url => healthCheck(browser, url))
);
```

**Verification library**

* Endpoint health checks
* API response validation
* Form submission tests
* Performance benchmarks
* User journey flows

---

### Skyflow

> **The Guardian**  •  Privacy and PII Protection

Production incidents often contain sensitive data. Skyflow ensures PII does not reach the LLM.

**How we use it**

* PII detection that scans logs and context before LLM processing
* Automatic redaction that removes emails, API keys, and session tokens
* Compliance features that maintain privacy during incident response

```javascript
// Skyflow PII redaction
const redactedContext = await skyflow.detect({
  text: incidentLogs,
  entities: ["EMAIL", "API_KEY", "SSN", "CREDIT_CARD"]
});

// Only redacted data reaches the LLM
const remediation = await claude.synthesize(redactedContext);
```

**Protected data types**

* Email addresses
* API keys and tokens
* Credit card numbers
* Personal identifiers

---

### PagerDuty

> **The Trigger**  •  Incident Management and Alerting

PagerDuty is the entry point for Vigil. It receives alerts from monitoring systems and triggers the autonomous healing pipeline.

**How we use it**

* Webhook integration for incident trigger and annotate events
* HMAC verification with cryptographic signature validation
* Cleric integration that posts AI investigation findings as incident notes
* Resolution updates. Automatic closure with audit trail

```javascript
// PagerDuty webhook handler
app.post('/webhooks/pagerduty', async (req, res) => {
  const isValid = verifySignature(req);
  if (!isValid) return res.status(401).end();

  const event = req.body?.event;
  if (event?.type === 'incident.triggered') {
    await orchestrator.startIncidentWorkflow(event.data.incident);
  }
  res.status(200).end();
});
```

---

### Slack

> **The Safety Net**  •  Human in the Loop Approval

When confidence is low or risk is high, Vigil does not auto execute. It asks for human approval in Slack.

**How we use it**

* Interactive messages with Approve and Reject buttons
* Context display showing hypothesis, runbook, and generated fix
* Audit trail where all approvals are logged for compliance
* Escalation path that ensures human oversight when the AI is uncertain

```javascript
// Slack approval request
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
VIGIL

[ Datadog Monitor ]    [ PagerDuty Alert ]    ORCHESTRATION CONTROL PLANE (Node.js + Express)
                                              [ Redis State ] [ Skyflow PII ] [ State Machine ]

    Cleric RCA      Sanity Context     Claude Reasoning     Coder Execute     Lightpanda Verify
         ORIENT          ORIENT              DECIDE               ACT                 VERIFY

                                 Slack Approval for high risk or low confidence
```

---

## Incident Lifecycle

The platform progresses through nine stages.

1. TRIGGERED  •  Alert received from monitoring  •  PagerDuty
2. INVESTIGATING  •  Root cause analysis in progress  •  Cleric AI
3. HYPOTHESIS_RECEIVED  •  Investigation complete  •  Cleric AI
4. CONTEXT_RETRIEVED  •  Runbooks and context loaded  •  Sanity CMS
5. SYNTHESIZING  •  Generating remediation script  •  Anthropic Claude
6. EXECUTING  •  Running fix in sandbox  •  Coder
7. VERIFYING  •  Confirming fix works  •  Lightpanda
8. RESOLVED  •  Incident closed and pattern learned
9. ESCALATED  •  Human intervention required  •  Slack

---

## Quick Start

### Prerequisites

* Node.js 20 or higher
* Docker and Docker Compose
* Kubernetes cluster. Minikube works for local development

### 1. Clone the repository

```bash
git clone https://github.com/your-org/vigil.git
cd vigil
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your API keys.

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

### 3. Start services

```bash
docker-compose up -d
```

### 4. Ingest runbooks

```bash
npm run ingest:runbooks ./runbooks
```

### 5. Verify setup

```bash
curl http://localhost:3000/health
```

---

## Project Structure

```
vigil/
  src/
    index.js                 # Express server entry
    config/                  # Environment configuration
    webhooks/                # PagerDuty and Slack handlers
    services/                # External service clients
      orchestrator.js        # Main OODA loop
      anthropic.js           # Claude integration
      sanity.js              # Sanity CMS client
      coder.js               # Coder workspace API
      lightpanda.js          # Browser verification
      skyflow.js             # PII redaction
      slack.js               # Approval workflow
    cognition/               # AI and knowledge pipeline
      prompts/               # Prompt templates
      ingestion/             # Runbook importers
      verification/          # Health check library
    parsers/                 # Cleric output parsing
    state/                   # Redis state machine
  runbooks/                  # Knowledge base
  stream-c/                  # Coder infrastructure
    k8s/                     # Kubernetes manifests
    terraform/               # Workspace templates
  docker/                    # Container definitions
  docker-compose.yml         # Full stack deployment
  package.json
```

---

## Security Features

| Feature               | Implementation                                |
| --------------------- | --------------------------------------------- |
| PII redaction         | Skyflow scans all data before LLM processing  |
| Webhook verification  | HMAC SHA256 signature validation              |
| Sandboxed execution   | Isolated Kubernetes pods with NetworkPolicy   |
| Ephemeral credentials | Short lived tokens. No persistent secrets     |
| Non root containers   | All images run as unprivileged users          |
| Human approval gate   | Low confidence actions require Slack approval |
| Audit logging         | Every decision logged for compliance          |

---

## Metrics

* 2172 lines of production service code
* Nine stage incident lifecycle
* Twelve integrated external services
* Five step internal reasoning flow
* Auto execution enabled above 90 percent confidence

---

## Roadmap

* Predictive healing. Fix before alerts fire
* Multi cloud Coder templates for AWS, GCP, Azure
* Feedback learning loop
* Autonomous chaos engineering
* Cross organization pattern sharing

---

## Team

Built with love for the hackathon.

---

## License

MIT License. See the LICENSE file for details.

---

**Vigil**  •  From reactive to proactive. From firefighting to oversight.

**Always watching. A
