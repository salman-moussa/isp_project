-- 202609090700_control_center_portfolio.sql
-- Control Center reads computed from the control plane's own records: the portfolio snapshot,
-- a client file, package versions with their subscriber counts, subscriptions with pending
-- transition requests, the platform billing ledger with outstanding balances, and the audit
-- trail. Every reader requires the signed Control Center request context with the permission
-- and action the API route declares. Money stays integer minor units per currency.

CREATE FUNCTION control_client_outstanding(p_tenant uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('currency', x.currency, 'amountMinor', x.amount, 'invoices', x.invoices) ORDER BY x.currency), '[]'::jsonb)
  FROM (
    SELECT i.currency::text AS currency,
      sum(i.amount_minor - coalesce((SELECT sum(CASE a.entry_kind WHEN 'posted' THEN a.amount_minor ELSE -a.amount_minor END)
            FROM control_center_payment_allocations a WHERE a.invoice_id = i.id), 0)) AS amount,
      count(*) AS invoices
    FROM control_center_invoices i
    WHERE i.tenant_id = p_tenant AND i.entry_kind = 'posted'
      AND NOT EXISTS (SELECT 1 FROM control_center_invoices r WHERE r.reverses_invoice_id = i.id)
    GROUP BY i.currency
    HAVING sum(i.amount_minor - coalesce((SELECT sum(CASE a.entry_kind WHEN 'posted' THEN a.amount_minor ELSE -a.amount_minor END)
            FROM control_center_payment_allocations a WHERE a.invoice_id = i.id), 0)) > 0
  ) x
$$;
REVOKE ALL ON FUNCTION control_client_outstanding(uuid) FROM PUBLIC;

CREATE FUNCTION read_control_portfolio() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result jsonb; month_start timestamptz;
BEGIN
  PERFORM control_require_context('platform.client.view', 'portfolio.read');
  month_start := date_trunc('month', clock_timestamp() AT TIME ZONE 'Asia/Beirut') AT TIME ZONE 'Asia/Beirut';
  SELECT jsonb_build_object(
    'asOf', clock_timestamp(),
    'clients', jsonb_build_object(
      'total', (SELECT count(*) FROM control_center_clients),
      'byState', coalesce((SELECT jsonb_agg(jsonb_build_object('state', s.state, 'count', s.n) ORDER BY s.state)
        FROM (SELECT coalesce(sub.state, 'lead'::control_client_state)::text AS state, count(*) AS n
              FROM control_center_clients c LEFT JOIN control_center_subscriptions sub ON sub.tenant_id = c.tenant_id
              GROUP BY 1) s), '[]'::jsonb),
      'newThisMonth', (SELECT count(*) FROM control_center_clients c WHERE c.created_at >= month_start)),
    'subscriptions', jsonb_build_object(
      'mrr', coalesce((SELECT jsonb_agg(jsonb_build_object('currency', m.currency, 'amountMinor', m.amount, 'subscriptions', m.n) ORDER BY m.currency)
        FROM (SELECT p.currency::text AS currency, sum(p.price_minor) AS amount, count(*) AS n
              FROM control_center_subscriptions s JOIN control_center_package_versions p ON p.id = s.package_version_id
              WHERE s.state IN ('active', 'grace') GROUP BY p.currency) m), '[]'::jsonb),
      'renewalsDue', coalesce((SELECT jsonb_agg(jsonb_build_object('tenantId', s.tenant_id, 'tradingName', c.trading_name, 'state', s.state,
            'endsAt', s.ends_at, 'packageKey', p.package_key, 'priceMinor', p.price_minor, 'currency', p.currency) ORDER BY s.ends_at)
        FROM control_center_subscriptions s
        JOIN control_center_clients c ON c.tenant_id = s.tenant_id
        JOIN control_center_package_versions p ON p.id = s.package_version_id
        WHERE s.ends_at IS NOT NULL AND s.ends_at BETWEEN clock_timestamp() - interval '7 days' AND clock_timestamp() + interval '30 days'
          AND s.state IN ('trial', 'active', 'grace')), '[]'::jsonb),
      'pendingTransitions', (SELECT count(*) FROM control_center_transition_requests r WHERE r.status = 'pending')),
    'billing', jsonb_build_object(
      'outstanding', coalesce((SELECT jsonb_agg(jsonb_build_object('currency', o.currency, 'amountMinor', o.amount, 'invoices', o.invoices) ORDER BY o.currency)
        FROM (SELECT (e->>'currency') AS currency, sum((e->>'amountMinor')::bigint) AS amount, sum((e->>'invoices')::bigint) AS invoices
              FROM control_center_clients c, jsonb_array_elements(control_client_outstanding(c.tenant_id)) e GROUP BY 1) o), '[]'::jsonb),
      'receivedThisMonth', coalesce((SELECT jsonb_agg(jsonb_build_object('currency', r.currency, 'amountMinor', r.amount, 'payments', r.n) ORDER BY r.currency)
        FROM (SELECT p.currency::text AS currency, sum(p.amount_minor) AS amount, count(*) AS n
              FROM control_center_payments p WHERE p.entry_kind = 'posted' AND p.posted_at >= month_start
                AND NOT EXISTS (SELECT 1 FROM control_center_payments x WHERE x.reverses_payment_id = p.id)
              GROUP BY p.currency) r), '[]'::jsonb)),
    'service', jsonb_build_object(
      'healthy', (SELECT count(*) FROM control_center_service_summaries WHERE deployment_health = 'healthy'),
      'attention', (SELECT count(*) FROM control_center_service_summaries WHERE deployment_health = 'attention'),
      'blocked', (SELECT count(*) FROM control_center_service_summaries WHERE deployment_health = 'blocked'),
      'unknown', (SELECT count(*) FROM control_center_clients c WHERE NOT EXISTS (SELECT 1 FROM control_center_service_summaries s WHERE s.tenant_id = c.tenant_id)),
      'openTickets', (SELECT coalesce(sum(open_ticket_count), 0) FROM control_center_service_summaries),
      'escalated', (SELECT count(*) FROM control_center_service_summaries WHERE support_status = 'escalated'),
      'activeSupportGrants', (SELECT count(*) FROM support_grants g WHERE g.status = 'approved' AND g.revoked_at IS NULL AND g.expires_at > clock_timestamp()),
      'requestedSupportGrants', (SELECT count(*) FROM support_grants g WHERE g.status = 'requested')),
    'activity', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'operation', a.operation, 'entityType', a.entity_type, 'entityId', a.entity_id,
          'tenantId', a.tenant_id, 'tradingName', c.trading_name, 'actor', coalesce(u.display_name, a.actor_id), 'reason', a.reason, 'occurredAt', a.occurred_at) ORDER BY a.occurred_at DESC)
      FROM (SELECT * FROM control_center_audit_events ORDER BY occurred_at DESC LIMIT 25) a
      LEFT JOIN control_center_clients c ON c.tenant_id = a.tenant_id
      LEFT JOIN users u ON u.id::text = a.actor_id), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION read_control_portfolio() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_control_portfolio() TO orvex_control_runtime;

CREATE FUNCTION read_control_client_detail(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result jsonb;
BEGIN
  PERFORM control_require_context('platform.client.view', 'client.detail');
  IF NOT EXISTS (SELECT 1 FROM control_center_clients WHERE tenant_id = p_tenant) THEN
    RAISE EXCEPTION 'Control Center client not found' USING ERRCODE = 'CC404';
  END IF;
  SELECT jsonb_build_object(
    'client', (SELECT jsonb_build_object('id', c.id, 'tenantId', c.tenant_id, 'legalName', c.legal_name, 'tradingName', c.trading_name,
        'registrationNumber', c.registration_number, 'accountOwner', coalesce(o.display_name, c.account_owner_id), 'notes', c.notes,
        'createdAt', c.created_at, 'updatedAt', c.updated_at, 'tenantCode', t.code, 'tenantStatus', t.status::text)
      FROM control_center_clients c LEFT JOIN users o ON o.id::text = c.account_owner_id LEFT JOIN tenants t ON t.id = c.tenant_id
      WHERE c.tenant_id = p_tenant),
    'contacts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'role', k.contact_role, 'name', k.display_name, 'email', k.email, 'phone', k.phone,
        'preferredLocale', k.preferred_locale, 'isPrimary', k.is_primary, 'archivedAt', k.archived_at) ORDER BY k.is_primary DESC, k.created_at)
      FROM control_center_client_contacts k WHERE k.tenant_id = p_tenant AND k.archived_at IS NULL), '[]'::jsonb),
    'subscription', (SELECT jsonb_build_object('id', s.id, 'state', s.state, 'packageVersionId', s.package_version_id, 'packageKey', p.package_key,
        'packageName', p.name_en, 'packageNameAr', p.name_ar, 'version', p.version, 'priceMinor', p.price_minor, 'currency', p.currency,
        'entitlements', to_jsonb(p.entitlements), 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'revision', s.revision, 'updatedAt', s.updated_at)
      FROM control_center_subscriptions s JOIN control_center_package_versions p ON p.id = s.package_version_id WHERE s.tenant_id = p_tenant),
    'transitionRequests', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'fromState', r.from_state, 'toState', r.to_state, 'reason', r.reason,
        'requestedBy', coalesce(u.display_name, r.requested_by), 'requestedAt', r.requested_at, 'status', r.status, 'decidedBy', coalesce(d.display_name, r.decided_by),
        'decisionReason', r.decision_reason, 'decidedAt', r.decided_at, 'expectedRevision', r.expected_revision) ORDER BY r.requested_at DESC)
      FROM control_center_transition_requests r LEFT JOIN users u ON u.id::text = r.requested_by LEFT JOIN users d ON d.id::text = r.decided_by
      WHERE r.tenant_id = p_tenant), '[]'::jsonb),
    'transitions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'fromState', x.from_state, 'toState', x.to_state, 'reason', x.reason,
        'actor', coalesce(u.display_name, x.actor_id), 'approver', coalesce(a.display_name, x.approver_id), 'occurredAt', x.occurred_at) ORDER BY x.occurred_at DESC)
      FROM control_center_subscription_transitions x LEFT JOIN users u ON u.id::text = x.actor_id LEFT JOIN users a ON a.id::text = x.approver_id
      WHERE x.tenant_id = p_tenant), '[]'::jsonb),
    'invoices', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'invoiceNumber', i.invoice_number, 'entryKind', i.entry_kind, 'reversesInvoiceId', i.reverses_invoice_id,
        'amountMinor', i.amount_minor, 'currency', i.currency, 'dueAt', i.due_at, 'postedAt', i.posted_at, 'reason', i.reason,
        'reversed', EXISTS (SELECT 1 FROM control_center_invoices r WHERE r.reverses_invoice_id = i.id),
        'allocatedMinor', coalesce((SELECT sum(CASE a.entry_kind WHEN 'posted' THEN a.amount_minor ELSE -a.amount_minor END) FROM control_center_payment_allocations a WHERE a.invoice_id = i.id), 0)) ORDER BY i.posted_at DESC)
      FROM control_center_invoices i WHERE i.tenant_id = p_tenant), '[]'::jsonb),
    'payments', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'receiptNumber', p.receipt_number, 'entryKind', p.entry_kind, 'reversesPaymentId', p.reverses_payment_id,
        'amountMinor', p.amount_minor, 'currency', p.currency, 'postedAt', p.posted_at, 'reason', p.reason,
        'reversed', EXISTS (SELECT 1 FROM control_center_payments r WHERE r.reverses_payment_id = p.id),
        'allocatedMinor', coalesce((SELECT sum(CASE a.entry_kind WHEN 'posted' THEN a.amount_minor ELSE -a.amount_minor END) FROM control_center_payment_allocations a WHERE a.payment_id = p.id), 0)) ORDER BY p.posted_at DESC)
      FROM control_center_payments p WHERE p.tenant_id = p_tenant), '[]'::jsonb),
    'allocations', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'entryKind', a.entry_kind, 'invoiceId', a.invoice_id, 'invoiceNumber', i.invoice_number,
        'paymentId', a.payment_id, 'receiptNumber', p.receipt_number, 'amountMinor', a.amount_minor, 'currency', a.currency, 'postedAt', a.posted_at, 'reason', a.reason) ORDER BY a.posted_at DESC)
      FROM control_center_payment_allocations a
      JOIN control_center_invoices i ON i.id = a.invoice_id JOIN control_center_payments p ON p.id = a.payment_id
      WHERE a.tenant_id = p_tenant), '[]'::jsonb),
    'outstanding', control_client_outstanding(p_tenant),
    'summary', (SELECT jsonb_build_object('deploymentHealth', s.deployment_health, 'deploymentStage', s.deployment_stage, 'deploymentUpdatedAt', s.deployment_updated_at,
        'supportStatus', s.support_status, 'openTicketCount', s.open_ticket_count, 'oldestOpenTicketAt', s.oldest_open_ticket_at, 'summary', s.summary, 'updatedAt', s.updated_at)
      FROM control_center_service_summaries s WHERE s.tenant_id = p_tenant),
    'supportGrants', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'ticketId', g.ticket_id, 'requester', coalesce(r.display_name, g.requester_id::text),
        'approver', a.display_name, 'reason', g.reason, 'permissions', to_jsonb(g.permissions), 'status', g.status::text, 'expiresAt', g.expires_at,
        'revokedAt', g.revoked_at, 'createdAt', g.created_at) ORDER BY g.created_at DESC)
      FROM (SELECT * FROM support_grants WHERE tenant_id = p_tenant ORDER BY created_at DESC LIMIT 20) g
      LEFT JOIN users r ON r.id = g.requester_id LEFT JOIN users a ON a.id = g.approver_id), '[]'::jsonb),
    'audit', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'operation', a.operation, 'entityType', a.entity_type, 'entityId', a.entity_id,
        'actor', coalesce(u.display_name, a.actor_id), 'reason', a.reason, 'occurredAt', a.occurred_at) ORDER BY a.occurred_at DESC)
      FROM (SELECT * FROM control_center_audit_events WHERE tenant_id = p_tenant ORDER BY occurred_at DESC LIMIT 30) a
      LEFT JOIN users u ON u.id::text = a.actor_id), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION read_control_client_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_control_client_detail(uuid) TO orvex_control_runtime;

CREATE FUNCTION read_control_packages() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result jsonb;
BEGIN
  PERFORM control_require_context('platform.client.view', 'package.list');
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'packageKey', p.package_key, 'version', p.version, 'nameEn', p.name_en, 'nameAr', p.name_ar,
      'entitlements', to_jsonb(p.entitlements), 'priceMinor', p.price_minor, 'currency', p.currency, 'effectiveFrom', p.effective_from,
      'effectiveUntil', p.effective_until, 'createdBy', coalesce(u.display_name, p.created_by), 'createdAt', p.created_at,
      'current', p.effective_from <= clock_timestamp() AND (p.effective_until IS NULL OR p.effective_until > clock_timestamp()),
      'subscriptions', (SELECT count(*) FROM control_center_subscriptions s WHERE s.package_version_id = p.id),
      'activeSubscriptions', (SELECT count(*) FROM control_center_subscriptions s WHERE s.package_version_id = p.id AND s.state IN ('active', 'grace')))
    ORDER BY p.package_key, p.version DESC), '[]'::jsonb)
  INTO result
  FROM control_center_package_versions p LEFT JOIN users u ON u.id::text = p.created_by;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION read_control_packages() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_control_packages() TO orvex_control_runtime;

CREATE FUNCTION read_control_subscriptions() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result jsonb;
BEGIN
  PERFORM control_require_context('platform.client.view', 'subscription.list');
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'tenantId', s.tenant_id, 'tradingName', c.trading_name, 'legalName', c.legal_name,
      'state', s.state, 'packageVersionId', s.package_version_id, 'packageKey', p.package_key, 'packageName', p.name_en, 'packageNameAr', p.name_ar,
      'priceMinor', p.price_minor, 'currency', p.currency, 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'revision', s.revision, 'updatedAt', s.updated_at,
      'pendingRequest', (SELECT jsonb_build_object('id', r.id, 'toState', r.to_state, 'reason', r.reason, 'requestedBy', coalesce(u.display_name, r.requested_by), 'requestedAt', r.requested_at)
          FROM control_center_transition_requests r LEFT JOIN users u ON u.id::text = r.requested_by
          WHERE r.subscription_id = s.id AND r.status = 'pending' ORDER BY r.requested_at DESC LIMIT 1))
    ORDER BY CASE s.state WHEN 'grace' THEN 0 WHEN 'restricted' THEN 1 WHEN 'trial' THEN 2 WHEN 'active' THEN 3 ELSE 4 END, s.ends_at NULLS LAST, c.trading_name), '[]'::jsonb)
  INTO result
  FROM control_center_subscriptions s
  JOIN control_center_clients c ON c.tenant_id = s.tenant_id
  JOIN control_center_package_versions p ON p.id = s.package_version_id;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION read_control_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_control_subscriptions() TO orvex_control_runtime;

CREATE FUNCTION read_control_billing(p_limit integer DEFAULT 200) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result jsonb; lim integer := least(greatest(coalesce(p_limit, 200), 1), 500);
BEGIN
  PERFORM control_require_context('platform.billing.view', 'billing.list');
  SELECT jsonb_build_object(
    'asOf', clock_timestamp(),
    'outstandingByClient', coalesce((SELECT jsonb_agg(jsonb_build_object('tenantId', c.tenant_id, 'tradingName', c.trading_name, 'outstanding', o.value) ORDER BY c.trading_name)
      FROM control_center_clients c, LATERAL (SELECT control_client_outstanding(c.tenant_id) AS value) o WHERE jsonb_array_length(o.value) > 0), '[]'::jsonb),
    'invoices', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'tenantId', i.tenant_id, 'tradingName', c.trading_name, 'invoiceNumber', i.invoice_number,
        'entryKind', i.entry_kind, 'reversesInvoiceId', i.reverses_invoice_id, 'amountMinor', i.amount_minor, 'currency', i.currency, 'dueAt', i.due_at,
        'postedAt', i.posted_at, 'reason', i.reason, 'actor', coalesce(u.display_name, i.actor_id),
        'reversed', EXISTS (SELECT 1 FROM control_center_invoices r WHERE r.reverses_invoice_id = i.id),
        'allocatedMinor', coalesce((SELECT sum(CASE a.entry_kind WHEN 'posted' THEN a.amount_minor ELSE -a.amount_minor END) FROM control_center_payment_allocations a WHERE a.invoice_id = i.id), 0)) ORDER BY i.posted_at DESC)
      FROM (SELECT * FROM control_center_invoices ORDER BY posted_at DESC LIMIT lim) i
      JOIN control_center_clients c ON c.tenant_id = i.tenant_id LEFT JOIN users u ON u.id::text = i.actor_id), '[]'::jsonb),
    'payments', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'tenantId', p.tenant_id, 'tradingName', c.trading_name, 'receiptNumber', p.receipt_number,
        'entryKind', p.entry_kind, 'reversesPaymentId', p.reverses_payment_id, 'amountMinor', p.amount_minor, 'currency', p.currency, 'postedAt', p.posted_at,
        'reason', p.reason, 'actor', coalesce(u.display_name, p.actor_id),
        'reversed', EXISTS (SELECT 1 FROM control_center_payments r WHERE r.reverses_payment_id = p.id),
        'allocatedMinor', coalesce((SELECT sum(CASE a.entry_kind WHEN 'posted' THEN a.amount_minor ELSE -a.amount_minor END) FROM control_center_payment_allocations a WHERE a.payment_id = p.id), 0)) ORDER BY p.posted_at DESC)
      FROM (SELECT * FROM control_center_payments ORDER BY posted_at DESC LIMIT lim) p
      JOIN control_center_clients c ON c.tenant_id = p.tenant_id LEFT JOIN users u ON u.id::text = p.actor_id), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION read_control_billing(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_control_billing(integer) TO orvex_control_runtime;

CREATE FUNCTION read_control_audit(p_limit integer DEFAULT 100, p_before timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result jsonb; lim integer := least(greatest(coalesce(p_limit, 100), 1), 500);
BEGIN
  PERFORM control_require_context('platform.audit.view', 'audit.list');
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'operation', a.operation, 'entityType', a.entity_type, 'entityId', a.entity_id,
      'tenantId', a.tenant_id, 'tradingName', c.trading_name, 'actor', coalesce(u.display_name, a.actor_id), 'permission', a.permission,
      'requestId', a.request_id, 'reason', a.reason, 'occurredAt', a.occurred_at) ORDER BY a.occurred_at DESC), '[]'::jsonb)
  INTO result
  FROM (SELECT * FROM control_center_audit_events WHERE p_before IS NULL OR occurred_at < p_before ORDER BY occurred_at DESC LIMIT lim) a
  LEFT JOIN control_center_clients c ON c.tenant_id = a.tenant_id
  LEFT JOIN users u ON u.id::text = a.actor_id;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION read_control_audit(integer, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_control_audit(integer, timestamptz) TO orvex_control_runtime;
