// Baseline browser security headers, maintenance switch, and admin-page session gate.
const MAINTENANCE_HTML = "<!doctype html><html lang=\"tr\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>EDWISE | Bakım Çalışması</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#190d27;color:#fff;font:16px/1.6 Arial,sans-serif;text-align:center}.card{max-width:560px;padding:40px 28px}h1{font-size:clamp(28px,6vw,42px);margin:0 0 12px}p{color:#d9cce7}</style><main class=\"card\"><h1>EDWISE kısa bir bakım molasında</h1><p>Web sitemizde planlı bir çalışma yürütüyoruz. Kısa süre içinde yeniden hizmetinizde olacağız.</p></main></html>";
function getSessionToken(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)edwise_session=([a-f0-9]{64})(?:;|$)/i);
  return match ? match[1] : null;
}
async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function hasValidAdminSession(request, env) {
  if (!env.DB) return false;
  const token = getSessionToken(request);
  if (!token) return false;
  const tokenHash = await hashToken(token);
  const admin = await env.DB.prepare(`
    SELECT a.id
    FROM admin_sessions s
    INNER JOIN admins a ON a.id = s.admin_id
    WHERE s.token_hash = ?
      AND datetime(s.expires_at) > datetime('now')
      AND a.is_active = 1
    LIMIT 1
  `).bind(tokenHash).first();
  return !!admin;
}
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;

  // The login screen and its static assets remain reachable without a session.
  const isAdminPath = path === "/admin" || path.startsWith("/admin/");
  const isLoginPage = path === "/admin/" || path === "/admin/index.html";
  const isAdminAsset = path.startsWith("/admin/assets/");
  if (isAdminPath && !isLoginPage && !isAdminAsset) {
    try {
      if (!(await hasValidAdminSession(context.request, context.env))) {
        const target = new URL("/admin/", url.origin);
        return Response.redirect(target.toString(), 302);
      }
    } catch (error) {
      console.error("EDWISE ADMIN SESSION CHECK FAILED:", error);
      return new Response("Yönetim oturumu şu anda doğrulanamıyor. Lütfen tekrar deneyin.", {
        status: 503,
        headers: {"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store, max-age=0"}
      });
    }
  }

  if (!path.startsWith("/admin") && !path.startsWith("/api/") && context.env.DB) {
    try {
      const row = await context.env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='site_status' LIMIT 1").first();
      let status = "online";
      try { status = JSON.parse(row?.setting_value || "\"online\""); } catch {}
      if (status === "maintenance") {
        return new Response(MAINTENANCE_HTML, {status:503,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store, max-age=0","Retry-After":"300","X-Content-Type-Options":"nosniff","X-Frame-Options":"SAMEORIGIN","Referrer-Policy":"strict-origin-when-cross-origin","Permissions-Policy":"camera=(), microphone=(), geolocation=()","Strict-Transport-Security":"max-age=31536000; includeSubDomains"}});
      }
    } catch (error) {
      console.error("EDWISE maintenance status check failed; public site remains available.", error);
    }
  }
  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  headers.set("X-DNS-Prefetch-Control", "off");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if (path.startsWith("/api/")) {
    headers.set("Cache-Control", "no-store, max-age=0");
    headers.set("Pragma", "no-cache");
  }
  return new Response(response.body, {status:response.status,statusText:response.statusText,headers});
}
