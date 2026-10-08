export interface AssistantMessage {
  role: 'user' | 'assistant';
  text: string;
}

/** A change the assistant suggests; nothing is saved until the user applies it. */
export type AssistantProposal =
  | {
      kind: 'service';
      id: string;
      name: string;
      changes: { description?: string; price_label?: string };
    }
  | { kind: 'faq'; question: string; answer: string }
  | { kind: 'seo'; title?: string; description?: string };

export interface AssistantReply {
  reply: string;
  proposals: AssistantProposal[];
  remaining?: number;
}
