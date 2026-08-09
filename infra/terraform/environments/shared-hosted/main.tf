terraform {
  required_version = ">= 1.8.0, < 2.0.0"
}

module "baseline" {
  source                            = "../../modules/deployment-baseline"
  environment                       = var.environment
  deployment_mode                   = "shared-hosted"
  region                            = var.region
  management_cidrs                  = var.management_cidrs
  backup_repository_reference       = var.backup_repository_reference
  kms_key_reference                 = var.kms_key_reference
  observability_endpoint_reference = var.observability_endpoint_reference
  approved_rpo_minutes              = var.approved_rpo_minutes
  approved_rto_minutes              = var.approved_rto_minutes
}

variable "environment" {
  type = string
}

variable "region" {
  type = string
}

variable "management_cidrs" {
  type = list(string)
}

variable "backup_repository_reference" {
  type    = string
  default = "UNDECIDED"
}

variable "kms_key_reference" {
  type    = string
  default = "UNDECIDED"
}

variable "observability_endpoint_reference" {
  type    = string
  default = "UNDECIDED"
}

variable "approved_rpo_minutes" {
  type    = number
  default = 0
}

variable "approved_rto_minutes" {
  type    = number
  default = 0
}

output "deployment_contract" {
  value = module.baseline.deployment_contract
}

output "production_ready" {
  value = module.baseline.production_ready
}
