output "workspace_url" {
  description = "The URL to access the workspace."
  value       = "https://coder.local/@${data.coder_workspace.me.owner_name}/${data.coder_workspace.me.name}"
}

output "remediation_script_path" {
  description = "Path to the injected remediation script."
  value       = "/home/coder/scripts/remediate.sh"
}
