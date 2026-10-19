-- TRUNCATE, REFERENCES and TRIGGER are never needed by the API roles
-- (TRUNCATE is not covered by row level security at all).
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
