output "deployment_contract" {
  description = "Validated topology contract, not provisioned-resource evidence."
  value       = local.deployment_contract
}

output "production_ready" {
  description = "False until explicit recovery/observability/key decisions are supplied; it does not attest deployment success."
  value       = length(local.unresolved_decisions) == 0 && length(var.management_cidrs) > 0
}
