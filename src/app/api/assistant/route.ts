import { NextResponse, type NextRequest } from 'next/server';
import * as z from 'zod';
import { runAssistant } from '@/features/assistant/server/assistant';
import { getLocale } from 'next-intl/server';
import { ASSISTANT_ORIGINS, guardAssistantRequest } from '@/features/assistant/server/guard';
import { readJsonBody } from '@/lib/validation/http';
import { cleanPromptInput } from '@/lib/validation/prompt';

// The conversation as the browser holds it. Every message is cleaned (hidden
// characters and chat-template role markers removed) before it reaches a model;
// unknown keys are refused.
const Message = z.strictObject({
  role: z.enum(['user', 'assistant']),
  text: z
    .string()
    .max(4000)
    .transform((text) => cleanPromptInput(text))
    .pipe(z.string().min(1))
});
const Body = z.strictObject({ messages: z.array(Message).min(1).max(20) });

export async function POST(request: NextRequest) {
  // Same origin, JSON, 128 KB at most, validated before spending any of the daily allowance.
  const parsed = await readJsonBody(request, Body, {
    maxBytes: 128 * 1024,
    allowedOrigins: ASSISTANT_ORIGINS
  });
  if (!parsed.ok) return parsed.response;
  const messages = parsed.data.messages.slice(-12);
  if (messages.at(-1)?.role !== 'user')
    return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const guard = await guardAssistantRequest(request);
  if ('error' in guard) return guard.error;

  try {
    const result = await runAssistant({
      db: guard.db,
      websiteId: guard.website.id,
      siteName: guard.website.name,
      canEdit: guard.canEdit,
      locale: await getLocale(),
      messages
    });
    return NextResponse.json({ ...result, remaining: guard.remaining });
  } catch (error) {
    // Provider details stay in the server logs; the browser only gets a code.
    console.error('assistant failed', error instanceof Error ? error.name : 'error');
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}
