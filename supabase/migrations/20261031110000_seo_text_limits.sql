-- Length limits on the SEO settings (website_settings key 'seo'), which had
-- none besides the 64 KB size of the row. The dashboard SEO form now counts
-- characters and stops at 60 (title) / 160 (description), what search engines
-- show; the database accepts a little more (the former form limits) so that
-- every existing row stays valid. Checked read-only before writing this:
-- the longest title is 64, the longest description 250, 9 keywords.
--
-- Added NOT VALID then validated (additive, no data change).

alter table public.website_settings add constraint website_settings_seo_len_check check (
  key <> 'seo' or (
    char_length(coalesce(value ->> 'title', '')) <= 70
    and char_length(coalesce(value ->> 'description', '')) <= 320
    and char_length(coalesce(value ->> 'business_name', '')) <= 120
    and char_length(coalesce(value ->> 'google_site_verification', '')) <= 100
    and char_length(coalesce(value ->> 'image', '')) <= 2048
    and (jsonb_typeof(value -> 'keywords') is distinct from 'array'
         or jsonb_array_length(value -> 'keywords') <= 20)
  )
) not valid;
alter table public.website_settings validate constraint website_settings_seo_len_check;
