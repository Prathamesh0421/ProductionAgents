# Week 2 Testing & Validation

## Terraform Apply Test Scenario

To validate the Terraform template, we use the Coder CLI to push the template and create a workspace.

### Prerequisites
- Coder installed and running (Week 1).
- `coder` CLI authenticated.

### Steps

1. **Navigate to the Template Directory**
   ```bash
   cd stream-c/week-2/terraform
   ```

2. **Initialize and Validate Terraform**
   Run these commands to ensure syntax correctness before pushing.
   ```bash
   terraform init
   terraform validate
   ```

3. **Create/Update the Template in Coder**
   ```bash
   coder templates create remediation-template .
   # If it already exists:
   # coder templates push remediation-template .
   ```

4. **Create a Workspace (Simulation)**
   This simulates the OCP creating a workspace for an incident.
   ```bash
   coder create --template="remediation-template" \
     --parameter="incident_id=INC-1234" \
     --parameter="target_service_token=s3cr3t-t0k3n" \
     remediation-test-01
   ```

5. **Verify Workspace State**
   Wait for the workspace to be `Running`.
   ```bash
   coder list
   ```

## Validation Checklist

- [ ] **Template Validity**: `terraform validate` passes without errors.
- [ ] **Workspace Provisioning**: `coder create` successfully provisions a pod in the `coder` namespace.
- [ ] **Secret Injection**:
    - SSH into the workspace: `coder ssh remediation-test-01`
    - Run: `echo $TARGET_SERVICE_TOKEN`
    - Verify it matches the input (it might be masked in logs, but available in env).
- [ ] **Remediation Script**:
    - Verify script exists: `ls -l /home/coder/scripts/remediate.sh`
    - Run it: `/home/coder/scripts/remediate.sh`
    - Verify output matches the "High CPU Fix" logic.
- [ ] **Network Isolation**:
    - Try to ping google.com: `ping -c 1 google.com` (Should FAIL or timeout if DNS allowed but external IP blocked, or succeed if policy allows. Our policy allows DNS but blocks external IPs unless they match the selectors. Since we didn't whitelist google.com IPs, it should fail to connect).
    - Try to curl the internal target service (if it existed).
- [ ] **Teardown**:
    - `coder delete remediation-test-01` works and removes the pod.
