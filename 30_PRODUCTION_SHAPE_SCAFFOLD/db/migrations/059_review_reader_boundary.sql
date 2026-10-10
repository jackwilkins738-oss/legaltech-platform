BEGIN;
-- V134: a reader is never a decision author, outbox writer or machine-result writer.
CREATE ROLE legaltech_review_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO legaltech_review_reader;
GRANT SELECT(id,status) ON public.tenants TO legaltech_review_reader;
GRANT SELECT(id,tenant_id,actor_type,status) ON public.actors TO legaltech_review_reader;
GRANT SELECT(id,tenant_id,event_type,status) ON public.inbound_events TO legaltech_review_reader;
GRANT SELECT(tenant_id,job_id,kind,object_id,result_hash,result_code,artifact_hash) ON public.domain_job_results TO legaltech_review_reader;
GRANT SELECT(tenant_id,event_id,result_job_id,result_hash,decision,matter_id,writeback_job_id) ON public.domain_review_decisions TO legaltech_review_reader;
CREATE POLICY domain_result_human_read ON public.domain_job_results FOR SELECT TO legaltech_review_reader USING(tenant_id=public.app_current_tenant_id());
CREATE POLICY domain_decision_human_read ON public.domain_review_decisions FOR SELECT TO legaltech_review_reader USING(tenant_id=public.app_current_tenant_id());
COMMIT;
