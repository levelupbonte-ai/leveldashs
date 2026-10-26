import type { ChatMessage } from '../api/types';

/** Messages of one sender in a row, less than this apart, share one header. */
export const GROUP_GAP_MS = 5 * 60 * 1000;

export interface MessageGroup {
  key: string;
  senderKey: string;
  mine: boolean;
  messages: ChatMessage[];
}

export interface DaySection {
  /** Local calendar day (YYYY-MM-DD in the given time zone). */
  day: string;
  groups: MessageGroup[];
}

const senderKey = (m: ChatMessage) => `${m.kind}:${m.sender_id ?? m.sender_name ?? ''}`;

/** YYYY-MM-DD of an instant in a time zone. */
export function dayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(iso));
}

/** Messages (oldest first) grouped by day, then by consecutive sender. */
export function groupMessages(messages: ChatMessage[], timeZone: string): DaySection[] {
  const sections: DaySection[] = [];
  let prev: ChatMessage | null = null;
  for (const m of messages) {
    const day = dayKey(m.created_at, timeZone);
    let section = sections[sections.length - 1];
    if (!section || section.day !== day) {
      section = { day, groups: [] };
      sections.push(section);
      prev = null;
    }
    const group = section.groups[section.groups.length - 1];
    const sameSender =
      prev &&
      group &&
      senderKey(prev) === senderKey(m) &&
      Date.parse(m.created_at) - Date.parse(prev.created_at) < GROUP_GAP_MS;
    if (sameSender) {
      group.messages.push(m);
    } else {
      section.groups.push({ key: m.id, senderKey: senderKey(m), mine: m.mine, messages: [m] });
    }
    prev = m;
  }
  return sections;
}

/**
 * Merges messages into a list sorted oldest first: same id (or same client id
 * for an optimistic message) replaces the older copy.
 */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) {
    if (m.client_id) {
      for (const [id, existing] of byId) {
        if (existing.pending && existing.client_id === m.client_id) byId.delete(id);
      }
    }
    byId.set(m.id, m);
  }
  return [...byId.values()].toSorted(
    (a, b) =>
      Number(!!a.pending) - Number(!!b.pending) ||
      Date.parse(a.created_at) - Date.parse(b.created_at) ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id)
  );
}
