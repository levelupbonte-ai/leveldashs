# Chat (Messages)

`/dashboard/chat` is private messaging for the people of one organization, plus
an inbox for the messages visitors send from the website. There are no calls and
no video.

| Conversation | Who is in it | Who can write |
| --- | --- | --- |
| **Team** | One per organization, every member (created on first read, always in sync with `organization_members`) | Every member |
| **Direct** | Two members of the same organization | Both, while both are still members (then read-only) |
| **Visitor** | People who write from the website: contact form messages (`submit_form`, type `contact`) and the optional `send_site_message` RPC | Visitors write from the site. Staff add **internal notes** (editor and above); viewers read, with the visitor e-mail masked |

LevelUp platform admins do **not** read client chats unless they are members of
the organization (unlike the site inbox, which they can manage).

## Data model

Migrations `20261025100000_chat_schema.sql`, `20261025100100_chat_member_rpcs.sql`,
`20261025100200_chat_visitors.sql`.

| Table | Content |
| --- | --- |
| `chat_conversations` | `organization_id`, `kind` (`team` / `direct` / `visitor`), `title`, `direct_key` (the two user ids, sorted), `website_id` (visitor), `created_by`, `last_message_at`, `resolved_at`, `archived_at`, `source_submission_id` |
| `chat_participants` | per user: `last_read_at`, `muted`, `role` (`member` / `staff`). Direct rows are created when the conversation opens; team and visitor rows on first read |
| `chat_messages` | `conversation_id`, `organization_id`, `kind` (`message` / `note` / `visitor`), `sender_user_id` (null for visitors) or `sender_label`, `body_ciphertext`, `reply_to`, `client_id` (idempotent retries), `created_at`, `edited_at`, `deleted_at` |
| `chat_visitors` | visitor name, e-mail, phone of a visitor conversation (no client access: RPCs only) |

## Security

- **Reads**: RLS `SELECT` policies through `private.chat_can_read()`: real
  membership (`organization_members`, organization not archived), the second
  factor rule of the dashboard (`private.mfa_satisfied()`: aal2 once the user has
  a verified factor), and for direct conversations the participant row. They are
  what Supabase Realtime checks for each subscriber.
- **Writes**: no `INSERT` / `UPDATE` / `DELETE` grant on any chat table. Every
  change goes through a `SECURITY DEFINER` function with `search_path = ''`
  (`chat_send_message`, `chat_edit_message`, `chat_delete_message`,
  `chat_mark_read`, `chat_set_muted`, `chat_open_direct`,
  `chat_set_visitor_status`). Each one checks the session (`PT401`), the second
  factor, membership and role (`PT403`, or `PT404` without revealing whether a
  conversation exists), validates the text and rate-limits.
- **Validation** (database and app, same rules: `src/features/chat/lib/message-text.ts`,
  `private.check_text`): control, zero-width, bidi and Unicode-tag characters
  removed, 1 to 4,000 characters, HTML tags refused (`22023`). Messages are
  rendered as plain text; only `http(s)` URLs become links (`target=_blank`,
  `rel="noopener noreferrer nofollow"`). No `dangerouslySetInnerHTML`.
- **Rate limits**: 30 messages per minute per account (exact, per-sender
  advisory lock), 60 edits per minute, 30 new direct conversations per hour.
  `send_site_message`: 20 messages per hour per e-mail, 300 per hour per website.
- **Edit / delete**: only your own messages. Delete is soft: the encrypted body is
  wiped, the row stays so replies keep their place.
- **Visitor contact**: `chat_visitor_contact` (editor and above) returns the
  address for *Reply by email*; viewers get `j***@e***.com` in the list.
  *Reply by email* opens the mail app (`mailto:` with a validated address and a
  percent-encoded, header-safe subject; nothing can add recipients). The
  dashboard does not send it through Resend: the existing helper
  (`src/lib/email/notice.ts`) sends LevelUp-branded notices from the LevelUp
  domain with no `Reply-To`, which is not right for a client business answering
  its own customer.
- Visitor identity is **never verified** (anyone can type an e-mail address): the
  thread says so. A new message from the same address joins the open
  conversation of that website; resolved or archived conversations are not
  reopened.

### `send_site_message` (future chat widget)

`public.send_site_message(p_website_id, p_name, p_email, p_message, p_hp)`,
callable with the publishable key. Off by default: the website needs the
`site_chat` feature (LevelUp enables it). Same rules as `submit_form`: live
website, allowed origins (`private.assert_origin_allowed`), validation
(name 120, valid e-mail, message 4,000, no HTML), rate limits. `p_hp` is a
honeypot: when filled, the answer is `{ ok: true }` and nothing is stored. It
returns no ids.

## Encryption: what is and isn’t protected

| Layer | Status |
| --- | --- |
| In transit | **Yes.** TLS between the browser, Vercel, Supabase (REST and Realtime websockets). |
| At rest (disk) | **Yes.** Supabase encrypts the database storage and backups (AES-256). |
| Column level | **Yes, for message bodies.** `body_ciphertext` is `pgp_sym_encrypt` (pgcrypto, AES-256, no compression) with a 256-bit random key generated in the database and kept in **Supabase Vault** (`chat_message_key_v1`). The key is never in the repository, the app or `NEXT_PUBLIC_*`. Only the chat functions decrypt. Realtime payloads and direct `SELECT`s carry ciphertext only. |
| End-to-end | **No.** |

What the column encryption protects: a database dump or the daily backup
artifact (the Vault key is itself encrypted with the project root key, which is
not in dumps), people browsing tables in the dashboard or SQL editor, logs and
Realtime payloads. What it does **not** protect: anyone who can run SQL as the
`postgres` role on the live project (project owners, Supabase operations) can
decrypt through Vault, and the server decrypts every message it serves. The UI
therefore says "encrypted in transit and at rest", never "end-to-end encrypted".

Not encrypted at the column level: names, e-mails and phone numbers of visitors
(`chat_visitors`), conversation titles, timestamps, and the copy of contact form
messages that already lives in `form_submissions.message` (site inbox).

pgsodium transparent column encryption was not used: the extension is not
installed on the project and Supabase has deprecated it for new projects.

**Restoring a backup into another project**: chat bodies need the same key.
Before migrating, the owner exports it once from the SQL editor
(`select decrypted_secret from vault.decrypted_secrets where name = 'chat_message_key_v1'`),
keeps it in a password manager, and recreates it with `vault.create_secret`
in the new project. Never paste it in a ticket, a chat or a commit.

**Key rotation** (`body_key` column): create `chat_message_key_v2`, change
`private.chat_key(1)` calls to 2 for new writes, re-encrypt old rows in batches,
then retire v1.

### Roadmap to end-to-end encryption

1. Per-device key pairs (X25519) generated in the browser (WebCrypto), private
   key in IndexedDB as a non-extractable key, public keys in a `chat_device_keys`
   table.
2. Per-conversation symmetric key, wrapped for every member device; rewrap when
   a member joins or leaves (team channel churn makes this the hard part).
3. Messages encrypted in the browser (AES-GCM); the database stores ciphertext
   it cannot read. Server-side search, previews and the unread preview in the
   list go away (decrypt locally).
4. Key backup / new device enrollment (recovery code or approval from another
   device), and safety numbers to verify devices.
5. Visitor conversations stay server-readable (the visitor has no key).

## Realtime and unread counts

- `chat_messages` is in the `supabase_realtime` publication. The page subscribes
  to `postgres_changes` filtered by `organization_id`; RLS decides who receives
  what. An event only wakes the page: new messages are fetched with
  `chat_list_messages(p_after)`, an edit or delete with `chat_get_message`.
- Without a Realtime connection the page polls every 10 seconds (visible tab only).
- Unread = messages of others after `last_read_at` (team: after the join date),
  capped at 100 per conversation. The sidebar badge (`chat_unread_total`, muted
  and archived excluded) refreshes every minute and live on the chat page.
- Sending is optimistic (`client_id`): a failed message shows *Retry*, which
  resends with the same `client_id`, so the database never stores it twice.
- History: 40 messages per page, older pages load when scrolling up
  (`created_at, id` cursor).

## UI

`src/features/chat`: `api/` (types, service, queries), `lib/` (validation and
linkify, grouping, cache helpers, search params), `hooks/` (realtime, actions,
formatting), `components/`. URL state with nuqs: `?c=<conversation>&tab=all|team|direct|visitors`.
Keyboard: Enter sends, Shift+Enter adds a line, Escape cancels a reply or an
edit, ArrowUp in an empty composer edits your last message. On phones the list
and the thread are two screens (back button in the thread header).

## Tests

- `src/features/chat/lib/chat.test.ts` (`bun test`): body rules, linkify (no
  `javascript:` / `data:` links), mailto encoding and header injection, grouping,
  optimistic merge.
- `supabase/tests/chat.sql` (rolled back): team channel, encryption at rest,
  unread, cross-organization isolation (SELECT and RPCs), non-members, platform
  admins, anon, direct conversations, validation, edit/delete rules, no direct
  table writes, 30/min rate limit, aal2, contact form ingestion, viewer masking,
  notes, resolve, `send_site_message` (feature gate, honeypot, validation,
  20/hour limit), archived organization.
