import { requireAdmin } from "./api/_auth.js";
// Apply baseline browser security headers and honor the maintenance switch.
const MAINTENANCE_HTML = "<!doctype html><html lang=\"tr\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>EDWISE | Bakım Çalışması</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#190d27;color:#fff;font:16px/1.6 Arial,sans-serif;text-align:center}.card{max-width:560px;padding:40px 28px}h1{font-size:clamp(28px,6vw,42px);margin:0 0 12px}p{color:#d9cce7}</style><main class=\"card\"><h1>EDWISE kısa bir bakım molasında</h1><p>Web sitemizde planlı bir çalışma yürütüyoruz. Kısa süre içinde yeniden hizmetinizde olacağız.</p></main></html>";
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;
  // Serve the management panel at /admin without changing the browser URL.
  // Only the exact entry routes are mapped; unknown /admin/* paths remain unavailable.
  const isAdminEntry = path === "/admin" || path === "/admin/";
  const isLoginPage = path === "/yonetim/giris.html";
  const isPanelPage = path === "/yonetim" || (path.startsWith("/yonetim/") && !isLoginPage);

  // The login document must always be served as a public static asset.
  // Bypass every auth/maintenance redirect for this exact path.
  if (isLoginPage) {
    const loginResponse = await context.next();
    const loginHeaders = new Headers(loginResponse.headers);
    loginHeaders.set("Cache-Control", "no-store, max-age=0");
    loginHeaders.set("Pragma", "no-cache");
    loginHeaders.set("X-Robots-Tag", "noindex, nofollow");
    loginHeaders.set("X-Content-Type-Options", "nosniff");
    loginHeaders.set("X-Frame-Options", "SAMEORIGIN");
    return new Response(loginResponse.body, {status:loginResponse.status,statusText:loginResponse.statusText,headers:loginHeaders});
  }

  // /admin is only an entry alias. Always send it to the real login
  // page; the login page then sends authenticated users to the panel.
  if (isAdminEntry) {
    return Response.redirect(new URL("/yonetim/giris.html?next=%2Fyonetim%2F", url), 302);
  }
  if (isPanelPage && !isLoginPage) {
    const auth = await requireAdmin(context);
    if (auth.response) {
      return Response.redirect(new URL("/yonetim/giris.html?next=" + encodeURIComponent(path + url.search), url), 302);
    }
  }
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
  // Use a browser redirect instead of an internal rewrite. Rewriting /admin
  // to /yonetim/ can re-enter this middleware and create a redirect loop.
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
  if (path.startsWith("/api/") || isAdminEntry || isPanelPage || isLoginPage) {
    headers.set("Cache-Control", "no-store, max-age=0");
    headers.set("Pragma", "no-cache");
  }
  if (isAdminEntry || isPanelPage || isLoginPage) headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, {status:response.status,statusText:response.statusText,headers});
}