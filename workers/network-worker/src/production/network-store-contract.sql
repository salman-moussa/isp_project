-- Reference contract for PostgresDurableNetworkStore. Install through a reviewed tenant-plane
-- migration; this file is intentionally not an automatically applied migration.
create extension if not exists pgcrypto;
create schema if not exists network_worker;

create table if not exists network_worker.jobs (
  job_id text primary key,
  tenant_id text not null,
  idempotency_key text not null,
  request jsonb not null,
  job jsonb not null,
  state text not null,
  available_at timestamptz not null,
  created_at timestamptz not null,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  unique (tenant_id, idempotency_key)
);
create index if not exists network_jobs_claim_idx
  on network_worker.jobs (available_at, created_at)
  where state in ('queued', 'retry_scheduled', 'reconciling', 'running');

create table if not exists network_worker.routers (
  tenant_id text not null,
  router_id text not null,
  endpoint text not null,
  credential_reference text not null check (credential_reference like 'secret://%'),
  connector text not null check (connector in ('routeros-api', 'routeros-rest', 'simulator')),
  enabled boolean not null,
  primary key (tenant_id, router_id)
);

create or replace function network_worker.enqueue_job(p_request jsonb, p_now timestamptz)
returns table(job jsonb) language plpgsql security definer set search_path = pg_catalog, network_worker as $$
declare
  existing network_worker.jobs%rowtype;
  new_id text := 'network-job-' || gen_random_uuid()::text;
  new_job jsonb;
begin
  if nullif(p_request->>'tenantId', '') is null or nullif(p_request->>'idempotencyKey', '') is null then
    raise exception 'invalid network request';
  end if;
  new_job := jsonb_build_object(
    'jobId', new_id, 'request', p_request, 'createdAt', to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attempts', '[]'::jsonb, 'state', 'queued',
    'availableAt', to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  insert into network_worker.jobs(job_id, tenant_id, idempotency_key, request, job, state, available_at, created_at)
  values (new_id, p_request->>'tenantId', p_request->>'idempotencyKey', p_request, new_job, 'queued', p_now, p_now)
  on conflict (tenant_id, idempotency_key) do nothing;
  select * into existing from network_worker.jobs
    where tenant_id = p_request->>'tenantId' and idempotency_key = p_request->>'idempotencyKey';
  if existing.request <> p_request then raise exception 'idempotency key payload mismatch'; end if;
  return query select existing.job;
end $$;

create or replace function network_worker.claim_job(p_worker text, p_now timestamptz, p_lease_ms integer)
returns table(job jsonb, lease_token uuid) language sql security definer set search_path = pg_catalog, network_worker as $$
  with candidate as (
    select job_id from network_worker.jobs
    where available_at <= p_now and (
      state in ('queued', 'retry_scheduled', 'reconciling') or
      (state = 'running' and lease_expires_at <= p_now)
    ) order by created_at, job_id for update skip locked limit 1
  ), claimed as (
    update network_worker.jobs j set
      state = 'running', job = jsonb_set(j.job, '{state}', '"running"'::jsonb),
      lease_owner = p_worker, lease_token = gen_random_uuid(),
      lease_expires_at = p_now + make_interval(secs => p_lease_ms::double precision / 1000)
    from candidate c where j.job_id = c.job_id
    returning j.job, j.lease_token
  ) select claimed.job, claimed.lease_token from claimed;
$$;

create or replace function network_worker.save_job(p_worker text, p_lease_token uuid, p_job jsonb)
returns boolean language plpgsql security definer set search_path = pg_catalog, network_worker as $$
begin
  update network_worker.jobs set
    job = p_job, state = p_job->>'state', available_at = (p_job->>'availableAt')::timestamptz,
    lease_owner = null, lease_token = null, lease_expires_at = null
  where job_id = p_job->>'jobId' and lease_owner = p_worker and lease_token = p_lease_token;
  return found;
end $$;

create or replace function network_worker.get_job(p_job_id text)
returns table(job jsonb) language sql security definer set search_path = pg_catalog, network_worker as $$
  select j.job from network_worker.jobs j where j.job_id = p_job_id;
$$;
create or replace function network_worker.get_job_by_idempotency(p_tenant text, p_key text)
returns table(job jsonb) language sql security definer set search_path = pg_catalog, network_worker as $$
  select j.job from network_worker.jobs j where j.tenant_id = p_tenant and j.idempotency_key = p_key;
$$;
create or replace function network_worker.list_dead_letters(p_limit integer)
returns table(job jsonb) language sql security definer set search_path = pg_catalog, network_worker as $$
  select j.job from network_worker.jobs j where j.state = 'dead_lettered' order by j.created_at limit least(p_limit, 1000);
$$;

create or replace function network_worker.register_router(p_tenant text, p_router text, p_endpoint text, p_secret text, p_connector text, p_enabled boolean)
returns void language sql security definer set search_path = pg_catalog, network_worker as $$
  insert into network_worker.routers(tenant_id, router_id, endpoint, credential_reference, connector, enabled)
  values(p_tenant, p_router, p_endpoint, p_secret, p_connector, p_enabled)
  on conflict (tenant_id, router_id) do update set endpoint=excluded.endpoint,
    credential_reference=excluded.credential_reference, connector=excluded.connector, enabled=excluded.enabled;
$$;
create or replace function network_worker.get_router(p_tenant text, p_router text)
returns table(router_id text, tenant_id text, endpoint text, credential_reference text, connector text, enabled boolean)
language sql security definer set search_path = pg_catalog, network_worker as $$
  select r.router_id, r.tenant_id, r.endpoint, r.credential_reference, r.connector, r.enabled
  from network_worker.routers r where r.tenant_id=p_tenant and r.router_id=p_router;
$$;

revoke all on schema network_worker from public;
revoke all on all tables in schema network_worker from public;
revoke all on all functions in schema network_worker from public;
