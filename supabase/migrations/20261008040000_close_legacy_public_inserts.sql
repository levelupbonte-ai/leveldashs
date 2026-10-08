-- Legacy tables replaced by form_submissions / appointments (rate-limited RPCs).
-- Their "Public submit" policies allowed unlimited anonymous inserts.
REVOKE INSERT, UPDATE, DELETE ON public.leads, public.bookings FROM anon, authenticated;
