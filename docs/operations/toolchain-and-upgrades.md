# Toolchain and upgrade policy

Versions reviewed for the Phase 1 baseline on 2026-08-09:

| Component              |                                                               Baseline | Source / note                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------: | -------------------------------------------------------------------------------------------------------------------------- |
| Node / npm             |                                                      22.15.0 / 11.17.0 | Repository `.nvmrc`, `engines`, `packageManager` and lockfile are authoritative                                            |
| PostgreSQL local image |                                                            18.4-alpine | [Docker Official Image](https://hub.docker.com/_/postgres)                                                                 |
| Redis local image      |                                                           8.8.0-alpine | [Docker Official Image](https://hub.docker.com/_/redis); production licensing must be reviewed                             |
| Mailpit local image    |                                                                 1.30.0 | [Official releases](https://github.com/axllent/mailpit/releases); local/test only                                          |
| MinIO local images     |                                                    Dated 2025 releases | Explicitly pinned for reproducibility; maintenance/licensing and supported production object store remain an open decision |
| Terraform validator    |                                                                 1.14.6 | [HashiCorp setup action](https://github.com/hashicorp/setup-terraform)                                                     |
| ansible-lint           |                                                                 26.6.0 | [Official PyPI project](https://pypi.org/project/ansible-lint/)                                                            |
| GitHub actions         | checkout/setup-node v6, CodeQL/setup-Terraform v4, Trivy action 0.36.0 | Major tags are bootstrap-only; pin reviewed commit SHAs before production                                                  |

Exact application and container versions stay in checked-in manifests/lockfiles; production images
additionally pin digests and retain SBOM/provenance. Renovation happens through a dedicated pull
request that records release notes, license and support changes, migration/deprecation impact,
vulnerability delta, build/test/security/compatibility results and rollback. Security updates may
use an expedited review but never bypass staging or integrity/isolation gates.

Review supported runtimes monthly, dependency/container vulnerabilities continuously or weekly, and
major upgrades deliberately. Remove end-of-life versions before production. Never use floating
`latest` tags, unreviewed automatic production updates, or a local image pin as evidence that the
production service is supported.
