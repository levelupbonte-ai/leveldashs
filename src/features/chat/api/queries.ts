import type { SupabaseClient } from '@supabase/supabase-js';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import {
  getUnreadTotal,
  getVisitorContact,
  listConversations,
  listMembers,
  listMessages
} from './service';
import type { MessagesCursor, MessagesPage } from './types';

// Query options take the Supabase client so the same keys work for the server
// prefetch (cookie-bound client) and the browser (session client).
export const chatKeys = {
  all: ['chat'] as const,
  org: (organizationId: string) => [...chatKeys.all, organizationId] as const,
  conversations: (organizationId: string, includeArchived = false) =>
    [...chatKeys.org(organizationId), 'conversations', includeArchived ? 'all' : 'open'] as const,
  messages: (conversationId: string) => [...chatKeys.all, 'messages', conversationId] as const,
  members: (organizationId: string) => [...chatKeys.org(organizationId), 'members'] as const,
  unread: (organizationId: string) => [...chatKeys.org(organizationId), 'unread'] as const,
  visitor: (conversationId: string) => [...chatKeys.all, 'visitor', conversationId] as const
};

export const conversationsQueryOptions = (
  db: SupabaseClient,
  organizationId: string,
  includeArchived = false
) =>
  queryOptions({
    queryKey: chatKeys.conversations(organizationId, includeArchived),
    queryFn: () => listConversations(db, organizationId, includeArchived),
    staleTime: 15 * 1000
  });

export const olderCursor = (page: MessagesPage): MessagesCursor | null => {
  const first = page.messages[0];
  return page.hasMore && first ? { before: first.created_at, beforeId: first.id } : null;
};

/** History pages: pages[0] is the latest, each next page is older. */
export const messagesQueryOptions = (db: SupabaseClient, conversationId: string) =>
  infiniteQueryOptions({
    queryKey: chatKeys.messages(conversationId),
    queryFn: ({ pageParam }) => listMessages(db, conversationId, pageParam),
    initialPageParam: null as MessagesCursor | null,
    getNextPageParam: (last) => olderCursor(last),
    staleTime: 30 * 1000
  });

export const membersQueryOptions = (db: SupabaseClient, organizationId: string) =>
  queryOptions({
    queryKey: chatKeys.members(organizationId),
    queryFn: () => listMembers(db, organizationId),
    staleTime: 5 * 60 * 1000
  });

export const unreadQueryOptions = (db: SupabaseClient, organizationId: string) =>
  queryOptions({
    queryKey: chatKeys.unread(organizationId),
    queryFn: () => getUnreadTotal(db, organizationId),
    staleTime: 20 * 1000,
    refetchInterval: 60 * 1000
  });

export const visitorContactQueryOptions = (db: SupabaseClient, conversationId: string) =>
  queryOptions({
    queryKey: chatKeys.visitor(conversationId),
    queryFn: () => getVisitorContact(db, conversationId),
    staleTime: 5 * 60 * 1000
  });
