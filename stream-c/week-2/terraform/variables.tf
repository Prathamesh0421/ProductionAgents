variable "namespace" {
  description = "The Kubernetes namespace to deploy the workspace into."
  type        = string
  default     = "coder"
}

variable "create_network_policy" {
  description = "Whether to create the strict network policy."
  type        = bool
  default     = true
}
