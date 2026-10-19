-- The old "Public submit" INSERT policies on bookings / leads have had no INSERT
-- grant since close_legacy_public_inserts; they now also refuse every row, so a
-- future grant cannot reopen these legacy tables.
alter policy "Public submit bookings" on public.bookings with check (false);
alter policy "Public submit leads" on public.leads with check (false);
