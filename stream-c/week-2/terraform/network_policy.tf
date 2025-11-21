resource "kubernetes_network_policy" "workspace_isolation" {
  count = var.create_network_policy ? 1 : 0
  
  metadata {
    name      = "workspace-isolation-${data.coder_workspace.me.name}"
    namespace = var.namespace
  }

  spec {
    pod_selector {
      match_labels = {
        "coder.workspace" = data.coder_workspace.me.name
      }
    }

    policy_types = ["Ingress", "Egress"]

    # 1. Deny all Ingress (Workspace is ephemeral and driven by Agent)
    ingress {}

    # 2. Restricted Egress
    egress {
      # Allow DNS
      ports {
        protocol = "UDP"
        port     = 53
      }
      ports {
        protocol = "TCP"
        port     = 53
      }
    }

    egress {
      # Allow connection to Coder Control Plane
      # Assuming Coder is in the same namespace or we know its IP/Label
      to {
        namespace_selector {
          match_labels = {
            name = var.namespace
          }
        }
        pod_selector {
          match_labels = {
            "app.kubernetes.io/name" = "coder"
          }
        }
      }
    }

    egress {
      # Allow connection to the Target Service (Remediation Target)
      # This would be dynamic in a real scenario, here we hardcode a "payment-api" label
      to {
        pod_selector {
          match_labels = {
            app = "payment-api"
          }
        }
      }
    }
  }
}
