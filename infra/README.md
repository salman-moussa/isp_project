# Infrastructure baseline

This directory defines Phase 1 topology contracts and host-hardening scaffolding. It does **not**
provision a production environment yet. Cloud/provider, account, DNS/TLS, registry, secret manager,
managed data services, observability backend, backup repository and accepted RPO/RTO decisions
remain required.

- `terraform/`: provider-neutral deployment manifest module and per-variant roots. It validates
  topology inputs without creating resources; add reviewed provider modules rather than putting
  ad-hoc console steps outside IaC.
- `ansible/`: baseline Linux host hardening and container-host preparation. Test against the chosen
  supported distribution before production.
- `monitoring/`: provisional Prometheus-compatible rules and telemetry contracts. Metric names must
  be reconciled with application instrumentation before enabling alerts.
- `docker/`: local dependency initialization only.

Production state must use encrypted remote storage, locking, restricted identities, review/plan
approval and separate state per environment. Do not place secret values in Terraform
variables/state, Ansible inventory, GitHub logs or this repository; use runtime secret references.

Recommended validation when tools are installed:

```sh
terraform -chdir=infra/terraform/environments/shared-hosted init -backend=false
terraform -chdir=infra/terraform/environments/shared-hosted validate
ansible-playbook --syntax-check -i infra/ansible/inventory/example.yml infra/ansible/playbooks/container-host.yml
```

These checks validate syntax, not a deployment, security review, connectivity or restore capability.
