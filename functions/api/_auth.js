// EDWISE Pinar preview authentication. Both initial accounts have equal administrator access.
async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}
function authError(message, status) {
  return { admin: null, response: Response.json({ success: false, message }, { status, headers: { "Cache-Control": "no-store" } }) };
}
export async function requireAdmin(context) {
  const db = context.env["edwise-deneme"];
  if (!db) return authError("Önizleme yönetici veritabanı bağlantısı bulunamadı.", 503);
  const token = getCookie(context.request, "edwise_session");
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return authError("Oturum açmanız gerekiyor.", 401);
  const tokenHash = await hashToken(token);
  const admin = await db.prepare(`
    SELECT a.id, a.username, a.email, a.role
    FROM admin_sessions s INNER JOIN admins a ON a.id = s.admin_id
    WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now') AND a.is_active = 1
    LIMIT 1
  `).bind(tokenHash).first();
  if (!admin) return authError("Oturum geçersiz veya süresi dolmuş.", 401);
  return { admin, response: null };
}
export async function requireSuperAdmin(context) {
  return requireAdmin(context);
}
export async function requireEditor(context) {
  return requireAdmin(context);
}
export async function requirePermission(context) {
  return requireAdmin(context);
}
