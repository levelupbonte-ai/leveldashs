-- AI catalog: the showcase's project request screening (task 'qualify').
insert into public.ai_routes (app, task, position, model_id, description) values
  ('showcase', 'qualify', 1, 'groq:openai/gpt-oss-20b', 'levelup-ecosystem.com — analyse du sérieux des demandes de projet (note et verdict)'),
  ('showcase', 'qualify', 2, 'cerebras:gpt-oss-120b', 'levelup-ecosystem.com — analyse du sérieux des demandes de projet (note et verdict)'),
  ('showcase', 'qualify', 3, 'gemini:gemini-3.1-flash-lite', 'levelup-ecosystem.com — analyse du sérieux des demandes de projet (note et verdict)'),
  ('showcase', 'qualify', 4, 'mistral:mistral-small-latest', 'levelup-ecosystem.com — analyse du sérieux des demandes de projet (note et verdict)')
on conflict (app, task, position) do update set
  model_id = excluded.model_id,
  description = excluded.description;

update public.ai_models m set
  apps = coalesce((select array_agg(distinct r.app order by r.app) from public.ai_routes r where r.model_id = m.id), '{}'),
  tasks = coalesce((select array_agg(distinct r.task order by r.task) from public.ai_routes r where r.model_id = m.id), '{}'),
  updated_at = now();
