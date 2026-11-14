import { createSearchParamsCache, parseAsString, parseAsStringLiteral } from 'nuqs/server';

export const CHAT_TABS = ['all', 'members', 'team', 'direct', 'visitors'] as const;
export type ChatTab = (typeof CHAT_TABS)[number];

/**
 * `?c=<conversation id>&tab=all|members|team|direct|visitors`, shared by the server page and
 * the client; `?m=<member id>` opens a client-portal member's conversation (Black Pater…).
 */
export const chatSearchParams = {
  c: parseAsString,
  m: parseAsString,
  tab: parseAsStringLiteral(CHAT_TABS).withDefault('all')
};

export const chatSearchParamsCache = createSearchParamsCache(chatSearchParams);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isConversationId = (value: string | null | undefined): value is string =>
  !!value && UUID.test(value);
