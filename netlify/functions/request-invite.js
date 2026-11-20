// Netlify Function: someone asks for a Cunning Linguist account.
// Accounts are invite-only. The request is saved to cl_invite_requests on the
// CannonCodeConnect Supabase project (insert-only for the public), and Jimmy gets a notice.

const ALLOWED_ORIGINS = new Set([
  "https://apps.cannoncodeconnect.com",
  "https://cunninglinguist.netlify.app"
]);

const SB_URL  = "https://azkyohtmhlvnkziuvgvk.supabase.co";
const SB_ANON = "sb_publishable_C4F7zGYkDVm9hP5hxMRvLg_ral9g3y1";
const NOTIFY_TO = "jimmy@cannoncodeconnect.com";
const NOTIFY_FROM = "Cunning Linguist <noreply@cannoncodeconnect.com>";

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export default async (req) => {
  if (!ALLOWED_ORIGINS.has(req.headers.get("origin") || "")) return json(403, { error: "Forbidden" });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request" }); }

  // Honeypot: a hidden field people never fill. Pretend it worked.
  if (body?.website) return json(200, { ok: true });

  const email = (body?.email || "").toString().trim().toLowerCase().slice(0, 254);
  const name  = (body?.name  || "").toString().trim().slice(0, 120) || null;
  const note  = (body?.note  || "").toString().trim().slice(0, 1000) || null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Enter a valid email address." });

  const res = await fetch(`${SB_URL}/rest/v1/cl_invite_requests`, {
    method: "POST",
    headers: {
      apikey: SB_ANON,
      "content-type": "application/json",
      prefer: "return=minimal"
    },
    body: JSON.stringify({ email, name, note })
  });

  if (res.status === 409) return json(200, { ok: true, already: true });
  if (!res.ok) {
    console.warn("request-invite: insert failed", res.status);
    return json(502, { error: "Couldn't send your request. Try again in a minute." });
  }

  const key = process.env.CL_RESEND_API_KEY;
  if (key) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: NOTIFY_FROM,
          to: [NOTIFY_TO],
          reply_to: email,
          subject: `Cunning Linguist invite request: ${email}`,
          html: `<p><b>${esc(name || "(no name)")}</b> &lt;${esc(email)}&gt; asked for a Cunning Linguist account.</p>` +
                (note ? `<p>${esc(note)}</p>` : "") +
                `<p>Say "invite ${esc(email)} to Cunning Linguist" to send the invite.</p>`
        })
      });
    } catch (e) {
      console.warn("request-invite: notice failed");
    }
  }

  return json(200, { ok: true });
};

export const config = {
  path: ["/api/request-invite", "/cunninglinguist/api/request-invite"]
};
