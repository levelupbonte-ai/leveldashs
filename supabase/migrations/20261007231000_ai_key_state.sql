-- Shared health of AI provider keys across all server instances (LevelStudio,
-- agents, dashboard). Keys themselves are NEVER stored: only the first 16 hex
-- characters of their SHA-256. Service role only.
CREATE TABLE IF NOT EXISTS public.ai_key_state (
  provider text NOT NULL DEFAULT 'gemini' CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{16}$'),
  pool text NOT NULL CHECK (pool ~ '^[a-z][a-z0-9_]{1,31}$'),
  cooldown_until timestamptz,
  exhausted_until timestamptz,
  invalid boolean NOT NULL DEFAULT false,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  success_count bigint NOT NULL DEFAULT 0,
  failure_count bigint NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, fingerprint)
);

ALTER TABLE public.ai_key_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_key_state FROM anon, authenticated;

COMMENT ON TABLE public.ai_key_state IS
  'AI key rotation state shared by LevelUp servers (service role only). Fingerprints, never keys.';

-- Atomic report from a server after each call.
CREATE OR REPLACE FUNCTION public.ai_key_report(
  p_provider text,
  p_fingerprint text,
  p_pool text,
  p_success boolean,
  p_cooldown_seconds integer DEFAULT NULL,
  p_exhausted_until timestamptz DEFAULT NULL,
  p_invalid boolean DEFAULT false,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.ai_key_state AS s
    (provider, fingerprint, pool, cooldown_until, exhausted_until, invalid, last_error,
     success_count, failure_count, last_used_at, updated_at)
  VALUES (
    p_provider, p_fingerprint, p_pool,
    CASE WHEN p_success THEN NULL ELSE now() + make_interval(secs => coalesce(p_cooldown_seconds, 0)) END,
    CASE WHEN p_success THEN NULL ELSE p_exhausted_until END,
    coalesce(p_invalid, false),
    CASE WHEN p_success THEN NULL ELSE left(p_error, 300) END,
    CASE WHEN p_success THEN 1 ELSE 0 END,
    CASE WHEN p_success THEN 0 ELSE 1 END,
    now(), now()
  )
  ON CONFLICT (provider, fingerprint) DO UPDATE SET
    pool = EXCLUDED.pool,
    cooldown_until = CASE WHEN p_success THEN NULL
                          ELSE greatest(coalesce(s.cooldown_until, now()), EXCLUDED.cooldown_until) END,
    exhausted_until = CASE WHEN p_success THEN NULL
                           ELSE coalesce(EXCLUDED.exhausted_until, s.exhausted_until) END,
    invalid = CASE WHEN p_success THEN false ELSE s.invalid OR EXCLUDED.invalid END,
    last_error = EXCLUDED.last_error,
    success_count = s.success_count + EXCLUDED.success_count,
    failure_count = s.failure_count + EXCLUDED.failure_count,
    last_used_at = now(),
    updated_at = now();
$$;

REVOKE EXECUTE ON FUNCTION public.ai_key_report(text, text, text, boolean, integer, timestamptz, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_key_report(text, text, text, boolean, integer, timestamptz, boolean, text)
  TO service_role;
GRANT SELECT ON public.ai_key_state TO service_role;
