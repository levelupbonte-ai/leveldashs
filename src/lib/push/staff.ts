import webpush from 'web-push';
import { createAnonClient } from '@/lib/supabase/anon';
import { type Env, readVapid, type StaffPushRow, staffPushPayload } from './staff-payload';

export { readVapid } from './staff-payload';

/**
 * Push notifications for the dashboard team (Web Push, VAPID). Optional: with
 * no keys nothing is sent and the dashboard works as before.
 *
 * - DASHBOARD_VAPID_PUBLIC_KEY   public, given to the browser to subscribe
 * - DASHBOARD_VAPID_PRIVATE_KEY  secret (Vercel, Sensitive), signs the sends
 *
 * Generate the pair once with `npx web-push@3.6.7 generate-vapid-keys`.
 * A notification never carries a member's message: who and which page only.
 */

type Send = (row: StaffPushRow, payload: object) => Promise<{ ok: boolean; gone: boolean }>;

function createSender(vapid: { publicKey: string; privateKey: string }): Send {
  return async (row, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload),
        {
          TTL: 24 * 3600,
          urgency: 'high',
          timeout: 6000,
          vapidDetails: {
            subject: 'https://dashboard.levelup-ecosystem.com',
            publicKey: vapid.publicKey,
            privateKey: vapid.privateKey
          }
        }
      );
      return { ok: true, gone: false };
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      return { ok: false, gone: status === 404 || status === 410 };
    }
  };
}

/** Sends what is queued (new members, new messages) to the team's devices. */
export async function flushStaffPush(key: string, env: Env, send?: Send) {
  const vapid = readVapid(env);
  if (!vapid) return { sent: 0, failed: 0, configured: false };
  const db = createAnonClient();
  const { data, error } = await db.rpc('staff_push_claim', { p_key: key, p_limit: 20 });
  if (error) throw new Error('staff_push_claim failed');
  const rows = (Array.isArray(data) ? data : []) as StaffPushRow[];
  const deliver = send ?? createSender(vapid);
  let sent = 0;
  let failed = 0;
  await Promise.all(
    rows.map(async (row) => {
      const out = await deliver(row, staffPushPayload(row));
      if (out.ok) sent += 1;
      else failed += 1;
      await db.rpc('staff_push_result', {
        p_key: key,
        p_device: row.device,
        p_ok: out.ok,
        p_gone: out.gone
      });
    })
  );
  return { sent, failed, configured: true };
}
