import { requireAdmin } from "./_auth.js";

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

async function getTokenHash(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\\s*)edwise_session=([a-f0-9]{64})(?:;|$)/i);
  if (!match) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(match[1]));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return json({ success: false, message: "İstek kaynağı geçersiz." }, 403);
  const auth = await requireAdmin(context);
  if (auth.response) return auth.response;
  const tokenHash = await getTokenHash(request);
  if (!tokenHash) return json({ success: false, message: "Oturum bulunamadı." }, 401);
  try {
    const body = await request.json();
    if (body.active === true) {
      const result = await env.DB.prepare("UPDATE admin_sessions SET work_started_at=COALESCE(work_started_at,datetime('now')), grace_until=COALESCE(grace_until,datetime(expires_at, '+15 minutes')) WHERE token_hash=? AND datetime(expires_at)>datetime('now')").bind(tokenHash).run();
      if (!result.meta?.changes) return json({ success: false, message: "Oturum süresi dolmuş." }, 401);
      return json({ success: true, workInProgress: true });
    }
    await env.DB.prepare("UPDATE admin_sessions SET work_started_at=NULL,grace_until=NULL WHERE token_hash=?").bind(tokenHash).run();
    const row = await env.DB.prepare("SELECT expires_at FROM admin_sessions WHERE token_hash=?").bind(tokenHash).first();
    if (!row || Date.parse(row.expires_at) <= Date.now()) {
      await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(tokenHash).run();
      return json({ success: false, authenticated: false, message: "Oturum süresi doldu. Yeniden giriş yapın." }, 401);
    }
    return json({ success: true, workInProgress: false });
  } catch (error) {
    console.error("EDWISE SESSION WORK ERROR:", error);
    return json({ success: false, message: "İşlem durumu kaydedilemedi." }, 500);
  }
}
