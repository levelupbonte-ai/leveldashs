/*!
 * LevelUp Forms embed — shows a LevelUp form inside any website.
 *
 *   <div data-lu-embed="fxxxxxxxxxx"></div>
 *   <script src="https://dashboard.levelup-ecosystem.com/forms/embed.js" async></script>
 *
 * The form runs on LevelUp's secure page inside an iframe: answers, files and
 * the anti-spam checks never touch the host page. Only the sites the form's
 * owner allows can show it. The iframe follows the form's height, and the
 * host page goes to the thank-you page when the owner set one.
 */
(function () {
  'use strict';
  var ORIGIN = 'https://dashboard.levelup-ecosystem.com';
  var ID = /^f[a-z0-9]{10}$/;
  var frames = {};

  function mount(el) {
    if (!el || el.__luEmbed) return;
    var id = String(el.getAttribute('data-lu-embed') || '').trim();
    if (!ID.test(id)) return;
    el.__luEmbed = true;
    var frame = document.createElement('iframe');
    frame.src = ORIGIN + '/f/' + id + '/embed';
    frame.title = el.getAttribute('data-lu-title') || 'Form';
    frame.loading = 'lazy';
    frame.style.cssText =
      'display:block;width:100%;border:0;min-height:320px;height:640px;background:transparent;color-scheme:normal';
    el.appendChild(frame);
    (frames[id] = frames[id] || []).push(frame);
  }

  function scan(root) {
    var list = (root || document).querySelectorAll('[data-lu-embed]');
    for (var i = 0; i < list.length; i++) mount(list[i]);
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== ORIGIN) return;
    var data = event.data;
    if (!data || data.source !== 'levelup-form' || !ID.test(String(data.form))) return;
    var list = frames[data.form] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].contentWindow !== event.source) continue;
      if (data.type === 'height' && typeof data.height === 'number' && data.height > 0) {
        list[i].style.height = Math.min(Math.ceil(data.height) + 4, 20000) + 'px';
      }
      if (
        data.type === 'sent' &&
        typeof data.redirect === 'string' &&
        /^https:\/\/[^\s<>"'`]+$/.test(data.redirect)
      ) {
        window.location.assign(data.redirect);
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      scan();
    });
  } else {
    scan();
  }
  // Pages that add the placeholder later (single-page apps).
  var queued = false;
  if (window.MutationObserver) {
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      (window.requestAnimationFrame || setTimeout)(function () {
        queued = false;
        scan();
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  window.LevelUpForms = { mount: mount, scan: scan };
})();
