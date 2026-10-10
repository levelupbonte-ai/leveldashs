import type { Messages } from './messages';

/**
 * Namespaces never sent to the browser by the root provider: server-only copy
 * (metadata, e-mails, API errors) and LevelUp staff screens, which get their own
 * provider on /dashboard/exclusive so client bundles of regular accounts never
 * contain internal wording.
 */
const SERVER_ONLY: readonly string[] = ['metadata', 'emails', 'api', 'admin'];

export function clientMessages(messages: Messages): Partial<Messages> {
  return Object.fromEntries(
    Object.entries(messages).filter(([key]) => !SERVER_ONLY.includes(key))
  ) as Partial<Messages>;
}

/** Everything, for the provider of LevelUp staff screens. */
export function staffMessages(messages: Messages): Partial<Messages> {
  return Object.fromEntries(
    Object.entries(messages).filter(([key]) => key !== 'metadata' && key !== 'emails')
  ) as Partial<Messages>;
}
