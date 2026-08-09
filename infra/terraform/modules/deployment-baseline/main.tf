terraform {
  required_version = ">= 1.8.0, < 2.0.0"
}

locals {
  network_boundaries = ["public", "application", "data", "management", "monitoring", "backup"]
  unresolved_decisions = compact([
    var.backup_repository_reference == "UNDECIDED" ? "backup_repository_reference" : "",
    var.kms_key_reference == "UNDECIDED" ? "kms_key_reference" : "",
    var.observability_endpoint_reference == "UNDECIDED" ? "observability_endpoint_reference" : "",
    var.approved_rpo_minutes == 0 ? "approved_rpo_minutes" : "",
    var.approved_rto_minutes == 0 ? "approved_rto_minutes" : "",
  ])
  deployment_contract = {
    environment              = var.environment
    deployment_mode          = var.deployment_mode
    region                   = var.region
    network_boundaries       = local.network_boundaries
    tenant_database_strategy = var.tenant_database_strategy
    unresolved_decisions     = local.unresolved_decisions
  }
}
