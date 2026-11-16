import { requireAdmin } from "./_auth.js";

const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
async function getToken(request) {
  const cookie = request.headers.get("Cookie") || "";
  const pair = cookie.split(";").map(value => value.trim()).find(value => value.startsWith("edwise_session="));
  const token = pair ? pair.slice("edwise_session=".length) : "";
  return /^[a-f0-9]{64}$/i.test(token) ? token : null;
}
async function signWork(token, expiry) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(expiry)));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return json({ success: false, message: "İstek kaynağı geçersiz." }, 403);
  const auth = await requireAdmin(context);
  if (auth.response) return auth.response;
  const token = await getToken(request);
  if (!token) return json({ success: false, message: "Oturum bulunamadı." }, 401);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  try {
    const body = await request.json();
    const row = await env.DB.prepare("SELECT expires_at FROM admin_sessions WHERE token_hash=? AND admin_id=?").bind(tokenHash, auth.admin.id).first();
    if (!row) return json({ success: false, message: "Oturum bulunamadı." }, 401);
    const expiry = Date.parse(row.expires_at);
    if (body.active === true) {
      if (!Number.isFinite(expiry) || Date.now() >= expiry) return json({ success: false, message: "Oturum süresi doldu." }, 401);
      const signature = await signWork(token, expiry);
      const maxAge = Math.max(0, Math.ceil((expiry + 15 * 60 * 1000 - Date.now()) / 1000));
      const cookie = "edwise_work=" + expiry + "." + signature + "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" + maxAge;
      return json({ success: true, workInProgress: true }, 200, { "Set-Cookie": cookie });
    }
    const expired = !Number.isFinite(expiry) || Date.now() >= expiry;
    if (expired) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(tokenHash).run();
    const clearCookie = "edwise_work=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
    return json({ success: !expired, authenticated: !expired, workInProgress: false, message: expired ? "Oturum süresi doldu. Yeniden giriş yapın." : "İşlem tamamlandı." }, expired ? 401 : 200, { "Set-Cookie": clearCookie });
  } catch (error) {
    console.error("EDWISE SESSION WORK ERROR:", error);
    return json({ success: false, message: "İşlem durumu kaydedilemedi." }, 500);
  }
}
