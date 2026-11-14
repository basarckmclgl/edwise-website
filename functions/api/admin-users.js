import { requireSuperAdmin } from "./_auth.js";

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  const hex = bytes => Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return "pbkdf2$100000$" + hex(salt) + "$" + hex(new Uint8Array(bits));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await requireSuperAdmin(context);
  if (auth.response) return auth.response;

  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return json({ success: false, message: "İstek kaynağı geçersiz." }, 403);
  }

  try {
    const data = await request.json();
    const name = String(data.name || "").trim().slice(0, 80);
    const username = String(data.username || "").trim().toLowerCase().slice(0, 50);
    const email = String(data.email || "").trim().toLowerCase().slice(0, 120);
    const password = String(data.password || "");
    const role = String(data.role || "");

    if (!name || !/^[a-z0-9._-]{3,50}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ success: false, message: "Ad, geçerli kullanıcı adı ve e-posta girin." }, 400);
    }
    if (password.length < 6 || password.length > 128 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      return json({ success: false, message: "Şifre en az 6 karakter; büyük/küçük harf, rakam ve özel karakter içermeli." }, 400);
    }
    const roleMap = { "İçerik Yöneticisi":"content_admin", "Admin":"content_admin", "content_admin":"content_admin" };
    const roleKey = roleMap[role];
    if (!roleKey) return json({ success: false, message: "Bu ekrandan Süper Yönetici hesabı oluşturulamaz." }, 403);

    const duplicate = await env.DB.prepare("SELECT id FROM admins WHERE lower(username)=? OR lower(email)=? LIMIT 1").bind(username, email).first();
    if (duplicate) return json({ success: false, message: "Bu kullanıcı adı veya e-posta zaten kayıtlı." }, 409);

    const passwordHash = await hashPassword(password);
    // Yeni hesaplar rol şablonunu canlı olarak miras alır. Kişiye özel
    // izinler yalnızca yetki matrisi üzerinden ayrıca kaydedilir.
    const permissionsJson = JSON.stringify({ __role_key: roleKey });
    const result = await env.DB.prepare(
      "INSERT INTO admins (username,email,password_hash,role,is_active,permissions_json,force_password_change) VALUES (?,?,?,?,?,?,?)"
    ).bind(username, email, passwordHash, "content_admin", data.status === "inactive" ? 0 : 1, permissionsJson, data.forcePasswordChange ? 1 : 0).run();

    return json({ success: true, message: "Yönetici hesabı oluşturuldu.", user: { id: result.meta?.last_row_id ?? null, name, username, email, role, status: data.status === "inactive" ? "inactive" : "active" } }, 201);
  } catch (error) {
    console.error("ADMIN CREATE ERROR:", error);
    return json({ success: false, message: "Hesap oluşturulamadı. Veritabanı şemasını ve sunucu kayıtlarını kontrol edin." }, 500);
  }
}
