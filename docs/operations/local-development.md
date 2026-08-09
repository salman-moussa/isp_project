# Local development

Status: infrastructure bootstrap. Application commands depend on the workspace scripts implemented
by the application teams.

## Prerequisites

- Git, Docker Engine/Desktop with Compose v2, and the Node version declared by the repository
  (`.nvmrc`/`engines`) once present.
- At least 4 CPU cores, 8 GB free RAM and 15 GB free disk for the local dependencies.
- Copy `.env.example` to `.env` and replace every `change-me-*` value. `.env` is local-only and must
  never be committed.

## Start dependencies

```sh
docker compose config --quiet
docker compose up -d --wait
docker compose ps
```

Local endpoints bind to `127.0.0.1`: PostgreSQL, Redis, MinIO API/console and Mailpit SMTP/UI. They
are not production configurations. MinIO buckets/aliases are initialized idempotently by
`minio-init`.

Once the npm workspace and lockfile exist:

```sh
npm ci
npm run dev
npm run validate
```

Use the scripts declared in the root manifest as the source of truth. CI deliberately guards absent
projects during bootstrap, but a present workspace is expected to expose its applicable lint,
typecheck, test, contract and build scripts.

## Stop and reset

```sh
docker compose down
```

`docker compose down --volumes` permanently removes local dependency data. Run it only after
confirming the Compose project and working directory identify this repository. It is forbidden for
staging/production and is intentionally not wrapped in an automation script.

## Test dependencies

`docker-compose.test.yml` uses isolated containers, ephemeral volumes, random host ports and health
checks. CI or a local harness should use a unique `COMPOSE_PROJECT_NAME` and always collect logs
before teardown.

```sh
docker compose -f docker-compose.test.yml up -d --wait
npm test
docker compose -f docker-compose.test.yml logs --no-color
docker compose -f docker-compose.test.yml down --volumes
```

The example is not evidence that application tests exist or pass. Use only synthetic fixtures
documented under `docs/testing/fixtures.md`.

## Troubleshooting

- Validate substitutions with `docker compose config`; missing required secrets fail before startup.
- Inspect health and logs with `docker compose ps` and `docker compose logs <service>`; redact
  before sharing.
- Port collisions: change only the `*_HOST_PORT` variables in `.env`.
- Database/Redis authentication failures: ensure application URLs and Compose passwords match;
  URL-encode special characters.
- Never paste `.env`, access tokens, router exports or production records into tickets.
