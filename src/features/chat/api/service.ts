import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, isMfaError } from '@/lib/errors';
import { cleanMessageBody } from '../lib/message-text';
import type {
  ChatConversation,
  ChatMember,
  ChatMessage,
  MessagesCursor,
  MessagesPage,
  SendMessageInput,
  VisitorContact,
  VisitorStatus
} from './types';

// Every call goes through a SECURITY DEFINER function (supabase/migrations
// *_chat_*.sql) as the signed-in user: membership, second factor, validation
// and rate limits are checked in the database. Message bodies are encrypted at
// rest and only decrypted by those functions.

export const MESSAGES_PAGE_SIZE = 40;

type DbError = { message: string; code?: string } | null;

// Database errors become message keys: the raw message never reaches the screen.
function fail(error: DbError): never {
  const code = error?.code;
  if (isMfaError(error)) throw new AppError('mfaRequired', { cause: error });
  if (code === 'PT401') throw new AppError('sessionExpired', { cause: error });
  if (code === 'PT403' || code === '42501') throw new AppError('forbidden', { cause: error });
  if (code === 'PT404') throw new AppError('chatNotFound', { cause: error });
  if (code === 'PT429') throw new AppError('chatRateLimited', { cause: error });
  if (code === '22023' || code === '23514') {
    throw new AppError('chatInvalidMessage', { cause: error });
  }
  if (!code && /fetch|network/i.test(error?.message ?? '')) {
    throw new AppError('network', { cause: error });
  }
  throw new AppError('generic', { cause: error });
}

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) fail(error);
  return data as T;
}

function body(value: string): string {
  const clean = cleanMessageBody(value);
  if (clean === null) throw new AppError('chatInvalidMessage');
  return clean;
}

// ---------------------------------------------------------------- reads

export async function listConversations(
  db: SupabaseClient,
  organizationId: string,
  includeArchived = false
): Promise<ChatConversation[]> {
  return (
    (await rpc<ChatConversation[] | null>(db, 'chat_list_conversations', {
      p_org: organizationId,
      p_include_archived: includeArchived
    })) ?? []
  );
}

/** One page of history (oldest first); without cursor, the latest messages. */
export async function listMessages(
  db: SupabaseClient,
  conversationId: string,
  cursor: MessagesCursor | null = null
): Promise<MessagesPage> {
  const messages =
    (await rpc<ChatMessage[] | null>(db, 'chat_list_messages', {
      p_conversation: conversationId,
      p_before: cursor?.before ?? null,
      p_before_id: cursor?.beforeId ?? null,
      p_limit: MESSAGES_PAGE_SIZE
    })) ?? [];
  return { messages, hasMore: messages.length === MESSAGES_PAGE_SIZE };
}

/** Messages newer than `after` (Realtime / polling catch-up). */
export async function listNewMessages(
  db: SupabaseClient,
  conversationId: string,
  after: string
): Promise<ChatMessage[]> {
  return (
    (await rpc<ChatMessage[] | null>(db, 'chat_list_messages', {
      p_conversation: conversationId,
      p_after: after,
      p_limit: 100
    })) ?? []
  );
}

export async function getMessage(db: SupabaseClient, messageId: string): Promise<ChatMessage> {
  return rpc<ChatMessage>(db, 'chat_get_message', { p_message: messageId });
}

export async function listMembers(
  db: SupabaseClient,
  organizationId: string
): Promise<ChatMember[]> {
  return (await rpc<ChatMember[] | null>(db, 'chat_list_members', { p_org: organizationId })) ?? [];
}

export async function getUnreadTotal(db: SupabaseClient, organizationId: string): Promise<number> {
  return (await rpc<number | null>(db, 'chat_unread_total', { p_org: organizationId })) ?? 0;
}

/** Editors and above only (viewers get a masked address in the list). */
export async function getVisitorContact(
  db: SupabaseClient,
  conversationId: string
): Promise<VisitorContact> {
  return rpc<VisitorContact>(db, 'chat_visitor_contact', { p_conversation: conversationId });
}

// ---------------------------------------------------------------- writes

export async function sendMessage(
  db: SupabaseClient,
  input: SendMessageInput
): Promise<ChatMessage> {
  return rpc<ChatMessage>(db, 'chat_send_message', {
    p_conversation: input.conversationId,
    p_body: body(input.body),
    p_reply_to: input.replyTo?.id ?? null,
    p_client_id: input.clientId
  });
}

export async function editMessage(
  db: SupabaseClient,
  messageId: string,
  value: string
): Promise<ChatMessage> {
  return rpc<ChatMessage>(db, 'chat_edit_message', { p_message: messageId, p_body: body(value) });
}

export async function deleteMessage(db: SupabaseClient, messageId: string): Promise<ChatMessage> {
  return rpc<ChatMessage>(db, 'chat_delete_message', { p_message: messageId });
}

export async function markRead(db: SupabaseClient, conversationId: string): Promise<void> {
  await rpc<null>(db, 'chat_mark_read', { p_conversation: conversationId });
}

export async function setMuted(
  db: SupabaseClient,
  conversationId: string,
  muted: boolean
): Promise<void> {
  await rpc<null>(db, 'chat_set_muted', { p_conversation: conversationId, p_muted: muted });
}

export async function openDirect(
  db: SupabaseClient,
  organizationId: string,
  userId: string
): Promise<string> {
  return rpc<string>(db, 'chat_open_direct', { p_org: organizationId, p_user: userId });
}

export async function setVisitorStatus(
  db: SupabaseClient,
  conversationId: string,
  status: VisitorStatus
): Promise<void> {
  await rpc<null>(db, 'chat_set_visitor_status', {
    p_conversation: conversationId,
    p_status: status
  });
}
