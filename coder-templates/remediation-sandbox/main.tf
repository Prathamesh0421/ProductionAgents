terraform {
  required_providers {
    coder = {
      source  = "coder/coder"
      version = "~> 2.0"
    }
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}

provider "coder" {}

provider "docker" {}

data "coder_provisioner" "me" {}
data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

# Parameters for remediation context
data "coder_parameter" "incident_id" {
  name         = "incident_id"
  display_name = "Incident ID"
  description  = "The incident being remediated"
  type         = "string"
  default      = "INC-0000"
  mutable      = true
}

data "coder_parameter" "service_name" {
  name         = "service_name"
  display_name = "Target Service"
  description  = "Service to remediate"
  type         = "string"
  default      = ""
  mutable      = true
}

# Coder Agent
resource "coder_agent" "main" {
  arch = data.coder_provisioner.me.arch
  os   = "linux"

  startup_script = <<-EOT
    #!/bin/bash
    set -e

    echo "=== Remediation Sandbox Initialized ==="
    echo "Incident: $INCIDENT_ID"
    echo "Service: $SERVICE_NAME"
    echo "Workspace: ${data.coder_workspace.me.name}"

    # Create workspace directories
    mkdir -p /home/coder/remediation
    mkdir -p /home/coder/logs

    # Install common tools
    sudo apt-get update -qq
    sudo apt-get install -y -qq curl jq python3 python3-pip > /dev/null 2>&1
    pip3 install requests > /dev/null 2>&1

    echo "=== Sandbox Ready ==="
  EOT

  env = {
    INCIDENT_ID  = data.coder_parameter.incident_id.value
    SERVICE_NAME = data.coder_parameter.service_name.value
  }

  metadata {
    display_name = "CPU Usage"
    key          = "cpu"
    script       = "coder stat cpu"
    interval     = 10
    timeout      = 1
  }

  metadata {
    display_name = "Memory Usage"
    key          = "mem"
    script       = "coder stat mem"
    interval     = 10
    timeout      = 1
  }
}

# Docker Volume for persistence
resource "docker_volume" "home" {
  name = "coder-${data.coder_workspace.me.id}-home"
  lifecycle {
    ignore_changes = all
  }
  labels {
    label = "coder.owner"
    value = data.coder_workspace_owner.me.name
  }
  labels {
    label = "coder.workspace_id"
    value = data.coder_workspace.me.id
  }
}

# Docker Container
resource "docker_container" "workspace" {
  count = data.coder_workspace.me.start_count
  name  = "coder-${data.coder_workspace_owner.me.name}-${lower(data.coder_workspace.me.name)}"
  image = "codercom/enterprise-base:ubuntu"

  hostname = data.coder_workspace.me.name

  # Security - run as non-root
  user = "1000:1000"

  # Entry point runs the Coder agent
  entrypoint = ["sh", "-c", coder_agent.main.init_script]

  # Environment
  env = [
    "CODER_AGENT_TOKEN=${coder_agent.main.token}",
    "INCIDENT_ID=${data.coder_parameter.incident_id.value}",
    "SERVICE_NAME=${data.coder_parameter.service_name.value}",
  ]

  # Mount home volume
  volumes {
    volume_name    = docker_volume.home.name
    container_path = "/home/coder"
    read_only      = false
  }

  # Resource limits for safety
  memory = 2048
  cpu_shares = 1024

  # Network - connect to OCP network
  networks_advanced {
    name = "productionagents_ocp-network"
  }
}

# Outputs
output "workspace_url" {
  value = "http://localhost:7080/@${data.coder_workspace_owner.me.name}/${data.coder_workspace.me.name}"
}
