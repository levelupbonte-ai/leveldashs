// Code samples shown on the Developers page (code, not prose: not translated).

export const TAG_URL = 'https://levelup-ecosystem.com/sdk/v1/levelup.js';

export const tagSnippet = (siteId: string) =>
  `<script src="${TAG_URL}" data-site="${siteId}" defer></script>`;

export const nextScriptSnippet = (siteId: string) => `import Script from 'next/script';

// app/layout.tsx
<Script src="${TAG_URL}" data-site="${siteId}" strategy="afterInteractive" />`;

export const tagOptionsSnippet = (siteId: string) =>
  `<script src="${TAG_URL}" data-site="${siteId}"
  data-seo="off" data-forms="off" data-analytics="off" defer></script>`;

export const FORM_SNIPPET = `<form data-lu-form="contact">
  <input name="name" required>
  <input name="email" type="email" required>
  <textarea name="message"></textarea>
  <input name="_hp" style="display:none" tabindex="-1" autocomplete="off">
  <button type="submit">Send</button>
  <p data-lu-status></p>
</form>`;

export const CONTENT_SNIPPET = `<span data-lu="settings.contact.address"></span>
<img data-lu="settings.branding.logo_url" data-lu-attr="src" alt="Logo">
<footer><span data-lu-badge></span></footer>`;

export const JS_API_SNIPPET = `const site = await LevelUp.ready;

await LevelUp.submitForm('quote', { name, email, message, budget: '5k' });
await LevelUp.bookAppointment({
  service: 'haircut', date: '2026-11-12', time: '10:00', name, email
});
await LevelUp.joinWaitlist({ name, phone });
const queue = await LevelUp.waitlist();
const ticket = await LevelUp.ticketStatus('FS-ABCD1234');

document.addEventListener('levelup:ready', (event) => {
  console.log(event.detail.services);
});`;

export const envSnippet = (endpoint: string, publicKey: string) =>
  `LEVELUP_API_URL=${endpoint}
LEVELUP_PUBLIC_KEY=${publicKey}
LEVELUP_SITE_KEY=lu_live_...`;

export const CURL_SNIPPET = (endpoint: string) => `curl -X POST '${endpoint}' \\
  -H "apikey: $LEVELUP_PUBLIC_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "p_key": "'"$LEVELUP_SITE_KEY"'", "p_event": { ... } }'`;
