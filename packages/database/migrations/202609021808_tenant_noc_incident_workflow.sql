-- REQ-NOC-001 / REQ-SEC-003: manual incidents are governed evidence, not telemetry.
ALTER TABLE operations_outages
 ADD COLUMN route_id uuid,
 ADD COLUMN severity text NOT NULL DEFAULT 'major' CHECK(severity IN('critical','major','minor','warning')),
 ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0),
 ADD CONSTRAINT outage_tenant_identity UNIQUE(tenant_id,id),
 ADD CONSTRAINT outage_route_tenant FOREIGN KEY(tenant_id,route_id) REFERENCES operations_routes(tenant_id,id);
CREATE TABLE operations_outage_impacts(
 tenant_id uuid NOT NULL,id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 outage_id uuid NOT NULL,service_id uuid NOT NULL,
 FOREIGN KEY(tenant_id,outage_id) REFERENCES operations_outages(tenant_id,id),
 FOREIGN KEY(tenant_id,service_id) REFERENCES operations_services(tenant_id,id),
 UNIQUE(tenant_id,outage_id,service_id));
CREATE TABLE operations_outage_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,
 outage_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),
 status text NOT NULL CHECK(status IN('investigating','identified','monitoring','resolved')),
 reason_en text NOT NULL,reason_ar text NOT NULL,resolution_evidence text,
 actor_id uuid NOT NULL REFERENCES users(id),occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 idempotency_key text NOT NULL,request_payload jsonb NOT NULL,result jsonb NOT NULL,
 FOREIGN KEY(tenant_id,outage_id) REFERENCES operations_outages(tenant_id,id),
 UNIQUE(tenant_id,idempotency_key),UNIQUE(tenant_id,outage_id,version));
CREATE INDEX outage_recent_idx ON operations_outages(tenant_id,started_at DESC,id);
CREATE FUNCTION noc_scope_allows(target_tenant uuid,target_route uuid,target_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c WHERE c.tenant_id=target_tenant
  AND c.support_grant_id IS NULL AND c.permission IN('tenant.network.view','tenant.network.job.create')
  AND CASE WHEN target_route IS NULL THEN operations_scope_allows(target_tenant)
    ELSE operations_scope_allows_route(target_tenant,target_route,target_id) END)
$$;
REVOKE ALL ON FUNCTION noc_scope_allows(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION noc_scope_allows(uuid,uuid,uuid) TO orvex_runtime;
DROP POLICY tenant_isolation_outages ON operations_outages;
CREATE POLICY noc_outage_scope ON operations_outages
 USING(noc_scope_allows(tenant_id,route_id,id)) WITH CHECK(noc_scope_allows(tenant_id,route_id,id));
ALTER TABLE operations_outage_impacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_outage_impacts FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_outage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_outage_events FORCE ROW LEVEL SECURITY;
CREATE POLICY noc_impact_scope ON operations_outage_impacts USING(EXISTS(
 SELECT 1 FROM operations_outages o WHERE o.tenant_id=operations_outage_impacts.tenant_id AND o.id=outage_id))
 WITH CHECK(EXISTS(SELECT 1 FROM operations_outages o WHERE o.tenant_id=operations_outage_impacts.tenant_id AND o.id=outage_id));
CREATE POLICY noc_event_scope ON operations_outage_events USING(EXISTS(
 SELECT 1 FROM operations_outages o WHERE o.tenant_id=operations_outage_events.tenant_id AND o.id=outage_id))
 WITH CHECK(EXISTS(SELECT 1 FROM operations_outages o WHERE o.tenant_id=operations_outage_events.tenant_id AND o.id=outage_id));
REVOKE ALL ON operations_outages,operations_outage_impacts,operations_outage_events FROM PUBLIC,orvex_runtime;
GRANT SELECT ON operations_outages,operations_outage_impacts,operations_outage_events TO orvex_runtime;
CREATE TRIGGER noc_event_immutable BEFORE UPDATE OR DELETE ON operations_outage_events
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER noc_event_no_truncate BEFORE TRUNCATE ON operations_outage_events
 FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER noc_impact_immutable BEFORE UPDATE OR DELETE ON operations_outage_impacts
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER noc_impact_no_truncate BEFORE TRUNCATE ON operations_outage_impacts
 FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER noc_outage_no_delete BEFORE DELETE ON operations_outages
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER noc_outage_no_truncate BEFORE TRUNCATE ON operations_outages
 FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();

CREATE FUNCTION execute_noc_incident(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; o operations_outages%ROWTYPE;
 prior operations_outage_events%ROWTYPE; chosen_route operations_routes%ROWTYPE;
 source_ids uuid[]; eligible integer; affected integer; next_status text; answer jsonb; before_value jsonb;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL OR c.permission<>'tenant.network.job.create'
   OR c.action NOT IN('tenant.noc.incident.create','tenant.noc.incident.transition') THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed NOC mutation authority required'; END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
   OR length(btrim(coalesce(payload->>'reasonEn',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'reasonAr',''))) NOT BETWEEN 8 AND 1000 THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='bilingual incident reasons required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':noc:'||c.idempotency_key,0));
 SELECT * INTO prior FROM operations_outage_events WHERE tenant_id=c.tenant_id AND idempotency_key=c.idempotency_key;
 IF FOUND THEN
   IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text<>c.actor_id
     OR (c.action='tenant.noc.incident.create')<>(prior.version=1) THEN
     RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='NOC retry key belongs to different content'; END IF;
   RETURN prior.result;
 END IF;
 IF c.action='tenant.noc.incident.create' THEN
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
     ('titleEn','titleAr','routeId','severity','serviceIds','reasonEn','reasonAr'))
     OR length(btrim(coalesce(payload->>'titleEn',''))) NOT BETWEEN 3 AND 200
     OR length(btrim(coalesce(payload->>'titleAr',''))) NOT BETWEEN 3 AND 200
     OR coalesce(payload->>'severity','') NOT IN('critical','major','minor','warning')
     OR jsonb_typeof(payload->'serviceIds') IS DISTINCT FROM 'array' THEN
     RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='invalid incident details'; END IF;
   SELECT array_agg(value::uuid) INTO source_ids FROM jsonb_array_elements_text(payload->'serviceIds');
   IF coalesce(cardinality(source_ids),0) NOT BETWEEN 1 AND 200
     OR cardinality(source_ids)<>(SELECT count(DISTINCT x) FROM unnest(source_ids) x) THEN
     RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='select 1 to 200 distinct impacted services'; END IF;
   SELECT * INTO chosen_route FROM operations_routes WHERE tenant_id=c.tenant_id AND id=(payload->>'routeId')::uuid AND active FOR SHARE;
   IF NOT FOUND OR NOT noc_scope_allows(c.tenant_id,chosen_route.id,NULL) THEN
     RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='incident route is outside current scope'; END IF;
   -- Lock selected service identity while recording the impact snapshot.
   PERFORM 1 FROM operations_services s WHERE s.tenant_id=c.tenant_id AND s.id=ANY(source_ids) FOR SHARE;
   SELECT count(*),count(DISTINCT s.subscriber_id) INTO eligible,affected FROM operations_services s
    WHERE s.tenant_id=c.tenant_id AND s.route_id=chosen_route.id AND s.id=ANY(source_ids)
      AND operations_scope_allows(s.tenant_id,s.branch_id,s.area_id,s.route_id,s.id);
   IF eligible<>cardinality(source_ids) THEN
     RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='every affected service must belong to the selected scoped route'; END IF;
   INSERT INTO operations_outages(tenant_id,outage_title_en,outage_title_ar,affected_region,
     impacted_subscribers_count,route_id,severity)
    VALUES(c.tenant_id,payload->>'titleEn',payload->>'titleAr',chosen_route.name_en,
     affected,chosen_route.id,payload->>'severity') RETURNING * INTO o;
   INSERT INTO operations_outage_impacts(tenant_id,outage_id,service_id)
    SELECT c.tenant_id,o.id,x FROM unnest(source_ids) x;
 ELSE
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
     ('outageId','expectedVersion','status','reasonEn','reasonAr','rootCauseEn','rootCauseAr','resolutionEvidence')) THEN
     RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='invalid incident transition fields'; END IF;
   SELECT * INTO o FROM operations_outages WHERE tenant_id=c.tenant_id AND id=(payload->>'outageId')::uuid FOR UPDATE;
   IF NOT FOUND OR o.route_id IS NULL THEN
     RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='scoped managed incident required'; END IF;
   IF o.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN
     RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='incident changed; refresh before acting'; END IF;
   next_status:=payload->>'status';
   IF next_status IS NULL OR NOT(
     (o.status='investigating' AND next_status='identified') OR
     (o.status='identified' AND next_status='monitoring') OR
     (o.status='monitoring' AND next_status IN('resolved','investigating')) OR
     (o.status='resolved' AND next_status='investigating')) THEN
     RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='invalid incident status transition'; END IF;
   IF next_status='resolved' AND (
     length(btrim(coalesce(payload->>'rootCauseEn',''))) NOT BETWEEN 8 AND 1000 OR
     length(btrim(coalesce(payload->>'rootCauseAr',''))) NOT BETWEEN 8 AND 1000 OR
     length(btrim(coalesce(payload->>'resolutionEvidence',''))) NOT BETWEEN 8 AND 1000) THEN
     RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='resolution requires bilingual root cause and verification evidence'; END IF;
   IF next_status<>'resolved' AND (payload ? 'rootCauseEn' OR payload ? 'rootCauseAr' OR payload ? 'resolutionEvidence') THEN
     RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='resolution fields require resolved status'; END IF;
   before_value:=to_jsonb(o);
   UPDATE operations_outages SET status=next_status,version=version+1,
     resolved_at=CASE WHEN next_status='resolved' THEN clock_timestamp() END,
     root_cause_en=CASE WHEN next_status='resolved' THEN payload->>'rootCauseEn' END,
     root_cause_ar=CASE WHEN next_status='resolved' THEN payload->>'rootCauseAr' END
    WHERE tenant_id=c.tenant_id AND id=o.id RETURNING * INTO o;
 END IF;
 answer:=jsonb_build_object('id',o.id,'status',o.status,'version',o.version,'impactedSubscribersCount',o.impacted_subscribers_count);
 INSERT INTO operations_outage_events(tenant_id,outage_id,version,status,reason_en,reason_ar,
   resolution_evidence,actor_id,idempotency_key,request_payload,result)
 VALUES(c.tenant_id,o.id,o.version,o.status,payload->>'reasonEn',payload->>'reasonAr',
   payload->>'resolutionEvidence',c.actor_id::uuid,c.idempotency_key,payload,answer);
 INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,
   permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
 VALUES(c.tenant_id,c.action,'operations_outages',o.id::text,c.actor_id,c.session_id,c.permission,
   c.request_id,c.idempotency_key,c.ip_address,c.user_agent,'allowed',c.reason,before_value,to_jsonb(o));
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION execute_noc_incident(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_noc_incident(jsonb) TO orvex_runtime;
