terraform {
  required_providers {
    coder = {
      source  = "coder/coder"
      version = "~> 0.12"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
  }
}

provider "coder" {
  # Authenticates via environment variables or ~/.config/coder
}

provider "kubernetes" {
  # Authenticates via in-cluster config when running in Coder workspace
}

data "coder_workspace" "me" {}

# 1. Secure Secret Injection via Parameters
data "coder_parameter" "target_service_token" {
  name        = "target_service_token"
  display_name = "Target Service API Token"
  description = "The API token for the service to be remediated."
  type        = "string"
  mutable     = true
  default     = ""
  # sensitive attribute not supported; removed
}

data "coder_parameter" "incident_id" {
  name        = "incident_id"
  display_name = "Incident ID"
  default     = "INC-0000"
}

# 2. The Coder Agent
resource "coder_agent" "main" {
  arch           = "amd64"
  os             = "linux"
  startup_script = <<EOT
    #!/bin/bash
    set -e
    echo "Initializing Remediation Workspace for Incident: ${data.coder_parameter.incident_id.value}"
    
    # Inject the remediation script
    mkdir -p /home/coder/scripts
    cp /tmp/high_cpu_fix.sh /home/coder/scripts/remediate.sh
    chmod +x /home/coder/scripts/remediate.sh
    
    echo "Remediation script ready at /home/coder/scripts/remediate.sh"
  EOT
  
  # Environment variables for the agent
  env = {
    TARGET_SERVICE_TOKEN = data.coder_parameter.target_service_token.value
    INCIDENT_ID          = data.coder_parameter.incident_id.value
    CODER_AGENT_URL      = "http://coder.coder.svc.cluster.local"
  }
}

# 3. The Workspace Pod
resource "kubernetes_pod" "main" {
  count = data.coder_workspace.me.start_count
  metadata {
    name      = "coder-${lower(data.coder_workspace.me.owner_name)}-${lower(data.coder_workspace.me.name)}"
    namespace = var.namespace
    labels = {
      "app.kubernetes.io/name"     = "coder-workspace"
      "app.kubernetes.io/instance" = "coder-workspace-${data.coder_workspace.me.name}"
      "coder.owner"                = data.coder_workspace.me.owner_name
      "coder.workspace"            = data.coder_workspace.me.name
    }
  }
  
  spec {
    security_context {
      run_as_user = 1000
      fs_group    = 1000
    }
    
    container {
      name    = "dev"
      image   = "codercom/enterprise-base:ubuntu"
      command = ["sh", "-c", coder_agent.main.init_script]
      
      security_context {
        run_as_user = 1000
      }
      
      env {
        name  = "CODER_AGENT_TOKEN"
        value = coder_agent.main.token
      }
      
      volume_mount {
        name       = "remediation-scripts"
        mount_path = "/tmp/high_cpu_fix.sh"
        sub_path   = "high_cpu_fix.sh"
      }
    }
    
    volume {
      name = "remediation-scripts"
      config_map {
        name = kubernetes_config_map.remediation_scripts.metadata[0].name
        default_mode = "0755"
      }
    }
  }
}

# 4. ConfigMap for the Remediation Script
resource "kubernetes_config_map" "remediation_scripts" {
  metadata {
    name      = "remediation-script-${data.coder_workspace.me.name}"
    namespace = var.namespace
  }
  
  data = {
    "high_cpu_fix.sh" = file("${path.module}/scripts/high_cpu_fix.sh")
  }
}
