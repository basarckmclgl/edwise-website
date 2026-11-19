// Apply baseline browser security headers, block the retired admin interface, and honor the maintenance switch.
const MAINTENANCE_HTML = "<!doctype html><html lang=\"tr\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>EDWISE | Bakım Çalışması</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#190d27;color:#fff;font:16px/1.6 Arial,sans-serif;text-align:center}.card{max-width:560px;padding:40px 28px}h1{font-size:clamp(28px,6vw,42px);margin:0 0 12px}p{color:#d9cce7}</style><main class=\"card\"><h1>EDWISE kısa bir bakım molasında</h1><p>Web sitemizde planlı bir çalışma yürütüyoruz. Kısa süre içinde yeniden hizmetinizde olacağız.</p></main></html>";
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;
  // Require a valid preview admin session before serving any management page.
  // The login page remains public; API handlers continue enforcing their own permissions.
  const isPublicAuthPage = /^\/yonetim\/(?:giris|sifre-sifirla)(?:\.html)?\/?$/.test(path);
  // Support extensionless login/reset URLs used by shared mobile links.
  const authPageAlias = path.match(/^\/yonetim\/(giris|sifre-sifirla)\/?$/);
  if (authPageAlias) {
    const target = new URL(`/yonetim/${authPageAlias[1]}.html${url.search}`, url.origin);
    return new Response(null, {
      status: 302,
      headers: {
        "Location": target.toString(),
        "Cache-Control": "no-store, max-age=0",
        "Pragma": "no-cache"
      }
    });
  }
  if ((path.startsWith("/yonetim/") && !isPublicAuthPage) || path === "/yonetim" || path === "/admin" || path === "/admin/") {
    const cookie = context.request.headers.get("Cookie") || "";
    const match = cookie.match(/(?:^|;\s*)edwise_session=([^;]*)/);
    let authorized = false;
    const previewDb = context.env["edwise-deneme"];
    if (match && previewDb) {
      try {
        const token = decodeURIComponent(match[1]);
        if (/^[a-f0-9]{64}$/i.test(token)) {
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
          const tokenHash = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
          const session = await previewDb.prepare(`
            SELECT s.id
            FROM admin_sessions s
            INNER JOIN admins a ON a.id = s.admin_id
            WHERE s.token_hash = ?
              AND datetime(s.expires_at) > datetime('now')
              AND a.is_active = 1
            LIMIT 1
          `).bind(tokenHash).first();
          authorized = Boolean(session);
        }
      } catch (error) {
        console.error("EDWISE preview page authentication failed:", error);
      }
    }
    if (!authorized) {
      const login = new URL("/yonetim/giris.html", url.origin);
      login.searchParams.set("next", path + url.search);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": login.toString(),
          "Cache-Control": "no-store, max-age=0",
          "Pragma": "no-cache"
        }
      });
    }
  }
  // Serve the management panel at /admin without changing the browser URL.
  // Only the exact entry routes are mapped; unknown /admin/* paths remain unavailable.
  const isAdminEntry = path === "/admin" || path === "/admin/";
  if (path.startsWith("/admin/") && !isAdminEntry) {
    return new Response("Not Found", {status:404,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store, max-age=0","X-Content-Type-Options":"nosniff"}});
  }
  if (!path.startsWith("/api/") && context.env.DB) {
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
  const response = isAdminEntry
    ? await context.next(new Request(new URL("/yonetim/" + url.search, url), context.request))
    : await context.next();
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  headers.set("X-DNS-Prefetch-Control", "off");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if (path.startsWith("/api/") || isAdminEntry) {
    headers.set("Cache-Control", "no-store, max-age=0");
    headers.set("Pragma", "no-cache");
  }
  if (isAdminEntry) headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, {status:response.status,statusText:response.statusText,headers});
}