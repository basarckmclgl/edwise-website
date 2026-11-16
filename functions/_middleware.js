import { requireAdmin } from "./api/_auth.js";
// Apply baseline browser security headers and honor the maintenance switch.
const MAINTENANCE_HTML = "<!doctype html><html lang=\"tr\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>EDWISE | Bakım Çalışması</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#190d27;color:#fff;font:16px/1.6 Arial,sans-serif;text-align:center}.card{max-width:560px;padding:40px 28px}h1{font-size:clamp(28px,6vw,42px);margin:0 0 12px}p{color:#d9cce7}</style><main class=\"card\"><h1>EDWISE kısa bir bakım molasında</h1><p>Web sitemizde planlı bir çalışma yürütüyoruz. Kısa süre içinde yeniden hizmetinizde olacağız.</p></main></html>";
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;
  // Static assets bypass application middleware entirely.
  if (path.startsWith("/assets/") || path.startsWith("/media/") || /\\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|map)$/i.test(path)) {
    return context.next();
  }
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
  // Search engines must not index temporary Preview deployments.
  if (url.hostname === "yonetim-paneli.edwise.pages.dev") headers.set("X-Robots-Tag", "noindex, nofollow");
  if (path.startsWith("/api/") || isAdminEntry || isPanelPage || isLoginPage) {
    headers.set("Cache-Control", "no-store, max-age=0");
    headers.set("Pragma", "no-cache");
  }
  if (isAdminEntry || isPanelPage || isLoginPage) headers.set("X-Robots-Tag", "noindex, nofollow");
  // Preview SEO: page-specific metadata for homepage, static pages and published CMS pages.
  const isPreview = url.hostname === "yonetim-paneli.edwise.pages.dev";
  const isPublicHtml = !path.startsWith("/api/") && !isPanelPage && !isLoginPage &&
    response.ok && (headers.get("Content-Type") || "").includes("text/html");
  if (isPreview && path === "/sitemap.xml") {
    try {
      const db = context.env.DB;
      if (db) {
        const published = await db.prepare("SELECT slug, updated_at FROM pages WHERE status='published' AND deleted_at IS NULL AND page_path IS NULL ORDER BY updated_at DESC").all();
        const staticPaths = [
          "/", "/pages/basvuru.html", "/pages/coaching-mentoring.html",
          "/pages/egitim-danismanligi.html", "/pages/hakkimizda.html",
          "/pages/hizmetlerimiz.html", "/pages/ielts.html", "/pages/iletisim.html",
          "/pages/speaking-club.html", "/pages/toefl.html",
          "/pages/yasal-bilgilendirme.html", "/pages/yds.html", "/pages/yokdil.html"
        ];
        const urls = staticPaths.map(p => ({loc:"https://edwisedanismanlik.com" + p}));
        for (const page of (published.results || [])) {
          if (page.slug) urls.push({loc:"https://edwisedanismanlik.com/pages/sayfa.html?slug=" + encodeURIComponent(page.slug), lastmod:page.updated_at});
        }
        const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
          urls.map(item => '<url><loc>' + item.loc.replace(/&/g, '&amp;') + '</loc>' +
            (item.lastmod ? '<lastmod>' + new Date(item.lastmod).toISOString().slice(0,10) + '</lastmod>' : '') +
            '</url>').join('') + '</urlset>';
        headers.set("Content-Type","application/xml; charset=utf-8");
        headers.set("Cache-Control","public, max-age=300");
        return new Response(xml,{status:200,headers});
      }
    } catch (error) {
      console.error("Preview sitemap could not be generated; serving repository sitemap.",error);
    }
  }
  if (isPreview && isPublicHtml) {
    try {
      const seoDb = context.env["edwise-deneme"];
      let settings = {};
      if (seoDb) {
        const row = await seoDb.prepare("SELECT settings_json FROM seo_settings WHERE id=1").first();
        settings = JSON.parse(row?.settings_json || "{}");
      }
      let pageSeo = null;
      if (path === "/pages/sayfa.html") {
        const slug = url.searchParams.get("slug");
        if (slug && context.env.DB) {
          pageSeo = await context.env.DB.prepare(
            "SELECT title, slug, meta_title, meta_description FROM pages WHERE slug=? AND status='published' AND deleted_at IS NULL LIMIT 1"
          ).bind(slug).first();
        }
      }
      const isHome = path === "/" || path === "/index.html";
      const title = String(pageSeo?.meta_title || (pageSeo?.title ? pageSeo.title + " | EDWISE" : (isHome ? settings.seoTitle : ""))).slice(0,200);
      const description = String(pageSeo?.meta_description || (isHome ? settings.seoDescription : "")).slice(0,500);
      const canonicalPath = path === "/index.html" ? "/" : path;
      const canonical = pageSeo
        ? "https://edwisedanismanlik.com/pages/sayfa.html?slug=" + encodeURIComponent(pageSeo.slug)
        : "https://edwisedanismanlik.com" + canonicalPath;
      const robots = isHome && settings.seoRobots ? String(settings.seoRobots) : "";
      const ogTitle = String((isHome && settings.seoOgTitle) || title || "").slice(0,200);
      const ogDescription = String((isHome && settings.seoOgDescription) || description || "").slice(0,500);
      const ogImage = String(isHome ? (settings.seoOgImage || "") : "").slice(0,500);
      const verification = String(isHome ? (settings.seoGsc || "") : "").slice(0,300);
      const keywords = String(isHome ? (settings.seoKeywords || "") : "").slice(0,300);
      const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
      const rewrite = new HTMLRewriter();
      if (title) rewrite.on("title",{element(el){el.setInnerContent(title);}});
      if (description) rewrite.on('meta[name="description"]',{element(el){el.setAttribute("content",description);}});
      rewrite.on('link[rel="canonical"]',{element(el){el.setAttribute("href",canonical);}});
      if (robots) rewrite.on('meta[name="robots"]',{element(el){el.setAttribute("content",robots);}});
      if (ogTitle) rewrite.on('meta[property="og:title"]',{element(el){el.setAttribute("content",ogTitle);}});
      if (ogDescription) rewrite.on('meta[property="og:description"]',{element(el){el.setAttribute("content",ogDescription);}});
      rewrite.on('meta[property="og:url"]',{element(el){el.setAttribute("content",canonical);}});
      if (ogImage) rewrite.on('meta[property="og:image"]',{element(el){el.setAttribute("content",ogImage);}});
      if (ogTitle) rewrite.on('meta[name="twitter:title"]',{element(el){el.setAttribute("content",ogTitle);}});
      if (ogDescription) rewrite.on('meta[name="twitter:description"]',{element(el){el.setAttribute("content",ogDescription);}});
      if (ogImage) rewrite.on('meta[name="twitter:image"]',{element(el){el.setAttribute("content",ogImage);}});
      if (verification) rewrite.on('meta[name="google-site-verification"]',{element(el){el.setAttribute("content",verification);}});
      if (keywords) rewrite.on('meta[name="keywords"]',{element(el){el.setAttribute("content",keywords);}});
      // CMS pages are rendered server-side for crawlers; the client renderer remains unchanged.
      return rewrite.transform(new Response(response.body,{status:response.status,statusText:response.statusText,headers}));
    } catch (error) {
      console.error("Preview page SEO could not be applied; serving original HTML.",error);
    }
  }
  // GA4 ID is exposed to the consent script on Preview pages only.
  if (url.hostname === "yonetim-paneli.edwise.pages.dev" && response.ok && (headers.get("Content-Type")||"").includes("text/html")) {
    try {
      const seoDb = context.env["edwise-deneme"];
      const row = seoDb ? await seoDb.prepare("SELECT settings_json FROM seo_settings WHERE id=1").first() : null;
      const settings = JSON.parse(row?.settings_json || "{}");
      const gaId = String(settings.seoGaId || "").trim();
      if (gaId && /^G-[A-Z0-9]+$/.test(gaId)) {
        const gaRewrite = new HTMLRewriter().on("head", {
          element(el) { el.append('<meta name="edwise-ga4-id" content="' + gaId + '">', {html:true}); }
        });
        return gaRewrite.transform(new Response(response.body, {status:response.status,statusText:response.statusText,headers}));
      }
    } catch (error) {
      console.error("Preview GA4 setting could not be exposed; serving current HTML.", error);
    }
  }
    return new Response(response.body, {status:response.status,statusText:response.statusText,headers});
}