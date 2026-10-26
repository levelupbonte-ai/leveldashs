'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { chatKeys } from '../api/queries';
import { getMessage, listNewMessages } from '../api/service';
import { latestServerMessage, refreshLists, upsertMessages } from '../lib/cache';

/** Polling interval while Realtime is not connected. */
const POLL_MS = 10_000;

interface RealtimeRow {
  id?: string;
  conversation_id?: string;
}

/**
 * Live updates for the chat of one organization.
 *
 * Supabase Realtime `postgres_changes` on `chat_messages` (filtered by
 * organization) wakes the page: Realtime checks the table RLS for each
 * subscriber, and the payload only carries ids and ciphertext. The text is
 * then fetched through the chat functions. When the channel is not connected
 * (blocked websocket, network change), the page polls every 10 seconds.
 */
export function useChatRealtime(organizationId: string, activeConversationId: string | null) {
  const qc = useQueryClient();
  const activeRef = useRef(activeConversationId);
  const [live, setLive] = useState(false);

  useEffect(() => {
    activeRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    const db = createClient();

    async function catchUp(conversationId: string) {
      const latest = latestServerMessage(qc, conversationId);
      if (!latest) {
        void qc.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
        return;
      }
      try {
        upsertMessages(
          qc,
          conversationId,
          await listNewMessages(db, conversationId, latest.created_at)
        );
      } catch {
        // Next event or poll tries again.
      }
    }

    async function onChange(eventType: string, row: RealtimeRow) {
      refreshLists(qc, organizationId);
      const conversationId = row.conversation_id;
      if (!conversationId || conversationId !== activeRef.current) return;
      if (eventType === 'UPDATE' && row.id) {
        try {
          upsertMessages(qc, conversationId, [await getMessage(db, row.id)]);
        } catch {
          // The message may no longer be readable: ignore.
        }
        return;
      }
      await catchUp(conversationId);
    }

    const channel = db
      .channel(`chat:${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_messages',
          filter: `organization_id=eq.${organizationId}`
        },
        (payload) => void onChange(payload.eventType, payload.new as RealtimeRow)
      )
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));

    return () => {
      void db.removeChannel(channel);
    };
  }, [qc, organizationId]);

  // Polling fallback.
  useEffect(() => {
    if (live) return;
    const db = createClient();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refreshLists(qc, organizationId);
      const conversationId = activeRef.current;
      if (!conversationId) return;
      const latest = latestServerMessage(qc, conversationId);
      if (!latest) return;
      listNewMessages(db, conversationId, latest.created_at)
        .then((messages) => upsertMessages(qc, conversationId, messages))
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, qc, organizationId]);

  return { live };
}
