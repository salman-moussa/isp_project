#!/usr/bin/env node
/**
 * Read-only migration preflight, run before any production service is recreated.
 *
 * The migrator refuses to continue when an applied migration's SHA-256 no longer matches
 * the packaged bytes. Discovering that *during* deployment means the old containers are
 * already stopped, so the outage lasts until someone restores the original bytes. This
 * preflight performs the same comparison while production is still serving traffic and
 * exits non-zero before anything is torn down.
 *
 * It never writes. It never edits `_orvex_migrations`. A checksum mismatch is a packaging
 * defect to fix in the artifact, never a ledger row to overwrite.
 *
 *   node packages/database/scripts/preflight-migrations.mjs
 *
 * Uses the same CONTROL_DATABASE_MIGRATION_URL / TENANT_DATABASE_MIGRATION_URL environment
 * contract as the migrator, so it runs unchanged inside the production `migrate` image.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { loadMigrationPlan, resolveConfiguredMigrationTargets } from './migrate.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = resolve(scriptDirectory, '../migrations');

export async function computePackagedChecksums(databaseScope) {
  const names = await loadMigrationPlan(databaseScope);
  const checksums = new Map();
  for (const name of names) {
    const contents = await readFile(resolve(migrationsDirectory, name), 'utf8');
    checksums.set(name, createHash('sha256').update(contents).digest('hex'));
  }
  return checksums;
}

/**
 * Compares packaged migrations against the ledger already applied to a database.
 *
 * `blocking` failures must stop the deployment before downtime begins:
 *   - `checksum_mismatch`: identical intent, different bytes (the CRLF class of defect).
 *   - `applied_missing_locally`: the artifact dropped a migration production has applied.
 *   - `pending_out_of_order`: a new migration sorts before one already applied, so it
 *     would replay against a schema that has already moved past it.
 */
export function comparePlan(packagedChecksums, appliedRows) {
  const applied = new Map(appliedRows.map((row) => [row.name, row.checksum]));
  const blocking = [];
  const pending = [];
  let matched = 0;
  let lastApplied = '';

  for (const [name, checksum] of packagedChecksums) {
    const appliedChecksum = applied.get(name);
    if (appliedChecksum === undefined) {
      pending.push(name);
      continue;
    }
    if (appliedChecksum !== checksum) {
      blocking.push({
        kind: 'checksum_mismatch',
        name,
        detail: `applied ${appliedChecksum}, packaged ${checksum}`,
      });
    } else {
      matched += 1;
    }
    if (name.localeCompare(lastApplied) > 0) lastApplied = name;
  }

  for (const name of applied.keys()) {
    if (!packagedChecksums.has(name)) {
      blocking.push({
        kind: 'applied_missing_locally',
        name,
        detail: 'applied in the database but absent from this artifact',
      });
    }
  }

  for (const name of pending) {
    if (lastApplied !== '' && name.localeCompare(lastApplied) < 0) {
      blocking.push({
        kind: 'pending_out_of_order',
        name,
        detail: `sorts before the last applied migration ${lastApplied}`,
      });
    }
  }

  return { matched, pending, blocking, lastApplied };
}

async function readAppliedLedger(databaseUrl) {
  const client = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
  });
  try {
    // Read exactly as the migrator does. The migration DSN's login role is not the schema
    // owner, so without assuming `orvex_owner` the ledger read fails with "permission denied
    // for schema public" and the preflight would look like an infrastructure fault.
    return await client.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      await transaction.unsafe('SET LOCAL search_path TO public, pg_catalog');
      const present = await transaction`
        SELECT to_regclass('public._orvex_migrations') IS NOT NULL AS present
      `;
      if (!present[0].present) return [];
      return await transaction`SELECT name, checksum FROM public._orvex_migrations ORDER BY name`;
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}

export async function preflight(environment = process.env) {
  const targets = resolveConfiguredMigrationTargets(environment);
  const reports = [];
  for (const target of targets) {
    const packagedChecksums = await computePackagedChecksums(target.databaseScope);
    const appliedRows = await readAppliedLedger(target.databaseUrl);
    reports.push({
      databaseScope: target.databaseScope,
      ...comparePlan(packagedChecksums, appliedRows),
      packagedCount: packagedChecksums.size,
      appliedCount: appliedRows.length,
    });
  }
  return reports;
}

function printReport(report) {
  const label = `[${report.databaseScope}]`;
  console.log(
    `${label} packaged ${report.packagedCount}, applied ${report.appliedCount}, ` +
      `checksum-matched ${report.matched}, pending ${report.pending.length}`,
  );
  for (const name of report.pending) console.log(`${label}   forward migration: ${name}`);
  for (const failure of report.blocking) {
    console.error(`${label}   BLOCKING ${failure.kind}: ${failure.name} (${failure.detail})`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  preflight()
    .then((reports) => {
      for (const report of reports) printReport(report);
      const blocking = reports.flatMap((report) => report.blocking);
      if (blocking.length > 0) {
        console.error(
          `Migration preflight failed with ${blocking.length} blocking finding(s). ` +
            'Do not recreate services. Fix the release artifact; never edit the applied ledger.',
        );
        process.exitCode = 1;
        return;
      }
      const pending = reports.reduce((total, report) => total + report.pending.length, 0);
      console.log(
        `Migration preflight passed: every applied migration matches its packaged bytes; ` +
          `${pending} forward migration(s) will be promoted.`,
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
