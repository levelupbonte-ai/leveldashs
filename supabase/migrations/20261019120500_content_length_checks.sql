-- Length / format CHECK constraints on the tables editors and public functions
-- write to (security hardening). They mirror the dashboard editor limits
-- (features/site/config/collections.ts) with a small margin, so normal edits are
-- unaffected; a direct API write that bypasses the forms is refused by the
-- database itself. Links that a website renders must be http(s) or a same-site
-- path (no javascript:, data:, ...).

alter table public.announcements
  add constraint announcements_content_len_check check (content is null or char_length(content) <= 20000),
  add constraint announcements_image_url_check check (
    image_url is null or (char_length(image_url) <= 2048 and image_url ~* '^(https?://|/)[^[:space:]<>"]*$'));

alter table public.services
  add constraint services_text_len_check check (
    (category is null or char_length(category) <= 80)
    and (description is null or char_length(description) <= 4000)
    and (price_label is null or char_length(price_label) <= 80)
    and (duration_label is null or char_length(duration_label) <= 80)
    and (badge is null or char_length(badge) <= 80)),
  add constraint services_inclusions_len_check check (
    inclusions is null or (cardinality(inclusions) <= 30 and char_length(array_to_string(inclusions, '')) <= 3000)),
  add constraint services_image_url_check check (
    image_url is null or (char_length(image_url) <= 2048 and image_url ~* '^(https?://|/)[^[:space:]<>"]*$')),
  add constraint services_data_size_check check (pg_column_size(data) <= 16384);

alter table public.team_members
  add constraint team_members_text_len_check check (
    (role is null or char_length(role) <= 120)
    and (bio is null or char_length(bio) <= 4000)
    and (phone is null or char_length(phone) <= 40)
    and (email is null or char_length(email) <= 254)),
  add constraint team_members_tags_len_check check (
    tags is null or (cardinality(tags) <= 30 and char_length(array_to_string(tags, '')) <= 3000)),
  add constraint team_members_image_url_check check (
    image_url is null or (char_length(image_url) <= 2048 and image_url ~* '^(https?://|/)[^[:space:]<>"]*$')),
  add constraint team_members_data_size_check check (pg_column_size(data) <= 16384);

alter table public.gallery_items
  add constraint gallery_items_text_len_check check (
    (description is null or char_length(description) <= 2000)
    and (category is null or char_length(category) <= 80)
    and (audience is null or char_length(audience) <= 80)),
  add constraint gallery_items_tags_len_check check (
    tags is null or (cardinality(tags) <= 30 and char_length(array_to_string(tags, '')) <= 3000)),
  add constraint gallery_items_image_url_check check (
    image_url is null or (char_length(image_url) <= 2048 and image_url ~* '^(https?://|/)[^[:space:]<>"]*$'));

alter table public.faq_items
  add constraint faq_items_category_len_check check (category is null or char_length(category) <= 80);

alter table public.reviews
  add constraint reviews_source_len_check check (source is null or char_length(source) <= 80),
  add constraint reviews_data_size_check check (pg_column_size(data) <= 16384);

alter table public.website_settings
  add constraint website_settings_value_size_check check (pg_column_size(value) <= 65536);

alter table public.content_blocks
  add constraint content_blocks_data_size_check check (pg_column_size(data) <= 65536);

alter table public.appointments
  add constraint appointments_staff_notes_len_check check (staff_notes is null or char_length(staff_notes) <= 4000),
  add constraint appointments_source_len_check check (source is null or char_length(source) <= 80);

alter table public.form_submissions
  add constraint form_submissions_staff_notes_len_check check (staff_notes is null or char_length(staff_notes) <= 4000),
  add constraint form_submissions_source_len_check check (source is null or char_length(source) <= 200);

alter table public.project_requests
  add constraint project_requests_text_len_check check (
    char_length(coalesce(name, '')) <= 120
    and char_length(coalesce(email, '')) <= 254
    and char_length(coalesce(phone, '')) <= 40
    and char_length(coalesce(business_name, '')) <= 160
    and char_length(coalesce(business_stage, '')) <= 80
    and char_length(coalesce(sector, '')) <= 120
    and char_length(coalesce(business_age, '')) <= 60
    and char_length(coalesce(website, '')) <= 300
    and char_length(coalesce(registration_number, '')) <= 40
    and char_length(coalesce(budget, '')) <= 60
    and char_length(coalesce(timeline, '')) <= 60
    and char_length(coalesce(project_type, '')) <= 120
    and char_length(coalesce(ai_summary, '')) <= 600
    and char_length(coalesce(ai_model, '')) <= 80
    and char_length(coalesce(notes, '')) <= 4000),
  add constraint project_requests_links_len_check check (
    cardinality(coalesce(social_links, '{}')) <= 8 and cardinality(coalesce(proof_links, '{}')) <= 8),
  add constraint project_requests_brief_size_check check (brief is null or pg_column_size(brief) <= 49152);
