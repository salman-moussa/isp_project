function columns(tableName, definitions) {
  return definitions.map(([columnName, dataType, notNull, defaultExpression = ''], index) => ({
    tableName,
    ordinalPosition: index + 1,
    columnName,
    dataType,
    notNull,
    defaultExpression: normalizeDefault(defaultExpression),
  }));
}

export const expectedTables = [
  { tableName: 'audit_events', persistence: 'p', rowSecurity: true, forceRowSecurity: true },
  { tableName: 'sessions', persistence: 'p', rowSecurity: false, forceRowSecurity: false },
  { tableName: 'support_grants', persistence: 'p', rowSecurity: true, forceRowSecurity: true },
  {
    tableName: 'tenant_dashboard_snapshots',
    persistence: 'p',
    rowSecurity: true,
    forceRowSecurity: true,
  },
  {
    tableName: 'tenant_memberships',
    persistence: 'p',
    rowSecurity: true,
    forceRowSecurity: true,
  },
  { tableName: 'tenants', persistence: 'p', rowSecurity: false, forceRowSecurity: false },
  { tableName: 'users', persistence: 'p', rowSecurity: false, forceRowSecurity: false },
];

export const expectedColumns = [
  ...columns('audit_events', [
    ['id', 'uuid', true, 'gen_random_uuid()'],
    ['tenant_id', 'uuid', false],
    ['actor_id', 'uuid', false],
    ['session_id', 'uuid', false],
    ['support_grant_id', 'uuid', false],
    ['action', 'text', true],
    ['resource_type', 'text', true],
    ['resource_id', 'text', false],
    ['reason', 'text', false],
    ['request_id', 'text', true],
    ['ip_address', 'text', false],
    ['user_agent', 'text', false],
    ['result', 'text', true],
    ['before', 'jsonb', false],
    ['after', 'jsonb', false],
    ['metadata', 'jsonb', true, "'{}'::jsonb"],
    ['occurred_at', 'timestamp with time zone', true, 'now()'],
  ]),
  ...columns('sessions', [
    ['id', 'uuid', true, 'gen_random_uuid()'],
    ['user_id', 'uuid', true],
    ['token_digest', 'text', true],
    ['device_label', 'text', false],
    ['ip_address', 'text', false],
    ['user_agent', 'text', false],
    ['mfa_verified_at', 'timestamp with time zone', false],
    ['expires_at', 'timestamp with time zone', true],
    ['revoked_at', 'timestamp with time zone', false],
    ['created_at', 'timestamp with time zone', true, 'now()'],
  ]),
  ...columns('support_grants', [
    ['id', 'uuid', true, 'gen_random_uuid()'],
    ['tenant_id', 'uuid', true],
    ['ticket_id', 'text', true],
    ['requester_id', 'uuid', true],
    ['approver_id', 'uuid', false],
    ['reason', 'text', true],
    ['permissions', 'text[]', true],
    ['status', 'support_grant_status', true, "'requested'::support_grant_status"],
    ['expires_at', 'timestamp with time zone', true],
    ['revoked_at', 'timestamp with time zone', false],
    ['created_at', 'timestamp with time zone', true, 'now()'],
  ]),
  ...columns('tenant_dashboard_snapshots', [
    ['id', 'uuid', true, 'gen_random_uuid()'],
    ['tenant_id', 'uuid', true],
    ['active_subscribers', 'bigint', true, '0'],
    ['online_subscribers', 'bigint', true, '0'],
    ['collections_usd_minor', 'bigint', true, '0'],
    ['collections_lbp_minor', 'bigint', true, '0'],
    ['computed_at', 'timestamp with time zone', true, 'now()'],
  ]),
  ...columns('tenant_memberships', [
    ['id', 'uuid', true, 'gen_random_uuid()'],
    ['tenant_id', 'uuid', true],
    ['user_id', 'uuid', true],
    ['role_key', 'text', true],
    ['permissions', 'text[]', true, 'ARRAY[]::text[]'],
    ['scope', 'jsonb', true, "'{}'::jsonb"],
    ['active', 'boolean', true, 'true'],
    ['created_at', 'timestamp with time zone', true, 'now()'],
  ]),
  ...columns('tenants', [
    ['id', 'uuid', true, 'gen_random_uuid()'],
    ['code', 'text', true],
    ['brand_name', 'text', true],
    ['legal_name', 'text', true],
    ['status', 'text', true, "'trial'::text"],
    ['timezone', 'text', true, "'Asia/Beirut'::text"],
    ['default_locale', 'text', true, "'en-LB'::text"],
    ['created_at', 'timestamp with time zone', true, 'now()'],
    ['archived_at', 'timestamp with time zone', false],
  ]),
  ...columns('users', [
    ['id', 'uuid', true, 'gen_random_uuid()'],
    ['account_kind', 'account_kind', true],
    ['email', 'text', true],
    ['display_name', 'text', true],
    ['password_hash', 'text', true],
    ['mfa_required', 'boolean', true, 'false'],
    ['disabled_at', 'timestamp with time zone', false],
    ['created_at', 'timestamp with time zone', true, 'now()'],
  ]),
];

function constraint(tableName, constraintName, kind, definition) {
  return { tableName, constraintName, kind, definition: normalizeSql(definition) };
}

export const expectedConstraints = [
  constraint(
    'audit_events',
    'audit_events_actor_id_fkey',
    'f',
    'FOREIGN KEY (actor_id) REFERENCES users(id)',
  ),
  constraint('audit_events', 'audit_events_pkey', 'p', 'PRIMARY KEY (id)'),
  constraint(
    'audit_events',
    'audit_events_request_id_action_key',
    'u',
    'UNIQUE (request_id, action)',
  ),
  constraint(
    'audit_events',
    'audit_events_support_grant_id_fkey',
    'f',
    'FOREIGN KEY (support_grant_id) REFERENCES support_grants(id)',
  ),
  constraint(
    'audit_events',
    'audit_events_tenant_id_fkey',
    'f',
    'FOREIGN KEY (tenant_id) REFERENCES tenants(id)',
  ),
  constraint('sessions', 'sessions_pkey', 'p', 'PRIMARY KEY (id)'),
  constraint('sessions', 'sessions_token_digest_key', 'u', 'UNIQUE (token_digest)'),
  constraint(
    'sessions',
    'sessions_user_id_fkey',
    'f',
    'FOREIGN KEY (user_id) REFERENCES users(id)',
  ),
  constraint(
    'support_grants',
    'support_grants_approver_id_check',
    'c',
    'CHECK (approver_id IS NULL OR approver_id <> requester_id)',
  ),
  constraint(
    'support_grants',
    'support_grants_approver_id_fkey',
    'f',
    'FOREIGN KEY (approver_id) REFERENCES users(id)',
  ),
  constraint('support_grants', 'support_grants_pkey', 'p', 'PRIMARY KEY (id)'),
  constraint(
    'support_grants',
    'support_grants_requester_id_fkey',
    'f',
    'FOREIGN KEY (requester_id) REFERENCES users(id)',
  ),
  constraint(
    'support_grants',
    'support_grants_tenant_id_fkey',
    'f',
    'FOREIGN KEY (tenant_id) REFERENCES tenants(id)',
  ),
  constraint(
    'tenant_dashboard_snapshots',
    'tenant_dashboard_snapshots_active_subscribers_check',
    'c',
    'CHECK (active_subscribers >= 0)',
  ),
  constraint(
    'tenant_dashboard_snapshots',
    'tenant_dashboard_snapshots_online_subscribers_check',
    'c',
    'CHECK (online_subscribers >= 0)',
  ),
  constraint(
    'tenant_dashboard_snapshots',
    'tenant_dashboard_snapshots_pkey',
    'p',
    'PRIMARY KEY (id)',
  ),
  constraint(
    'tenant_dashboard_snapshots',
    'tenant_dashboard_snapshots_tenant_id_fkey',
    'f',
    'FOREIGN KEY (tenant_id) REFERENCES tenants(id)',
  ),
  constraint('tenant_memberships', 'tenant_memberships_pkey', 'p', 'PRIMARY KEY (id)'),
  constraint(
    'tenant_memberships',
    'tenant_memberships_tenant_id_fkey',
    'f',
    'FOREIGN KEY (tenant_id) REFERENCES tenants(id)',
  ),
  constraint(
    'tenant_memberships',
    'tenant_memberships_tenant_id_user_id_key',
    'u',
    'UNIQUE (tenant_id, user_id)',
  ),
  constraint(
    'tenant_memberships',
    'tenant_memberships_user_id_fkey',
    'f',
    'FOREIGN KEY (user_id) REFERENCES users(id)',
  ),
  constraint('tenants', 'tenants_code_key', 'u', 'UNIQUE (code)'),
  constraint('tenants', 'tenants_pkey', 'p', 'PRIMARY KEY (id)'),
  constraint('users', 'users_email_key', 'u', 'UNIQUE (email)'),
  constraint('users', 'users_pkey', 'p', 'PRIMARY KEY (id)'),
];

function index(tableName, indexName, definition) {
  return { tableName, indexName, definition: normalizeSql(definition) };
}

export const expectedIndexes = [
  index(
    'audit_events',
    'audit_events_actor_time_idx',
    'CREATE INDEX audit_events_actor_time_idx ON audit_events USING btree (actor_id, occurred_at)',
  ),
  index(
    'audit_events',
    'audit_events_pkey',
    'CREATE UNIQUE INDEX audit_events_pkey ON audit_events USING btree (id)',
  ),
  index(
    'audit_events',
    'audit_events_request_id_action_key',
    'CREATE UNIQUE INDEX audit_events_request_id_action_key ON audit_events USING btree (request_id, action)',
  ),
  index(
    'audit_events',
    'audit_events_tenant_time_idx',
    'CREATE INDEX audit_events_tenant_time_idx ON audit_events USING btree (tenant_id, occurred_at)',
  ),
  index(
    'sessions',
    'sessions_pkey',
    'CREATE UNIQUE INDEX sessions_pkey ON sessions USING btree (id)',
  ),
  index(
    'sessions',
    'sessions_token_digest_key',
    'CREATE UNIQUE INDEX sessions_token_digest_key ON sessions USING btree (token_digest)',
  ),
  index(
    'sessions',
    'sessions_user_idx',
    'CREATE INDEX sessions_user_idx ON sessions USING btree (user_id)',
  ),
  index(
    'support_grants',
    'support_grants_pkey',
    'CREATE UNIQUE INDEX support_grants_pkey ON support_grants USING btree (id)',
  ),
  index(
    'support_grants',
    'support_grants_tenant_status_idx',
    'CREATE INDEX support_grants_tenant_status_idx ON support_grants USING btree (tenant_id, status)',
  ),
  index(
    'tenant_dashboard_snapshots',
    'tenant_dashboard_snapshots_pkey',
    'CREATE UNIQUE INDEX tenant_dashboard_snapshots_pkey ON tenant_dashboard_snapshots USING btree (id)',
  ),
  index(
    'tenant_dashboard_snapshots',
    'tenant_dashboard_snapshots_tenant_time_idx',
    'CREATE INDEX tenant_dashboard_snapshots_tenant_time_idx ON tenant_dashboard_snapshots USING btree (tenant_id, computed_at DESC)',
  ),
  index(
    'tenant_memberships',
    'tenant_memberships_pkey',
    'CREATE UNIQUE INDEX tenant_memberships_pkey ON tenant_memberships USING btree (id)',
  ),
  index(
    'tenant_memberships',
    'tenant_memberships_tenant_id_user_id_key',
    'CREATE UNIQUE INDEX tenant_memberships_tenant_id_user_id_key ON tenant_memberships USING btree (tenant_id, user_id)',
  ),
  index(
    'tenant_memberships',
    'tenant_memberships_tenant_idx',
    'CREATE INDEX tenant_memberships_tenant_idx ON tenant_memberships USING btree (tenant_id)',
  ),
  index(
    'tenants',
    'tenants_code_key',
    'CREATE UNIQUE INDEX tenants_code_key ON tenants USING btree (code)',
  ),
  index('tenants', 'tenants_pkey', 'CREATE UNIQUE INDEX tenants_pkey ON tenants USING btree (id)'),
  index(
    'users',
    'users_email_key',
    'CREATE UNIQUE INDEX users_email_key ON users USING btree (email)',
  ),
  index('users', 'users_pkey', 'CREATE UNIQUE INDEX users_pkey ON users USING btree (id)'),
];

export const expectedEnums = [
  { typeName: 'account_kind', labels: ['platform', 'tenant'] },
  {
    typeName: 'support_grant_status',
    labels: ['requested', 'approved', 'revoked', 'expired'],
  },
];

const tenantPolicyExpression = normalizeSql(
  "tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid",
);
export const expectedPolicies = [
  'audit_events',
  'support_grants',
  'tenant_dashboard_snapshots',
  'tenant_memberships',
].map((tableName) => ({
  tableName,
  policyName: `${tableName}_isolation`,
  permissive: 'PERMISSIVE',
  roles: '{public}',
  command: 'ALL',
  usingExpression: tenantPolicyExpression,
  checkExpression: tenantPolicyExpression,
}));

export const expectedFunction = {
  functionName: 'reject_audit_mutation',
  language: 'plpgsql',
  resultType: 'trigger',
  arguments: '',
  securityDefiner: false,
  volatility: 'v',
  body: normalizeSql("BEGIN RAISE EXCEPTION 'audit_events are append-only'; END;"),
};

export const expectedTrigger = {
  tableName: 'audit_events',
  triggerName: 'audit_events_no_update_or_delete',
  functionName: 'reject_audit_mutation',
  enabled: 'O',
  triggerType: 27,
};

export function normalizeDefault(value) {
  return value
    .toLowerCase()
    .replaceAll(/::(?:text|bigint|boolean|jsonb|support_grant_status|text\[\])/gu, '')
    .replaceAll(/[()\s]/gu, '');
}

export function normalizeSql(value) {
  return value
    .toLowerCase()
    .replaceAll('public.', '')
    .replaceAll(/::text/gu, '')
    .replaceAll(/[()\s"]/gu, '');
}

export function assertExactSection(section, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Legacy schema ${section} do not match the immutable Orvex baseline manifest`);
  }
}
