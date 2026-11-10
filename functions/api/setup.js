
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

export async function onRequestPost({ request, env }) {
  const headers = {
    "Cache-Control": "no-store"
  };

  try {
    if (!env.DB || !env.CMS_SETUP_SECRET) {
      return Response.json(
        { success: false, message: "Sunucu yapılandırması eksik." },
        { status: 500, headers }
      );
    }

    const origin = request.headers.get("Origin");

    if (origin && origin !== new URL(request.url).origin) {
      return Response.json(
        { success: false, message: "İstek reddedildi." },
        { status: 403, headers }
      );
    }

    const suppliedSecret =
      request.headers.get("X-CMS-Setup-Secret") || "";

    if (!safeCompare(suppliedSecret, env.CMS_SETUP_SECRET)) {
      return Response.json(
        { success: false, message: "Kurulum anahtarı geçersiz." },
        { status: 403, headers }
      );
    }

    const data = await request.json();

    const username = String(data.username || "").trim();
    const email = String(data.email || "").trim().toLowerCase();
    const password = String(data.password || "");

    if (
      username !== "basarckmclgl" ||
      email !== "projegelisimi.com@outlook.com" ||
      password.length < 12 ||
      password.length > 128
    ) {
      return Response.json(
        { success: false, message: "Yönetici bilgileri geçersiz." },
        { status: 400, headers }
      );
    }

    const passwordHash = await hashPassword(password);

    const result = await env.DB.prepare(`
      INSERT INTO admins (username, email, password_hash, role)
      SELECT ?, ?, ?, 'superadmin'
      WHERE NOT EXISTS (SELECT 1 FROM admins)
    `).bind(username, email, passwordHash).run();

    if (!result.meta || result.meta.changes !== 1) {
      return Response.json(
        { success: false, message: "Yönetici zaten oluşturulmuş." },
        { status: 409, headers }
      );
    }

    return Response.json(
      { success: true, message: "Süper yönetici oluşturuldu." },
      { headers }
    );

  } catch (error) {
    return Response.json(
      { success: false, message: "Kurulum sırasında hata oluştu." },
      { status: 500, headers }
    );
  }
}
