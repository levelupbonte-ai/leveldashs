import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { runAssistant } from '@/features/assistant/server/assistant';
import { getLocale } from 'next-intl/server';
import { guardAssistantRequest } from '@/features/assistant/server/guard';

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().min(1).max(4000) }))
    .min(1)
    .max(20)
});

export async function POST(request: NextRequest) {
  // Validate the body before spending any of the daily allowance.
  const parsed = Body.safeParse(
    await request
      .clone()
      .json()
      .catch(() => null)
  );
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
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
