// Invite requests. Accounts are invite-only; this posts to /cunninglinguist/api/request-invite.
(function () {
  window.cllRequestInvite = async function ({ email, name, note, website }) {
    try {
      const r = await fetch('/cunninglinguist/api/request-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name, note, website })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return { error: d.error || "Couldn't send your request. Try again in a minute." };
      return { ok: true };
    } catch (e) {
      return { error: "Couldn't reach the server. Check your connection and try again." };
    }
  };

  // Home page form, if present.
  function bind() {
    const form = document.getElementById('invite-form');
    if (!form) return;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const msg = document.getElementById('invite-msg');
      const btn = form.querySelector('button[type=submit]');
      const email = form.email.value.trim();
      if (!email) { msg.textContent = 'Enter your email.'; return; }
      btn.disabled = true;
      msg.className = 'invite-msg';
      msg.textContent = 'Sending…';
      const r = await window.cllRequestInvite({ email, name: form.name.value.trim(), website: form.website.value });
      btn.disabled = false;
      if (r.error) { msg.textContent = r.error; return; }
      msg.className = 'invite-msg ok';
      msg.textContent = "✓ Got it. We'll email you an invite.";
      form.reset();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
