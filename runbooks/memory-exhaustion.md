---
title: "Memory Exhaustion and OOM Issues"
service: user-service
failure_types: [memory_exhaustion, memory_leak]
severity: sev1
keywords: [oom, out of memory, memory leak, heap, gc]
---

# Memory Exhaustion and OOM Issues

## Overview
This runbook addresses memory-related issues including OOMKilled pods, memory leaks, and heap exhaustion.

## Symptoms
- Pods showing OOMKilled status
- Increasing memory usage over time (leak pattern)
- GC pause time increasing
- Application becoming unresponsive before crash

## Severity Assessment

| Pattern | Severity | Action |
|---------|----------|--------|
| Single pod OOM, auto-recovered | SEV3 | Monitor |
| Multiple pods OOM | SEV2 | Immediate action |
| Memory leak pattern | SEV2 | Investigate + patch |
| Cascading OOMs | SEV1 | Emergency response |

## Diagnostic Steps

### Step 1: Check Current Memory State
```bash
kubectl top pods -n production -l app=user-service --sort-by=memory
```

### Step 2: Check for OOMKilled Events
```bash
kubectl get events -n production --field-selector reason=OOMKilled --sort-by='.lastTimestamp'
```

### Step 3: Analyze Memory Trend
```bash
# Get memory usage over last hour from metrics
kubectl exec -n production deploy/user-service -- \
  curl -s localhost:8080/metrics | grep -E "^(jvm|process)_memory"
```

### Step 4: Check for Leak Pattern
Look for:
- Steady increase over time (leak)
- Sawtooth pattern with increasing baseline (fragmentation)
- Sudden spikes (burst allocation)

## Remediation Steps

### Immediate: Rolling Restart (clears memory)
```bash
kubectl rollout restart deploy/user-service -n production
```

> **Risk:** LOW - Kubernetes handles graceful rollout
> **Recovery time:** 2-3 minutes

### Short-term: Increase Memory Limits
```bash
kubectl set resources deploy/user-service -n production \
  --limits=memory=2Gi --requests=memory=1Gi
```

> **Risk:** LOW - May shift problem to later
> **Note:** Only if cluster has capacity

### Investigation: Capture Heap Dump
```bash
# Trigger heap dump before pod dies
kubectl exec -n production deploy/user-service -- \
  jcmd 1 GC.heap_dump /tmp/heap.hprof

# Copy out for analysis
kubectl cp production/user-service-xxx:/tmp/heap.hprof ./heap.hprof
```

### For Confirmed Leaks: Enable Leak Detection
```bash
kubectl set env deploy/user-service \
  JAVA_OPTS="-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp"
```

## Prevention

### Configure Proper Resource Limits
```yaml
resources:
  requests:
    memory: "1Gi"
  limits:
    memory: "2Gi"
```

### Enable GC Logging
```bash
kubectl set env deploy/user-service \
  JAVA_OPTS="-Xlog:gc*:file=/tmp/gc.log:time,uptime:filecount=5,filesize=10M"
```

## Rollback

- Rolling restart: N/A (pods will restart with current config)
- Memory limits: `kubectl set resources deploy/user-service -n production --limits=memory=1Gi --requests=memory=512Mi`

## Verification

1. Memory usage should stabilize after restart
2. No new OOMKilled events for 10+ minutes
3. Application health checks passing
4. Response times returned to normal

## Escalation Path

1. If leak confirmed → Create ticket for development team
2. If affecting multiple services → Page platform team
3. If cluster-wide issue → Check node memory, kubelet logs
