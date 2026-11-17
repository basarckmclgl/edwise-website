import { requirePermission } from "../../_auth.js";

const PREVIEW = "onizleme.edwise.pages.dev";
const REDIRECT_URI = "https://onizleme.edwise.pages.dev/api/seo/google/callback";
const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
async function sha(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (url.hostname !== PREVIEW) return json({ success: false, message: "Bu OAuth dönüş adresi yalnızca önizleme ortamında kullanılabilir." }, 404);

  const db = env["edwise-deneme"];
  if (!db) return json({ success: false, message: "Önizleme veritabanı bağlantısı bulunamadı." }, 503);

  const error = url.searchParams.get("error");
  if (error) return Response.redirect("https://" + PREVIEW + "/yonetim/?seo_google=denied", 302);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return json({ success: false, message: "Google dönüşünde yetkilendirme kodu veya güvenlik bilgisi eksik." }, 400);

  try {
    const stateHash = await sha(state);
    const stateRow = await db.prepare("SELECT state_hash FROM seo_google_oauth_state WHERE state_hash = ? AND created_at >= datetime('now','-10 minutes')").bind(stateHash).first();
    if (!stateRow) return json({ success: false, message: "Google bağlantı isteğinin süresi dolmuş veya güvenlik doğrulaması başarısız." }, 400);
    await db.prepare("DELETE FROM seo_google_oauth_state WHERE state_hash = ?").bind(stateHash).run();

    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
      return json({ success: false, message: "Google OAuth Client ID veya Client Secret önizleme ortamında tanımlı değil." }, 503);
    }
    if (!env.SEO_TOKEN_ENCRYPTION_KEY) return json({ success: false, message: "SEO_TOKEN_ENCRYPTION_KEY önizleme ortamında tanımlı değil." }, 503);

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code"
      })
    });
    const tokens = await response.json();
    if (!response.ok || !tokens.access_token) {
      return json({ success: false, message: "Google yetkilendirme kodu token'a dönüştürülemedi: " + (tokens.error_description || tokens.error || "Bilinmeyen hata") }, 400);
    }

    let refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      const existing = await db.prepare("SELECT encrypted_refresh_token, iv FROM seo_google_tokens WHERE id = 1").first().catch(() => null);
      if (!existing) return json({ success: false, message: "Google yenileme anahtarı göndermedi. Bağlantıyı yeniden başlatıp Google izin ekranında erişime izin ver." }, 400);
      return Response.redirect("https://" + PREVIEW + "/yonetim/?seo_google=connected", 302);
    }

    const rawKey = fromBase64(env.SEO_TOKEN_ENCRYPTION_KEY);
    if (rawKey.byteLength !== 32) return json({ success: false, message: "SEO_TOKEN_ENCRYPTION_KEY 32 byte Base64 anahtar olmalıdır." }, 503);
    const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(refreshToken));

    await db.prepare(`CREATE TABLE IF NOT EXISTS seo_google_tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      encrypted_refresh_token TEXT NOT NULL,
      iv TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    await db.prepare(`INSERT INTO seo_google_tokens (id, encrypted_refresh_token, iv, updated_at)
      VALUES (1, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET encrypted_refresh_token = excluded.encrypted_refresh_token, iv = excluded.iv, updated_at = datetime('now')`)
      .bind(toBase64(new Uint8Array(encrypted)), toBase64(iv)).run();

    return Response.redirect("https://" + PREVIEW + "/yonetim/?seo_google=connected", 302);
  } catch (error) {
    return json({ success: false, message: error?.message || "Google bağlantısı tamamlanamadı." }, 500);
  }
}
