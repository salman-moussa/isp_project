-- orvex:database=tenant
-- Token authentication must locate a device before a signed Operations context exists. The
-- SECURITY DEFINER authentication/rotation functions are the owner-mediated boundary; the
-- NOLOGIN owner may bypass this one table's RLS while the NOINHERIT/NOBYPASSRLS runtime remains
-- governed by collect_devices_context for every direct read/write.
ALTER TABLE public.collect_devices NO FORCE ROW LEVEL SECURITY;
