-- 202609090500_tenant_analytics.sql
-- Live operations dashboard and governed report datasets. Every number is computed at read time
-- from the tenant's own records under the signed request context (scope applied through the
-- standard row policies); nothing here is a projection or a demonstration figure.

CREATE FUNCTION analytics_context_or_raise(p_action text, p_permissions text[]) RETURNS operations_request_contexts
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM operations_current_context();
  IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL OR c.action <> p_action OR NOT (c.permission = ANY(p_permissions)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'signed analytics authority required';
  END IF;
  PERFORM set_config('app.tenant_id', c.tenant_id::text, true);
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION analytics_context_or_raise(text, text[]) FROM PUBLIC;

-- Today's operating picture: collections by channel, unpaid invoices, live sessions, failed work.
CREATE FUNCTION read_dashboard_snapshot() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE; day_start timestamptz; result jsonb;
BEGIN
  c := analytics_context_or_raise('tenant.dashboard.read', ARRAY['tenant.dashboard.view']);
  day_start := date_trunc('day', clock_timestamp() AT TIME ZONE 'Asia/Beirut') AT TIME ZONE 'Asia/Beirut';
  WITH payments AS (
    SELECT p.id, p.receipt_number, p.amount_minor, p.currency::text AS currency, p.posted_at,
      CASE WHEN ce.id IS NOT NULL THEN 'collector' WHEN opr.id IS NOT NULL THEN 'office' ELSE 'other' END AS channel,
      coalesce(s.display_name, s2.display_name) AS subscriber_name
    FROM finance_payments p
    JOIN finance_document_guards g ON g.tenant_id = p.tenant_id AND g.document_type = 'payment' AND g.document_id = p.id
    LEFT JOIN operations_collector_collection_evidence ce ON ce.tenant_id = p.tenant_id AND ce.finance_payment_id = p.id
    LEFT JOIN operations_office_payment_requests opr ON opr.tenant_id = p.tenant_id AND opr.finance_payment_id = p.id
    LEFT JOIN operations_subscribers s ON s.tenant_id = opr.tenant_id AND s.id = opr.subscriber_id
    LEFT JOIN operations_collector_assignments ca ON ca.tenant_id = ce.tenant_id AND ca.id = ce.assignment_id
    LEFT JOIN operations_subscribers s2 ON s2.tenant_id = ca.tenant_id AND s2.id = ca.subscriber_id
    WHERE p.tenant_id = c.tenant_id AND p.entry_kind = 'posted' AND g.reversed_at IS NULL AND p.posted_at >= day_start
  ), unpaid AS (
    SELECT i.id, i.document_number, i.currency::text AS currency, i.posted_at,
      i.amount_minor - g.allocated_minor - g.credited_minor AS remaining, s.display_name AS subscriber_name
    FROM finance_invoices i
    JOIN finance_document_guards g ON g.tenant_id = i.tenant_id AND g.document_type = 'invoice' AND g.document_id = i.id
    LEFT JOIN operations_invoice_preparations ip ON ip.tenant_id = i.tenant_id AND ip.finance_invoice_id = i.id
    LEFT JOIN operations_services sv ON sv.tenant_id = ip.tenant_id AND sv.id = ip.service_id
    LEFT JOIN operations_subscribers s ON s.tenant_id = sv.tenant_id AND s.id = sv.subscriber_id
    WHERE i.tenant_id = c.tenant_id AND i.entry_kind = 'posted' AND g.reversed_at IS NULL
      AND i.amount_minor - g.allocated_minor - g.credited_minor > 0
  ), failed_jobs AS (
    SELECT 'network' AS kind, j.job_id AS reference, j.state AS detail, j.created_at AS at
    FROM network_worker.jobs j WHERE j.tenant_id = c.tenant_id AND j.state IN ('failed', 'dead_lettered')
    UNION ALL
    SELECT 'notification', n.template_key, coalesce(n.last_error, 'failed'), n.created_at
    FROM operations_notification_outbox n WHERE n.tenant_id = c.tenant_id AND n.status = 'failed'
    UNION ALL
    SELECT 'billing', r.idempotency_key, coalesce(r.error_summary, 'failed'), r.requested_at
    FROM operations_billing_runs r WHERE r.tenant_id = c.tenant_id AND r.status = 'failed'
    UNION ALL
    SELECT 'alarm', a.device_name || ' · ' || a.alarm_code, a.message_en, a.raised_at
    FROM operations_network_alarms a WHERE a.tenant_id = c.tenant_id AND a.status = 'active' AND a.severity = 'critical'
  )
  SELECT jsonb_build_object(
    'asOf', clock_timestamp(),
    'collections', jsonb_build_object(
      'usdMinor', coalesce((SELECT sum(amount_minor) FROM payments WHERE currency = 'USD'), 0),
      'lbpMinor', coalesce((SELECT sum(amount_minor) FROM payments WHERE currency = 'LBP'), 0),
      'receipts', (SELECT count(*) FROM payments),
      'byChannel', coalesce((SELECT jsonb_agg(jsonb_build_object('channel', channel, 'currency', currency, 'amountMinor', total, 'receipts', receipts))
        FROM (SELECT channel, currency, sum(amount_minor) AS total, count(*) AS receipts FROM payments GROUP BY channel, currency ORDER BY channel, currency) x), '[]'::jsonb),
      'recent', coalesce((SELECT jsonb_agg(jsonb_build_object('receiptNumber', receipt_number, 'currency', currency, 'amountMinor', amount_minor,
        'channel', channel, 'subscriberName', subscriber_name, 'postedAt', posted_at) ORDER BY posted_at DESC)
        FROM (SELECT * FROM payments ORDER BY posted_at DESC LIMIT 8) y), '[]'::jsonb)),
    'receivables', jsonb_build_object(
      'unpaidInvoices', (SELECT count(*) FROM unpaid),
      'overdue30', (SELECT count(*) FROM unpaid WHERE posted_at < clock_timestamp() - interval '30 days'),
      'usdMinor', coalesce((SELECT sum(remaining) FROM unpaid WHERE currency = 'USD'), 0),
      'lbpMinor', coalesce((SELECT sum(remaining) FROM unpaid WHERE currency = 'LBP'), 0),
      'oldest', coalesce((SELECT jsonb_agg(jsonb_build_object('documentNumber', document_number, 'currency', currency, 'remainingMinor', remaining,
        'subscriberName', subscriber_name, 'postedAt', posted_at) ORDER BY posted_at)
        FROM (SELECT * FROM unpaid ORDER BY posted_at LIMIT 8) z), '[]'::jsonb)),
    'services', jsonb_build_object(
      'active', (SELECT count(*) FROM operations_services s WHERE s.tenant_id = c.tenant_id AND s.status = 'active'),
      'suspended', (SELECT count(*) FROM operations_services s WHERE s.tenant_id = c.tenant_id AND s.status = 'suspended'),
      'pendingInstallation', (SELECT count(*) FROM operations_services s WHERE s.tenant_id = c.tenant_id AND s.status = 'pending_installation'),
      'liveSessions', (SELECT count(*) FROM operations_radius_sessions r WHERE r.tenant_id = c.tenant_id AND r.stopped_at IS NULL),
      'byNas', coalesce((SELECT jsonb_agg(jsonb_build_object('nasName', n.nas_name, 'sessions', cnt) ORDER BY cnt DESC)
        FROM (SELECT r.nas_id, count(*) AS cnt FROM operations_radius_sessions r WHERE r.tenant_id = c.tenant_id AND r.stopped_at IS NULL GROUP BY r.nas_id) q
        JOIN operations_nas_clients n ON n.tenant_id = c.tenant_id AND n.id = q.nas_id), '[]'::jsonb)),
    'work', jsonb_build_object(
      'failedJobs', (SELECT count(*) FROM failed_jobs),
      'openTickets', (SELECT count(*) FROM operations_support_issues i WHERE i.tenant_id = c.tenant_id AND i.status NOT IN ('resolved', 'closed')),
      'ticketsOverdue', (SELECT count(*) FROM operations_support_issues i WHERE i.tenant_id = c.tenant_id AND i.status NOT IN ('resolved', 'closed') AND i.sla_resolve_due_at < clock_timestamp()),
      'openIncidents', (SELECT count(*) FROM operations_outages o WHERE o.tenant_id = c.tenant_id AND o.status <> 'resolved'),
      'workOrdersToday', (SELECT count(*) FROM operations_work_orders w WHERE w.tenant_id = c.tenant_id AND w.window_start >= day_start AND w.window_start < day_start + interval '1 day'),
      'failed', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', kind, 'reference', reference, 'detail', detail, 'at', at) ORDER BY at DESC)
        FROM (SELECT * FROM failed_jobs ORDER BY at DESC LIMIT 8) f), '[]'::jsonb)),
    'activity', coalesce((SELECT jsonb_agg(jsonb_build_object('action', a.action, 'resourceType', a.resource_type, 'actor', coalesce(u.display_name, a.actor_id),
        'at', a.occurred_at, 'result', a.result) ORDER BY a.occurred_at DESC)
      FROM (SELECT * FROM operations_audit_outbox o WHERE o.tenant_id = c.tenant_id ORDER BY o.occurred_at DESC LIMIT 12) a
      LEFT JOIN users u ON u.id::text = a.actor_id), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION read_dashboard_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_dashboard_snapshot() TO orvex_runtime;

-- Governed report datasets. Each key returns an array of flat rows; filters are optional and
-- validated per report. Currencies are never combined: money rows always carry their currency.
CREATE FUNCTION read_report_dataset(p_key text, p_filters jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE; rows jsonb; v_from date; v_to date; today date;
BEGIN
  c := analytics_context_or_raise('tenant.report.read', ARRAY['tenant.report.view', 'tenant.report.export']);
  today := (clock_timestamp() AT TIME ZONE 'Asia/Beirut')::date;
  v_from := coalesce(nullif(p_filters->>'from', '')::date, today - 30);
  v_to := coalesce(nullif(p_filters->>'to', '')::date, today);
  IF v_to < v_from OR v_to - v_from > 366 THEN
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'the report window must be at most one year and end after it starts';
  END IF;
  IF p_key = 'ar_aging' THEN
    SELECT jsonb_agg(row_value ORDER BY (row_value->>'currency'), (row_value->>'bucketOrder')::int) INTO rows FROM (
      SELECT jsonb_build_object('currency', currency, 'bucket', bucket, 'bucketOrder', bucket_order, 'invoices', count(*), 'remainingMinor', sum(remaining)) AS row_value
      FROM (SELECT i.currency::text AS currency, i.amount_minor - g.allocated_minor - g.credited_minor AS remaining,
          CASE WHEN i.posted_at >= clock_timestamp() - interval '30 days' THEN '0-30' WHEN i.posted_at >= clock_timestamp() - interval '60 days' THEN '31-60'
            WHEN i.posted_at >= clock_timestamp() - interval '90 days' THEN '61-90' ELSE '90+' END AS bucket,
          CASE WHEN i.posted_at >= clock_timestamp() - interval '30 days' THEN 1 WHEN i.posted_at >= clock_timestamp() - interval '60 days' THEN 2
            WHEN i.posted_at >= clock_timestamp() - interval '90 days' THEN 3 ELSE 4 END AS bucket_order
        FROM finance_invoices i JOIN finance_document_guards g ON g.tenant_id = i.tenant_id AND g.document_type = 'invoice' AND g.document_id = i.id
        WHERE i.tenant_id = c.tenant_id AND i.entry_kind = 'posted' AND g.reversed_at IS NULL AND i.amount_minor - g.allocated_minor - g.credited_minor > 0) x
      GROUP BY currency, bucket, bucket_order) y;
  ELSIF p_key = 'collections_daily' THEN
    SELECT jsonb_agg(row_value ORDER BY (row_value->>'day'), (row_value->>'currency'), (row_value->>'channel')) INTO rows FROM (
      SELECT jsonb_build_object('day', day, 'currency', currency, 'channel', channel, 'receipts', count(*), 'amountMinor', sum(amount_minor)) AS row_value
      FROM (SELECT (p.posted_at AT TIME ZONE 'Asia/Beirut')::date AS day, p.currency::text AS currency, p.amount_minor,
          CASE WHEN ce.id IS NOT NULL THEN 'collector' WHEN opr.id IS NOT NULL THEN 'office' ELSE 'other' END AS channel
        FROM finance_payments p JOIN finance_document_guards g ON g.tenant_id = p.tenant_id AND g.document_type = 'payment' AND g.document_id = p.id
        LEFT JOIN operations_collector_collection_evidence ce ON ce.tenant_id = p.tenant_id AND ce.finance_payment_id = p.id
        LEFT JOIN operations_office_payment_requests opr ON opr.tenant_id = p.tenant_id AND opr.finance_payment_id = p.id
        WHERE p.tenant_id = c.tenant_id AND p.entry_kind = 'posted' AND g.reversed_at IS NULL
          AND (p.posted_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to) x
      GROUP BY day, currency, channel) y;
  ELSIF p_key = 'subscriber_status' THEN
    SELECT jsonb_agg(row_value ORDER BY (row_value->>'branch'), (row_value->>'status')) INTO rows FROM (
      SELECT jsonb_build_object('branch', b.name_en, 'branchAr', b.name_ar, 'status', s.status::text, 'subscribers', count(*)) AS row_value
      FROM operations_subscribers s LEFT JOIN operations_branches b ON b.tenant_id = s.tenant_id AND b.id = s.branch_id
      WHERE s.tenant_id = c.tenant_id GROUP BY b.name_en, b.name_ar, s.status) y;
  ELSIF p_key = 'plan_mix' THEN
    SELECT jsonb_agg(row_value ORDER BY (row_value->>'services')::int DESC) INTO rows FROM (
      SELECT jsonb_build_object('planCode', p.code, 'planNameEn', p.name_en, 'planNameAr', p.name_ar, 'currency', p.currency::text,
        'recurringMinor', p.recurring_amount_minor, 'services', count(s.id), 'monthlyMinor', count(s.id) * p.recurring_amount_minor) AS row_value
      FROM operations_plans p LEFT JOIN operations_services s ON s.tenant_id = p.tenant_id AND s.plan_id = p.id AND s.status = 'active'
      WHERE p.tenant_id = c.tenant_id GROUP BY p.id, p.code, p.name_en, p.name_ar, p.currency, p.recurring_amount_minor) y;
  ELSIF p_key = 'ticket_sla' THEN
    SELECT jsonb_agg(row_value ORDER BY (row_value->>'priority')) INTO rows FROM (
      SELECT jsonb_build_object('priority', i.priority, 'tickets', count(*),
        'resolved', count(*) FILTER (WHERE i.status IN ('resolved', 'closed')),
        'respondedInTime', count(*) FILTER (WHERE i.first_response_at IS NOT NULL AND i.first_response_at <= i.sla_respond_due_at),
        'resolvedInTime', count(*) FILTER (WHERE i.closed_at IS NOT NULL AND i.closed_at <= i.sla_resolve_due_at),
        'reopened', count(*) FILTER (WHERE i.reopen_count > 0),
        'escalated', count(*) FILTER (WHERE i.escalated_at IS NOT NULL)) AS row_value
      FROM operations_support_issues i WHERE i.tenant_id = c.tenant_id AND (i.created_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to
      GROUP BY i.priority) y;
  ELSIF p_key = 'incidents' THEN
    SELECT jsonb_agg(row_value ORDER BY (row_value->>'startedAt') DESC) INTO rows FROM (
      SELECT jsonb_build_object('titleEn', o.outage_title_en, 'titleAr', o.outage_title_ar, 'severity', o.severity, 'status', o.status,
        'affectedRegion', o.affected_region, 'impactedSubscribers', o.impacted_subscribers_count, 'startedAt', o.started_at, 'resolvedAt', o.resolved_at,
        'minutesToResolve', CASE WHEN o.resolved_at IS NULL THEN NULL ELSE round(extract(epoch FROM (o.resolved_at - o.started_at)) / 60) END,
        'slaMinutes', noc_sla_minutes(o.severity)) AS row_value
      FROM operations_outages o WHERE o.tenant_id = c.tenant_id AND (o.started_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to) y;
  ELSIF p_key = 'dealer_float' THEN
    SELECT jsonb_agg(row_value ORDER BY (row_value->>'dealerCode'), (row_value->>'currency')) INTO rows FROM (
      SELECT jsonb_build_object('dealerCode', d.dealer_code, 'dealerName', d.dealer_name, 'status', d.status, 'currency', cur.currency,
        'balanceMinor', dealer_balance_minor(d.tenant_id, d.id, cur.currency),
        'creditLimitMinor', CASE cur.currency WHEN 'USD' THEN d.credit_limit_minor_usd ELSE d.credit_limit_minor_lbp END,
        'vouchersInField', (SELECT count(*) FROM operations_vouchers v JOIN operations_voucher_batches vb ON vb.tenant_id = v.tenant_id AND vb.id = v.batch_id
          WHERE vb.tenant_id = d.tenant_id AND vb.dealer_id = d.id AND vb.currency = cur.currency AND v.status = 'issued')) AS row_value
      FROM operations_dealers d CROSS JOIN (VALUES ('USD'), ('LBP')) AS cur(currency) WHERE d.tenant_id = c.tenant_id) y;
  ELSIF p_key = 'assurance_exposure' THEN
    SELECT jsonb_agg(row_value ORDER BY (row_value->>'controlCode'), (row_value->>'currency')) INTO rows FROM (
      SELECT jsonb_build_object('controlCode', f.control_code, 'currency', f.currency, 'status', f.status, 'findings', count(*), 'exposureMinor', sum(f.exposure_minor)) AS row_value
      FROM operations_assurance_findings f WHERE f.tenant_id = c.tenant_id AND f.status IN ('open', 'acknowledged')
      GROUP BY f.control_code, f.currency, f.status) y;
  ELSIF p_key = 'notification_delivery' THEN
    SELECT jsonb_agg(row_value ORDER BY (row_value->>'day'), (row_value->>'channel'), (row_value->>'status')) INTO rows FROM (
      SELECT jsonb_build_object('day', (n.created_at AT TIME ZONE 'Asia/Beirut')::date, 'channel', n.channel, 'status', n.status, 'messages', count(*)) AS row_value
      FROM operations_notification_outbox n WHERE n.tenant_id = c.tenant_id AND (n.created_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to
      GROUP BY 1, 2, 3) y;
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'unknown report';
  END IF;
  RETURN jsonb_build_object('key', p_key, 'from', v_from, 'to', v_to, 'generatedAt', clock_timestamp(), 'rows', coalesce(rows, '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION read_report_dataset(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_report_dataset(text, jsonb) TO orvex_runtime;

-- A completed export is recorded as a succeeded job with the row count, so the export history
-- is real evidence of what left the system, not a queue nobody drains.
CREATE FUNCTION record_report_export(p_key text, p_filters jsonb, p_format text, p_rows integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE; job operations_export_jobs%ROWTYPE;
BEGIN
  SELECT * INTO c FROM operations_current_context();
  IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL OR c.action <> 'tenant.report.export' OR c.permission <> 'tenant.report.export' THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'signed report export authority required';
  END IF;
  SELECT * INTO job FROM operations_export_jobs WHERE tenant_id = c.tenant_id AND idempotency_key = c.idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('jobId', job.id, 'status', job.status, 'replayed', true);
  END IF;
  INSERT INTO operations_export_jobs(tenant_id, report_key, filters, format, status, storage_reference, idempotency_key, requested_by,
    scope_branch_ids, scope_area_ids, scope_route_ids, scope_record_ids, completed_at)
  VALUES (c.tenant_id, p_key, coalesce(p_filters, '{}'::jsonb), p_format, 'succeeded', 'inline:' || p_rows::text || ' rows', c.idempotency_key,
    c.actor_id, c.branch_ids, c.area_ids, c.route_ids, c.record_ids, clock_timestamp())
  RETURNING * INTO job;
  -- The export job table carries the operations audit trigger, so the insert above is already audited.
  RETURN jsonb_build_object('jobId', job.id, 'status', job.status, 'rows', p_rows);
END $$;
REVOKE ALL ON FUNCTION record_report_export(text, jsonb, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_report_export(text, jsonb, text, integer) TO orvex_runtime;
