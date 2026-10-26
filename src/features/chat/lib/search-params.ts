import { createSearchParamsCache, parseAsString, parseAsStringLiteral } from 'nuqs/server';

export const CHAT_TABS = ['all', 'team', 'direct', 'visitors'] as const;
export type ChatTab = (typeof CHAT_TABS)[number];

/** `?c=<conversation id>&tab=all|team|direct|visitors`, shared by the server page and the client. */
export const chatSearchParams = {
  c: parseAsString,
  tab: parseAsStringLiteral(CHAT_TABS).withDefault('all')
};

export const chatSearchParamsCache = createSearchParamsCache(chatSearchParams);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isConversationId = (value: string | null | undefined): value is string =>
  !!value && UUID.test(value);
