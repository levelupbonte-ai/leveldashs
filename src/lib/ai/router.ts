import 'server-only';
import { geminiRotator } from './gemini';

/**
 * Multi-provider AI routing. Each task has an ordered list of `provider:model`
 * targets; a call walks the list and moves on whenever a provider is missing a
 * key, rate-limited, out of quota or down. So free tiers (Groq, Cerebras,
 * Mistral, OpenRouter) carry the everyday load, Gemini stays in the mix, and a
 * cheap paid provider (DeepSeek) is the safety net for heavy jobs.
 *
 * Keys are server-only env vars (GROQ_API_KEY, CEREBRAS_API_KEY, MISTRAL_API_KEY,
 * OPENROUTER_API_KEY, DEEPSEEK_API_KEY, GEMINI_API_KEYS). A route can be
 * overridden per task with AI_ROUTE_<TASK>, e.g.
 *   AI_ROUTE_AGENTS="groq:openai/gpt-oss-120b,gemini:gemini-3.1-flash-lite"
 */

export type AiTask = 'agents' | 'writing' | 'reports' | 'site' | 'studio_chat' | 'studio_build';
export type ProviderId = 'groq' | 'cerebras' | 'mistral' | 'openrouter' | 'deepseek' | 'gemini';
export interface AiTarget {
  provider: ProviderId;
  model: string;
}

const OPENAI_COMPATIBLE: Record<
  Exclude<ProviderId, 'gemini'>,
  { baseUrl: string; keyEnv: string }
> = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' },
  cerebras: {
    baseUrl: 'https://api.cerebras.ai/v1',
    keyEnv: 'CEREBRAS_API_KEY'
  },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', keyEnv: 'MISTRAL_API_KEY' },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY'
  },
  deepseek: { baseUrl: 'https://api.deepseek.com', keyEnv: 'DEEPSEEK_API_KEY' }
};

/** Default split: who does what. Free and fast first, paid last. */
const DEFAULT_ROUTES: Record<AiTask, string> = {
  agents:
    'cerebras:gpt-oss-120b,groq:openai/gpt-oss-120b,mistral:mistral-small-latest,gemini:gemini-3.1-flash-lite',
  // Client-facing copy (service descriptions, FAQ, SEO): best writer first.
  writing:
    'deepseek:deepseek-chat,mistral:mistral-small-latest,groq:openai/gpt-oss-120b,gemini:gemini-3.1-flash-lite',
  // Summaries of the client's activity.
  reports: 'groq:openai/gpt-oss-120b,cerebras:gpt-oss-120b,gemini:gemini-3.1-flash-lite',
  site: 'groq:openai/gpt-oss-20b,mistral:mistral-small-latest,gemini:gemini-3.1-flash-lite',
  studio_chat:
    'groq:openai/gpt-oss-120b,cerebras:gpt-oss-120b,gemini:gemini-3.1-flash-lite,deepseek:deepseek-chat',
  studio_build:
    'gemini:gemini-3.5-flash,gemini:gemini-3-flash-preview,deepseek:deepseek-chat,openrouter:deepseek/deepseek-chat,gemini:gemini-3.1-flash-lite'
};

const PROVIDERS = new Set<ProviderId>([
  'groq',
  'cerebras',
  'mistral',
  'openrouter',
  'deepseek',
  'gemini'
]);

export function providerKey(provider: ProviderId): string | null {
  if (provider === 'gemini') return 'gemini';
  return process.env[OPENAI_COMPATIBLE[provider].keyEnv]?.trim() || null;
}

/** Targets for a task, keeping only providers that have a key configured. */
export function aiRoute(task: AiTask): AiTarget[] {
  const spec = process.env[`AI_ROUTE_${task.toUpperCase()}`] || DEFAULT_ROUTES[task];
  return spec
    .split(',')
    .map((entry) => {
      const i = entry.indexOf(':');
      return {
        provider: entry.slice(0, i).trim() as ProviderId,
        model: entry.slice(i + 1).trim()
      };
    })
    .filter((t) => PROVIDERS.has(t.provider) && t.model && providerKey(t.provider));
}

/** Provider said "not now" (quota, rate limit, overload, outage): try the next one. */
export class AiProviderUnavailable extends Error {
  constructor(
    readonly target: AiTarget,
    readonly status: number
  ) {
    super(`${target.provider}:${target.model} unavailable (${status})`);
  }
}

// ------------------------------------------------------------ OpenAI-compatible

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatResult {
  content: string;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
  message: ChatMessage;
}

/** gpt-oss models reason before answering: keep the effort low and leave room for it. */
const isReasoningModel = (model: string) => /gpt-oss/i.test(model);

export async function chatCompletion(
  target: AiTarget,
  body: {
    messages: ChatMessage[];
    tools?: ChatTool[];
    maxTokens: number;
    temperature: number;
    timeoutMs?: number;
  }
): Promise<ChatResult> {
  if (target.provider === 'gemini')
    throw new Error('chatCompletion is for OpenAI-compatible providers');
  const { baseUrl } = OPENAI_COMPATIBLE[target.provider];
  const key = providerKey(target.provider);
  if (!key) throw new AiProviderUnavailable(target, 401);

  const reasoning = isReasoningModel(target.model);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: target.model,
        messages: body.messages,
        ...(body.tools?.length ? { tools: body.tools, tool_choice: 'auto' } : {}),
        temperature: body.temperature,
        max_tokens: reasoning ? Math.max(body.maxTokens * 3, 1500) : body.maxTokens,
        ...(reasoning && (target.provider === 'groq' || target.provider === 'cerebras')
          ? { reasoning_effort: 'low' }
          : {})
      }),
      signal: AbortSignal.timeout(body.timeoutMs ?? 45_000)
    });
  } catch {
    throw new AiProviderUnavailable(target, 503);
  }
  if (!res.ok) {
    // 401/403 (bad key) and 404 (unknown model) also skip to the next target.
    throw new AiProviderUnavailable(target, res.status);
  }
  const json = (await res.json().catch(() => null)) as {
    choices?: { message?: ChatMessage }[];
  } | null;
  const message = json?.choices?.[0]?.message;
  if (!message) throw new AiProviderUnavailable(target, 502);

  const toolCalls = (message.tool_calls ?? []).map((c) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(c.function.arguments || '{}') as Record<string, unknown>;
    } catch {
      args = {};
    }
    return { id: c.id, name: c.function.name, args };
  });
  const content = typeof message.content === 'string' ? message.content.trim() : '';
  if (!content && !toolCalls.length) throw new AiProviderUnavailable(target, 502);
  return {
    content,
    toolCalls,
    message: {
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: message.tool_calls
    }
  };
}

// ------------------------------------------------------------ plain text

/** One-shot text generation for a task, falling through its route. */
export async function generateText(
  task: AiTask,
  input: {
    system?: string;
    prompt: string;
    maxTokens: number;
    temperature: number;
  }
): Promise<string> {
  return (await generateWithTarget(task, input)).text;
}

/** Like generateText, also telling which provider answered (for usage tracking). */
export async function generateWithTarget(
  task: AiTask,
  input: {
    system?: string;
    prompt: string;
    maxTokens: number;
    temperature: number;
  }
): Promise<{ text: string; target: AiTarget }> {
  let lastError: unknown = new Error(`No AI provider configured for ${task}`);
  for (const target of aiRoute(task)) {
    try {
      if (target.provider === 'gemini') {
        const text = await geminiRotator.executeWithRotation(async (ai) => {
          const resp = await ai.models.generateContent({
            model: target.model,
            contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
            config: {
              ...(input.system ? { systemInstruction: input.system } : {}),
              temperature: input.temperature,
              maxOutputTokens: input.maxTokens
            }
          });
          return resp.text ?? '';
        }, 2);
        if (text.trim()) return { text: text.trim(), target };
        continue;
      }
      const result = await chatCompletion(target, {
        messages: [
          ...(input.system ? [{ role: 'system' as const, content: input.system }] : []),
          { role: 'user', content: input.prompt }
        ],
        maxTokens: input.maxTokens,
        temperature: input.temperature
      });
      if (result.content) return { text: result.content, target };
    } catch (err) {
      // Any failure (quota, outage, bad key, unknown model) moves to the next target.
      lastError = err;
    }
  }
  throw lastError;
}

/** Records which provider answered (counters only, never content). Never throws. */
export async function logAiCall(
  db: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<unknown> },
  task: AiTask,
  target: AiTarget
) {
  try {
    await db.rpc('log_ai_call', {
      p_task: task,
      p_provider: target.provider,
      p_model: target.model
    });
  } catch {
    // usage tracking must never break a feature
  }
}
