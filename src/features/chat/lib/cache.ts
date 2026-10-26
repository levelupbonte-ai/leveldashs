import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { chatKeys } from '../api/queries';
import type { ChatConversation, ChatMessage, MessagesCursor, MessagesPage } from '../api/types';
import { mergeMessages } from './grouping';

type Pages = InfiniteData<MessagesPage, MessagesCursor | null>;

/** Adds or replaces messages in the latest page of a conversation. */
export function upsertMessages(qc: QueryClient, conversationId: string, messages: ChatMessage[]) {
  if (!messages.length) return;
  qc.setQueryData<Pages>(chatKeys.messages(conversationId), (data) => {
    if (!data) return data;
    const ids = new Set(messages.map((m) => m.id));
    // A message already loaded in an older page is replaced where it is.
    const pages = data.pages.map((page, i) => {
      if (i === 0) return page;
      if (!page.messages.some((m) => ids.has(m.id))) return page;
      const replaced = page.messages.map((m) => messages.find((n) => n.id === m.id) ?? m);
      return { ...page, messages: replaced };
    });
    const inOlder = new Set(pages.slice(1).flatMap((p) => p.messages.map((m) => m.id)));
    const first = data.pages[0] ?? { messages: [], hasMore: false };
    pages[0] = {
      ...first,
      messages: mergeMessages(
        first.messages,
        messages.filter((m) => !inOlder.has(m.id))
      )
    };
    return { ...data, pages };
  });
}

/** Changes one message in place (pending state of an optimistic message). */
export function patchMessage(
  qc: QueryClient,
  conversationId: string,
  messageId: string,
  patch: Partial<ChatMessage>
) {
  qc.setQueryData<Pages>(chatKeys.messages(conversationId), (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            messages: page.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m))
          }))
        }
      : data
  );
}

/** Latest message confirmed by the server (catch-up cursor). */
export function latestServerMessage(qc: QueryClient, conversationId: string): ChatMessage | null {
  const data = qc.getQueryData<Pages>(chatKeys.messages(conversationId));
  const list = data?.pages[0]?.messages ?? [];
  for (let i = list.length - 1; i >= 0; i--) if (!list[i].pending) return list[i];
  return null;
}

/** Sets the unread count of a conversation in every cached list of the organization. */
export function setConversationUnread(
  qc: QueryClient,
  organizationId: string,
  conversationId: string,
  unread: number
) {
  for (const archived of [false, true]) {
    qc.setQueryData<ChatConversation[]>(chatKeys.conversations(organizationId, archived), (list) =>
      list?.map((c) => (c.id === conversationId ? { ...c, unread } : c))
    );
  }
}

/** Refetches the conversation lists and the unread badge of an organization. */
export function refreshLists(qc: QueryClient, organizationId: string) {
  void qc.invalidateQueries({ queryKey: [...chatKeys.org(organizationId), 'conversations'] });
  void qc.invalidateQueries({ queryKey: chatKeys.unread(organizationId) });
}
