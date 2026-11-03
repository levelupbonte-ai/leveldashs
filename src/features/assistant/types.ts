import type { AppointmentStatus, SubmissionStatus } from '@/features/site/api/types';

/** A file attached to a message, as the browser sends it (images resized first). */
export interface AssistantAttachment {
  name: string;
  mime: string;
  /** Base64, without the data: prefix. */
  data: string;
}

export interface AssistantMessage {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * An action the assistant prepares. Nothing happens until the user clicks
 * Authorize on its card (and Row Level Security checks the role again).
 */
export type AssistantProposal =
  | {
      kind: 'service';
      id: string;
      name: string;
      changes: { description?: string; price_label?: string };
    }
  | { kind: 'faq'; question: string; answer: string }
  | { kind: 'seo'; title?: string; description?: string }
  | {
      kind: 'request_status';
      id: string;
      /** Form type and date, never what the visitor typed. */
      label: string;
      from: SubmissionStatus;
      to: SubmissionStatus;
    }
  | {
      kind: 'appointment_status';
      id: string;
      /** Date, time and service, never the customer. */
      label: string;
      from: AppointmentStatus;
      to: AppointmentStatus;
    }
  | { kind: 'announcement'; title: string; content: string }
  | {
      kind: 'support';
      category: SupportCategory;
      urgency: SupportUrgency;
      subject: string;
      details: string;
    };

export const SUPPORT_CATEGORIES = [
  'content',
  'bookings',
  'requests',
  'payments',
  'billing',
  'email',
  'seo',
  'website_bug',
  'account_access',
  'other'
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export const SUPPORT_URGENCIES = ['low', 'normal', 'high', 'urgent'] as const;
export type SupportUrgency = (typeof SUPPORT_URGENCIES)[number];

/** How the assistant classified the user's problem (shown above its answer). */
export interface AssistantTriage {
  category: SupportCategory;
  urgency: SupportUrgency;
  summary: string;
}

export interface AssistantReply {
  reply: string;
  proposals: AssistantProposal[];
  triage?: AssistantTriage | null;
  /** Files that could not be used (wrong type, too large). */
  refusedFiles?: string[];
  remaining?: number;
}
