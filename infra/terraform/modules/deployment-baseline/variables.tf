variable "environment" {
  description = "Explicit environment classification."
  type        = string
  validation {
    condition     = contains(["preview", "staging", "production"], var.environment)
    error_message = "environment must be preview, staging, or production."
  }
}

variable "deployment_mode" {
  description = "Commercial deployment boundary."
  type        = string
  validation {
    condition     = contains(["shared-hosted", "dedicated-hosted", "self-hosted"], var.deployment_mode)
    error_message = "deployment_mode must be shared-hosted, dedicated-hosted, or self-hosted."
  }
}

variable "region" {
  description = "Provider region/site identifier; not a secret."
  type        = string
  validation {
    condition     = length(trimspace(var.region)) > 0
    error_message = "region must be explicit."
  }
}

variable "public_cidrs" {
  description = "Ingress CIDRs allowed to reach the TLS edge."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "management_cidrs" {
  description = "Approved VPN/IAP administration CIDRs; broad Internet ranges are rejected."
  type        = list(string)
  default     = []
  validation {
    condition = alltrue([
      for cidr in var.management_cidrs : !contains(["0.0.0.0/0", "::/0"], cidr)
    ])
    error_message = "management_cidrs cannot expose management to the Internet."
  }
}

variable "control_database_separate" {
  description = "Control-plane data is separated from tenant operational data."
  type        = bool
  default     = true
  validation {
    condition     = var.control_database_separate
    error_message = "The control database must remain separate from tenant operational data."
  }
}

variable "tenant_database_strategy" {
  description = "Tenant database isolation strategy."
  type        = string
  default     = "database-per-tenant"
  validation {
    condition     = contains(["database-per-tenant", "shared-rls"], var.tenant_database_strategy)
    error_message = "Use database-per-tenant or a reviewed shared-rls design."
  }
}

variable "backup_repository_reference" {
  description = "Non-secret reference to the backup repository configuration."
  type        = string
  default     = "UNDECIDED"
}

variable "kms_key_reference" {
  description = "Non-secret KMS/vault reference; never key material."
  type        = string
  default     = "UNDECIDED"
}

variable "observability_endpoint_reference" {
  description = "Non-secret observability destination reference."
  type        = string
  default     = "UNDECIDED"
}

variable "approved_rpo_minutes" {
  description = "Owner-approved database RPO; zero means not yet accepted."
  type        = number
  default     = 0
  validation {
    condition     = var.approved_rpo_minutes >= 0
    error_message = "approved_rpo_minutes cannot be negative."
  }
}

variable "approved_rto_minutes" {
  description = "Owner-approved environment RTO; zero means not yet accepted."
  type        = number
  default     = 0
  validation {
    condition     = var.approved_rto_minutes >= 0
    error_message = "approved_rto_minutes cannot be negative."
  }
}

