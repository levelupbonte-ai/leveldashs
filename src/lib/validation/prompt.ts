import { cleanMultiline } from './sanitize';

/**
 * Prompt-injection defences for the dashboard assistant (see docs/security.md).
 * The model can still be talked into things; these helpers make sure that what
 * people type stays data, that hidden or role-spoofing text is removed, and
 * that a reply never carries a key or our instructions back to the browser.
 */

// Chat-template control tokens and fake role headers that try to open a new
// "system" turn inside a user message.
const ROLE_MARKERS = [
  /<\|[^|>\n]{0,40}\|>/g, // <|im_start|>, <|system|>, <|endoftext|>
  /<｜[^｜>\n]{0,40}｜>/g,
  /\[\/?(?:INST|SYS|SYSTEM)\]/gi,
  /<<\/?SYS>>/gi,
  /<\/?(?:start_of_turn|end_of_turn|system|assistant|tool|developer)>/gi,
  /^\s*#{1,6}\s*(?:system|developer|assistant)\s*(?:prompt|message)?\s*:?\s*$/gim,
  /^\s*(?:system|developer)\s*:/gim
];

/** A user message for the model: cleaned, bounded, role markers neutralised. */
export function cleanPromptInput(value: string, max = 4000): string {
  let text = cleanMultiline(value);
  for (const marker of ROLE_MARKERS) text = text.replace(marker, ' ');
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

const INJECTION_HINTS = [
  /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|your|the)\b[^.\n]{0,20}\b(?:instructions?|rules?|prompts?|directives?|guidelines?)/i,
  /\b(?:reveal|show|print|repeat|output|display|leak|tell me)\b[^.\n]{0,40}\b(?:system|hidden|initial|original|developer)\b[^.\n]{0,15}\b(?:prompt|instructions?|message|rules?)/i,
  /\b(?:api|secret|private|service[ -]?role)[ -]?(?:keys?|tokens?)\b/i,
  /\byou are (?:now|no longer)\b/i,
  /\b(?:developer|god|dan|jailbreak)\s+mode\b/i,
  /\bact as (?:the )?(?:system|admin|developer|root)\b/i,
  // French
  /\b(?:ignore|oublie|oubliez|ignorez)\b[^.\n]{0,40}\b(?:instructions?|consignes?|règles?)\b/i,
  /\b(?:affiche|montre|révèle|répète|donne)[^.\n]{0,40}\b(?:prompt|instructions?|consignes?)\s+(?:système|initiales?|cachées?)/i,
  /\bclés?\s+(?:api|secrètes?)\b/i
];

/** Heuristic: the text tries to change the assistant's rules or extract secrets. */
export function looksLikeInjection(value: string): boolean {
  return INJECTION_HINTS.some((re) => re.test(value));
}

/**
 * Untrusted text embedded in a prompt as a JSON string literal under a label,
 * so quotes, newlines or fake delimiters inside it cannot end the data block.
 */
export function promptData(label: string, value: string): string {
  return `<${label}>\n${JSON.stringify(cleanPromptInput(value, 8000))}\n</${label}>`;
}

// Credentials that must never appear in an AI reply.
const SECRET_PATTERNS = [
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic style
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API keys
  /\bsb_secret_[A-Za-z0-9_-]{8,}/g, // Supabase secret keys
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWTs (service role)
  /\bv1,whsec_[A-Za-z0-9+/=]{16,}|\bwhsec_[A-Za-z0-9+/=]{16,}/g, // webhook secrets
  /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/g, // Resend
  /\b(?:gsk|xai|ghp|gho|github_pat|glpat|hf)_[A-Za-z0-9_]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bsntrys_[A-Za-z0-9_=-]{16,}/g, // Sentry auth tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
];

/** Replaces anything that looks like a credential with `[redacted]`. */
export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((text, re) => text.replace(re, '[redacted]'), value);
}

const normalise = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * True when `reply` repeats one of `fragments` (distinctive sentences of the
 * system prompt), i.e. the model was talked into printing its instructions.
 */
export function leaksInstructions(reply: string, fragments: readonly string[]): boolean {
  const text = normalise(reply);
  return fragments.some((f) => f.length >= 24 && text.includes(normalise(f)));
}
