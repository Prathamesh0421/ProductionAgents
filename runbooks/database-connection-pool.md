---
title: "Database Connection Pool Exhaustion"
service: payment-api
failure_types: [database_connection_pool, slow_query]
severity: sev2
keywords: [connection, pool, exhausted, postgres, max connections]
---

# Database Connection Pool Exhaustion

## Overview
This runbook addresses connection pool exhaustion issues, typically manifesting as "too many connections" or "connection pool exhausted" errors.

## Symptoms
- Error messages: "pool exhausted", "max connections reached"
- Increased latency on database-dependent endpoints
- 503/504 errors from the service
- Connection wait time spikes in metrics

## Prerequisites
- kubectl access to the cluster
- Database admin credentials (via vault)
- Access to Grafana dashboards

## Diagnostic Steps

### Step 1: Verify Pool Metrics
```bash
kubectl exec -n production deploy/payment-api -- \
  curl -s localhost:8080/metrics | grep db_pool
```

Expected: `db_pool_active` should be at or near `db_pool_max`

### Step 2: Check for Long-Running Queries
```sql
SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '30 seconds'
AND state != 'idle'
ORDER BY duration DESC;
```

### Step 3: Check Application Connection Leaks
```bash
kubectl logs -n production deploy/payment-api --since=10m | grep -i "connection"
```

## Remediation Steps

### Option A: Recycle Idle Connections (Low Risk)
```bash
kubectl exec -n production deploy/payment-api -- \
  curl -X POST localhost:8080/admin/connections/recycle \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

> **Warning:** This may cause brief latency spikes (< 1 second)

### Option B: Kill Long-Running Queries (Medium Risk)
```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE duration > interval '5 minutes'
AND state != 'idle';
```

> **Warning:** Ensure query is not a critical batch job before terminating

### Option C: Scale Connection Pool (Low Risk)
Only if current max is below recommended:
```bash
kubectl set env deploy/payment-api DB_POOL_MAX=50
```

## Rollback
- Connection recycling: Automatic recovery
- Query termination: Queries will need to be retried by application
- Pool scaling: `kubectl set env deploy/payment-api DB_POOL_MAX=25`

## Verification
1. Check pool metrics return to normal
2. Verify error rate decreases within 2 minutes
3. Monitor `/health` endpoint returns 200

## Related
- [Slow Query Runbook](./slow-query.md)
- [Database Failover Procedures](./database-failover.md)
