import { NextResponse, type NextRequest } from 'next/server';
import * as z from 'zod';
import { createAnonClient } from '@/lib/supabase/anon';
import { readJsonBody } from '@/lib/validation/http';
import { answerQuestion, prepareHandoff } from '@/features/client-portal/server/assistant';
import type { AssistantContext } from '@/features/client-portal/server/assistant-prompt';

// Members' AI assistant of a client portal, called by the client website's
// SERVER (never a browser): `Authorization: Bearer <portal key>` plus the
// member's portal session. The database checks both, the membership and the
// daily quota (portal_ai_begin); the AI keys never leave LevelUp.
//
//   POST { action: 'ask', session, question }       -> { answer }
//   POST { action: 'handoff', session, questionId }  -> { ok, id }

export const maxDuration = 60;

const KEY = /^lu_(live|test)_[0-9a-f]{48}$/;
const SESSION = z.string().regex(/^[0-9a-f]{64}$/);

const Body = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('ask'),
    session: SESSION,
    question: z.string().trim().min(1).max(2000)
  }),
  z.strictObject({
    action: z.literal('handoff'),
    session: SESSION,
    questionId: z.uuid()
  })
]);

const STATUS: Record<string, [number, string]> = {
  PT401: [401, 'unauthorized'],
  PT402: [402, 'membership_expired'],
  PT403: [403, 'forbidden'],
  PT404: [404, 'not_found'],
  PT429: [429, 'rate_limited'],
  '22023': [400, 'invalid_request']
};

const json = (status: number, body: unknown) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function dbError(error: { code?: string } | null) {
  const [status, code] = STATUS[error?.code ?? ''] ?? [503, 'unavailable'];
  return json(status, { error: code });
}

export async function POST(request: NextRequest) {
  const key = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!KEY.test(key)) return json(401, { error: 'unauthorized' });
  // Server-to-server: no browser origin to check; the key and session are the proof.
  const parsed = await readJsonBody(request, Body, { maxBytes: 8 * 1024, allowCrossOrigin: true });
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const db = createAnonClient();

  if (body.action === 'ask') {
    const begin = await db.rpc('portal_ai_begin', {
      p_key: key,
      p_session: body.session,
      p_question: body.question
    });
    if (begin.error) return dbError(begin.error);
    const ctx = begin.data as AssistantContext;
    let answer: { text: string; sources: { url: string; title: string }[] };
    try {
      answer = await answerQuestion(ctx);
      if (!answer.text) throw new Error('empty');
    } catch {
      // Withdraw the question so it does not count against the member's quota.
      await db.rpc('portal_ai_finish', {
        p_key: key,
        p_session: body.session,
        p_question_id: ctx.question_id,
        p_body: null
      });
      return json(503, { error: 'ai_unavailable' });
    }
    const finish = await db.rpc('portal_ai_finish', {
      p_key: key,
      p_session: body.session,
      p_question_id: ctx.question_id,
      p_body: answer.text,
      p_sources: answer.sources
    });
    if (finish.error) return dbError(finish.error);
    return json(200, { answer: finish.data });
  }

  const context = await db.rpc('portal_ai_handoff_context', {
    p_key: key,
    p_session: body.session,
    p_question_id: body.questionId
  });
  if (context.error) return dbError(context.error);
  const c = context.data as {
    question: string;
    handed_off: boolean;
    answer: string | null;
    profile: Record<string, unknown> | null;
    site: string;
  };
  const brief = c.handed_off
    ? { summary: '', draft: '' }
    : await prepareHandoff({
        site: c.site,
        question: c.question,
        answer: c.answer,
        profile: c.profile
      });
  const handoff = await db.rpc('portal_ai_handoff', {
    p_key: key,
    p_session: body.session,
    p_question_id: body.questionId,
    p_summary: brief.summary,
    p_draft: brief.draft
  });
  if (handoff.error) return dbError(handoff.error);
  return json(200, handoff.data);
}
