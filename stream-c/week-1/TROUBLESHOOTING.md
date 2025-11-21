# Troubleshooting Coder Deployment

## Common Issues

### 1. Pods Pending
**Symptom:** `kubectl get pods -n coder` shows pods in `Pending` state.
**Cause:** Insufficient resources (CPU/Memory) or no PersistentVolume provisioner.
**Fix:**
- Check nodes: `kubectl describe nodes`
- If using Kind/Minikube, ensure storage class is default: `kubectl get sc`
- Check pod events: `kubectl describe pod <pod-name> -n coder`

### 2. Database Connection Failed
**Symptom:** Coder pod logs show `FATAL: password authentication failed` or connection timeout.
**Cause:** Incorrect secret or network policy blocking access.
**Fix:**
- Verify secret: `kubectl get secret coder-db-url -n coder -o yaml`
- Check Postgres pod status.
- Ensure `values.yaml` has correct `coder.env` for `CODER_PG_CONNECTION_URL`.

### 3. Ingress 404 or 502
**Symptom:** Accessing `coder.local` returns 404 or 502.
**Cause:** Ingress controller not running or misconfigured service.
**Fix:**
- Ensure Ingress controller is installed (e.g., `kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml` for Kind).
- Check Ingress status: `kubectl get ingress -n coder`
- Verify Service port matches Ingress backend.

### 4. "Workspace creation failed"
**Symptom:** API returns error when creating workspace.
**Cause:** No templates, or template requires parameters not provided.
**Fix:**
- List templates: `coder templates list`
- Check template logs if build failed.

## Logs
To get logs for the Coder service:
```bash
kubectl logs -n coder -l app.kubernetes.io/name=coder
```
