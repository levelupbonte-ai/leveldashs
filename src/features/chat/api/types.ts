import type { OrgRole } from '@/lib/auth/types';

/** team: every member of the organization; direct: two members; visitor: people writing from the website. */
export type ConversationKind = 'team' | 'direct' | 'visitor';

/** message: member message; note: internal staff note (visitor conversations); visitor: sent from the website. */
export type MessageKind = 'message' | 'note' | 'visitor';

export type VisitorStatus = 'open' | 'resolved' | 'archived';

export interface LastMessage {
  kind: MessageKind;
  sender_name: string | null;
  mine: boolean;
  body: string | null;
  created_at: string;
  deleted: boolean;
}

export interface DirectPeer {
  id: string;
  name: string | null;
  avatar: string | null;
  /** False once the person left the organization: the conversation is read-only. */
  is_member: boolean;
}

export interface VisitorInfo {
  name: string | null;
  /** Full address for editors and above, masked (j***@e***.com) for viewers. */
  email: string | null;
  has_email: boolean;
  website_name: string | null;
  source: 'form' | 'widget';
}

export interface ChatConversation {
  id: string;
  kind: ConversationKind;
  title: string | null;
  created_at: string;
  last_message_at: string;
  resolved_at: string | null;
  archived_at: string | null;
  muted: boolean;
  unread: number;
  member_count: number | null;
  last_message: LastMessage | null;
  peer: DirectPeer | null;
  visitor: VisitorInfo | null;
}

export interface ReplyPreview {
  id: string;
  sender_name: string | null;
  body: string | null;
  deleted: boolean;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  kind: MessageKind;
  sender_id: string | null;
  sender_name: string | null;
  sender_avatar: string | null;
  /** Plain text (never HTML); null when deleted. */
  body: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  client_id: string | null;
  mine: boolean;
  reply_to: ReplyPreview | null;
  /** Client-only: optimistic message waiting for the server, or failed to send. */
  pending?: 'sending' | 'failed';
}

export interface MessagesPage {
  messages: ChatMessage[];
  /** Older messages exist before this page. */
  hasMore: boolean;
}

export interface MessagesCursor {
  before: string;
  beforeId: string;
}

export interface ChatMember {
  id: string;
  name: string | null;
  avatar: string | null;
  role: OrgRole;
}

export interface VisitorContact {
  name: string | null;
  email: string | null;
  phone: string | null;
  website_name: string | null;
  website_domain: string | null;
}

export interface SendMessageInput {
  conversationId: string;
  body: string;
  replyTo?: ReplyPreview | null;
  clientId: string;
}
