---
title: "High Latency API Response"
service: api-gateway
failure_types: [dependency_timeout, cpu_saturation, memory_exhaustion]
severity: sev2
keywords: [latency, slow, timeout, response time, p99]
---

# High Latency API Response

## Overview
This runbook addresses situations where API response times exceed acceptable thresholds (p99 > 500ms or p50 > 200ms).

## Symptoms
- Elevated p99/p50 latency in dashboards
- Timeout errors from downstream services
- User complaints about slow page loads
- Increased error rates correlating with latency

## Quick Diagnosis

### Identify the Bottleneck
```bash
# Check if it's the service itself or a dependency
kubectl exec -n production deploy/api-gateway -- \
  curl -w "@/tmp/curl-format.txt" -o /dev/null -s localhost:8080/health
```

### Check Resource Utilization
```bash
kubectl top pods -n production -l app=api-gateway
```

### Check Dependency Health
```bash
kubectl exec -n production deploy/api-gateway -- \
  curl -s localhost:8080/health/dependencies | jq .
```

## Root Cause Decision Tree

1. **CPU > 80%?** → See [CPU Saturation](#cpu-saturation)
2. **Memory > 85%?** → See [Memory Pressure](#memory-pressure)
3. **Dependency timeout?** → See [Dependency Issues](#dependency-issues)
4. **None of above?** → Check recent deployments, then escalate

## Remediation by Cause

### CPU Saturation

**Option A: Horizontal Scaling (Preferred)**
```bash
kubectl scale deploy/api-gateway -n production --replicas=5
```

**Option B: Identify Hot Endpoint**
```bash
kubectl logs -n production deploy/api-gateway --since=5m | \
  grep -E "took [0-9]+ms" | sort -t'=' -k2 -rn | head -20
```

### Memory Pressure

**Option A: Trigger GC (if applicable)**
```bash
kubectl exec -n production deploy/api-gateway -- \
  curl -X POST localhost:8080/admin/gc
```

**Option B: Rolling Restart**
```bash
kubectl rollout restart deploy/api-gateway -n production
```

> **Warning:** Rolling restart will cause brief capacity reduction

### Dependency Issues

**Option A: Enable Circuit Breaker**
```bash
kubectl set env deploy/api-gateway CIRCUIT_BREAKER_ENABLED=true
```

**Option B: Increase Timeout (temporary)**
```bash
kubectl set env deploy/api-gateway DOWNSTREAM_TIMEOUT_MS=5000
```

> **Warning:** Only increase timeout if downstream is recovering

## Rollback

- Scaling: `kubectl scale deploy/api-gateway -n production --replicas=3`
- Circuit breaker: `kubectl set env deploy/api-gateway CIRCUIT_BREAKER_ENABLED=false`
- Timeout: `kubectl set env deploy/api-gateway DOWNSTREAM_TIMEOUT_MS=3000`

## Verification

1. Monitor p99 latency - should decrease within 2-3 minutes
2. Check error rate returning to baseline
3. Verify all health checks passing

## Escalation

If latency persists after 15 minutes:
1. Page the platform team
2. Consider enabling maintenance mode
3. Check for infrastructure-level issues (cloud provider status)
