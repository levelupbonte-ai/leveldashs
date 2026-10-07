-- Phase 0 — security hardening.
--
-- public.rls_auto_enable() is the event-trigger function that turns RLS on for
-- every new table in public. It is SECURITY DEFINER and lives in an exposed
-- schema, so anon/authenticated could reach it via /rest/v1/rpc (Supabase
-- advisor lints 0028/0029). Move it to a non-exposed schema and revoke EXECUTE.
-- The event trigger references the function by OID, so it keeps firing.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

ALTER FUNCTION public.rls_auto_enable() SET SCHEMA private;
REVOKE EXECUTE ON FUNCTION private.rls_auto_enable() FROM PUBLIC, anon, authenticated;
