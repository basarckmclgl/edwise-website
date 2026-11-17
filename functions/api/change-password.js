import { requireAdmin } from "./_auth.js";
import { logAudit } from "./_audit.js";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return `pbkdf2$100000$${toHex(salt)}$${toHex(derived)}`;
}

async function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2" || Number(parts[1]) !== 100000 ||
      !/^[0-9a-f]{32}$/i.test(parts[2]) || !/^[0-9a-f]{64}$/i.test(parts[3])) return false;
  const salt = new Uint8Array(parts[2].match(/.{2}/g).map(x => parseInt(x, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256
  );
  const actual = toHex(derived);
  let diff = actual.length ^ parts[3].length;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ parts[3].charCodeAt(i);
  return diff === 0;
}

async function hashToken(token) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env["edwise-deneme"];
  if (!db) return json({ success: false, message: "Önizleme veritabanı bağlantısı bulunamadı." }, 503);
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return json({ success: false, message: "İstek kaynağı geçersiz." }, 403);
  }

  try {
    const auth = await requireAdmin(context);
    if (auth.response) return auth.response;

    const cookie = request.headers.get("Cookie") || "";
    const match = cookie.match(/(?:^|;\\s*)edwise_session=([a-f0-9]{64})(?:;|$)/i);
    if (!match) return json({ success: false, message: "Oturum doğrulanamadı. Yeniden giriş yapın." }, 401);

    const body = await request.json();
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (!currentPassword || currentPassword.length > 128) {
      return json({ success: false, message: "Mevcut şifrenizi kontrol edin." }, 400);
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return json({ success: false, message: "Yeni şifre 8–128 karakter arasında olmalıdır." }, 400);
    }
    if (currentPassword === newPassword) {
      return json({ success: false, message: "Yeni şifreniz mevcut şifrenizden farklı olmalıdır." }, 400);
    }

    const admin = await db.prepare(
      "SELECT id, username, password_hash FROM admins WHERE id = ? AND is_active = 1 LIMIT 1"
    ).bind(auth.admin.id).first();
    if (!admin || !(await verifyPassword(currentPassword, admin.password_hash))) {
      return json({ success: false, message: "Mevcut şifreniz hatalı." }, 401);
    }

    const newHash = await hashPassword(newPassword);
    await db.prepare(
      "UPDATE admins SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(newHash, admin.id).run();

    const currentTokenHash = await hashToken(match[1]);
    await db.prepare(
      "DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash <> ?"
    ).bind(admin.id, currentTokenHash).run();

    await logAudit(db, request, auth.admin, {
      action: "password_changed",
      entity_type: "admin",
      entity_id: admin.id,
      entity_title: admin.username,
      details: { sessions_revoked: true }
    });

    return json({
      success: true,
      message: "Şifreniz güncellendi. Diğer cihazlardaki oturumlarınız güvenlik için kapatıldı."
    });
  } catch (error) {
    console.error("EDWISE PASSWORD CHANGE ERROR:", error);
    return json({ success: false, message: "Şifre güncellenirken sunucu hatası oluştu." }, 500);
  }
}
