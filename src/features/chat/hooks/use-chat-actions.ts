'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useErrorMessage } from '@/hooks/use-error-message';
import { errorCode } from '@/lib/errors';
import { useDashboardSession } from '@/lib/auth/session-context';
import { createClient } from '@/lib/supabase/client';
import {
  deleteMessage,
  editMessage,
  markRead,
  openDirect,
  sendMessage,
  setMuted,
  setVisitorStatus
} from '../api/service';
import type { ChatMessage, ReplyPreview, SendMessageInput, VisitorStatus } from '../api/types';
import { chatKeys } from '../api/queries';
import { patchMessage, refreshLists, setConversationUnread, upsertMessages } from '../lib/cache';

/** Mutations of the chat page, with optimistic send and retry. */
export function useChatActions(organizationId: string) {
  const db = useMemo(() => createClient(), []);
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const { user } = useDashboardSession();
  const t = useTranslations('chat.toasts');

  const send = useMutation({
    mutationFn: (input: SendMessageInput) => sendMessage(db, input),
    // One automatic retry for connection problems only; the client id keeps it idempotent.
    retry: (count, error) => count < 1 && ['network', 'generic'].includes(errorCode(error)),
    onMutate: (input) => {
      const optimistic: ChatMessage = {
        id: `pending:${input.clientId}`,
        conversation_id: input.conversationId,
        kind: 'message',
        sender_id: user.id,
        sender_name: user.fullName || user.email,
        sender_avatar: user.avatarUrl,
        body: input.body.trim(),
        created_at: new Date().toISOString(),
        edited_at: null,
        deleted_at: null,
        client_id: input.clientId,
        mine: true,
        reply_to: input.replyTo ?? null,
        pending: 'sending'
      };
      upsertMessages(qc, input.conversationId, [optimistic]);
    },
    onSuccess: (message, input) => {
      upsertMessages(qc, input.conversationId, [message]);
      refreshLists(qc, organizationId);
    },
    onError: (error, input) => {
      patchMessage(qc, input.conversationId, `pending:${input.clientId}`, { pending: 'failed' });
      toast.error(errorMessage(error));
    }
  });

  /** Sends a new message (the database stores it as a note in visitor conversations). */
  const sendText = useCallback(
    (conversationId: string, body: string, replyTo: ReplyPreview | null) =>
      send.mutate({ conversationId, body, replyTo, clientId: crypto.randomUUID() }),
    [send]
  );

  /** Sends a failed message again with the same client id (never duplicated). */
  const retry = useCallback(
    (message: ChatMessage) => {
      if (!message.client_id || !message.body) return;
      patchMessage(qc, message.conversation_id, message.id, { pending: 'sending' });
      send.mutate({
        conversationId: message.conversation_id,
        body: message.body,
        replyTo: message.reply_to,
        clientId: message.client_id
      });
    },
    [qc, send]
  );

  const edit = useMutation({
    mutationFn: ({ message, body }: { message: ChatMessage; body: string }) =>
      editMessage(db, message.id, body),
    onSuccess: (message) => {
      upsertMessages(qc, message.conversation_id, [message]);
      refreshLists(qc, organizationId);
    },
    onError: (error) => toast.error(errorMessage(error))
  });

  const remove = useMutation({
    mutationFn: (message: ChatMessage) => deleteMessage(db, message.id),
    onSuccess: (message) => {
      upsertMessages(qc, message.conversation_id, [message]);
      refreshLists(qc, organizationId);
    },
    onError: (error) => toast.error(errorMessage(error))
  });

  const read = useMutation({
    mutationFn: (conversationId: string) => markRead(db, conversationId),
    onMutate: (conversationId) => setConversationUnread(qc, organizationId, conversationId, 0),
    onSettled: () => void qc.invalidateQueries({ queryKey: chatKeys.unread(organizationId) })
  });

  const mute = useMutation({
    mutationFn: ({ conversationId, muted }: { conversationId: string; muted: boolean }) =>
      setMuted(db, conversationId, muted),
    onSuccess: (_, { muted }) => {
      refreshLists(qc, organizationId);
      toast.success(muted ? t('muted') : t('unmuted'));
    },
    onError: (error) => toast.error(errorMessage(error))
  });

  const visitorStatus = useMutation({
    mutationFn: ({ conversationId, status }: { conversationId: string; status: VisitorStatus }) =>
      setVisitorStatus(db, conversationId, status),
    onSuccess: (_, { status }) => {
      refreshLists(qc, organizationId);
      toast.success(
        status === 'resolved'
          ? t('resolved')
          : status === 'archived'
            ? t('archived')
            : t('reopened')
      );
    },
    onError: (error) => toast.error(errorMessage(error))
  });

  const direct = useMutation({
    mutationFn: (userId: string) => openDirect(db, organizationId, userId),
    onSuccess: () => refreshLists(qc, organizationId),
    onError: (error) => toast.error(errorMessage(error))
  });

  return { db, sendText, retry, edit, remove, read, mute, visitorStatus, direct };
}
