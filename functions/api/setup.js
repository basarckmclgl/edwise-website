
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const result = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 310000,
      hash: "SHA-256"
    },
    key,
    256
  );

  const hex = bytes =>
    Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

  return `pbkdf2$310000$${hex(salt)}$${hex(new Uint8Array(result))}`;
}

function safeCompare(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);

  let difference = x.length ^ y.length;
  const length = Math.max(x.length, y.length);

  for (let i = 0; i < length; i++) {
    difference |= (x[i] || 0) ^ (y[i] || 0);
  }

  return difference === 0;
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({
        success: false,
        message: "DB veritabanı bağlantısı bulunamadı."
      }, 500);
    }

    if (!env.CMS_SETUP_SECRET) {
      return json({
        success: false,
        message: "CMS_SETUP_SECRET sunucu değişkeni bulunamadı."
      }, 500);
    }

    const origin = request.headers.get("Origin");

    if (origin && origin !== new URL(request.url).origin) {
      return json({
        success: false,
        message: "İstek kaynağı doğrulanamadı."
      }, 403);
    }

    const suppliedSecret =
      request.headers.get("X-CMS-Setup-Secret") || "";

    if (!safeCompare(suppliedSecret, env.CMS_SETUP_SECRET)) {
      return json({
        success: false,
        message: "Kurulum gizli anahtarı hatalı."
      }, 403);
    }

    let data;

    try {
      data = await request.json();
    } catch {
      return json({
        success: false,
        message: "Gönderilen veriler okunamadı."
      }, 400);
    }

    const username = String(data.username || "").trim();
    const email = String(data.email || "").trim().toLowerCase();
    const password = String(data.password || "");

    if (
      username !== "basarckmclgl" ||
      email !== "projegelisimi.com@outlook.com" ||
      password.length < 12 ||
      password.length > 128
    ) {
      return json({
        success: false,
        message: "Kullanıcı bilgileri veya parola koşulları hatalı."
      }, 400);
    }

    const existing = await env.DB
      .prepare("SELECT COUNT(*) AS total FROM admins")
      .first();

    if (Number(existing.total) > 0) {
      return json({
        success: false,
        message: "Yönetici hesabı zaten mevcut. Kurulum kapatıldı."
      }, 409);
    }

    const passwordHash = await hashPassword(password);

    const result = await env.DB.prepare(`
      INSERT INTO admins
        (username, email, password_hash, role)
      SELECT ?, ?, ?, 'superadmin'
      WHERE NOT EXISTS (SELECT 1 FROM admins)
    `).bind(username, email, passwordHash).run();

    if (!result.meta || result.meta.changes !== 1) {
      return json({
        success: false,
        message: "Yönetici oluşturulamadı veya başka bir kurulum tamamlandı."
      }, 409);
    }

    return json({
      success: true,
      message: "Süper yönetici hesabı başarıyla oluşturuldu."
    });

  } catch (error) {
    console.error("EDWISE SETUP ERROR:", error);

    return json({
      success: false,
      message: "Kurulum hatası: " +
        (error && error.message ? error.message : "Bilinmeyen hata")
    }, 500);
  }
}
