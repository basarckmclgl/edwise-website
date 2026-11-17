
async function hashToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const origin = request.headers.get("Origin");

    if (origin && origin !== new URL(request.url).origin) {
      return json({ success: false, message: "İstek kaynağı geçersiz." }, 403);
    }

    const db = env["edwise-deneme"];\n    if (!db) {
      return json({ success: false, message: "Veritabanı bağlantısı yok." }, 500);
    }

    const cookie = request.headers.get("Cookie") || "";
    const match = cookie.match(/(?:^|;\s*)edwise_session=([a-f0-9]{64})(?:;|$)/i);

    if (match) {
      const tokenHash = await hashToken(match[1]);

      await db.prepare(`
        DELETE FROM admin_sessions
        WHERE token_hash = ?
      `).bind(tokenHash).run();
    }

    return json(
      { success: true, message: "Güvenli çıkış yapıldı." },
      200,
      {
        "Set-Cookie": "edwise_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
      }
    );

  } catch (error) {
    console.error("EDWISE LOGOUT ERROR:", error);

    return json({
      success: false,
      message: "Çıkış sırasında sunucu hatası oluştu."
    }, 500);
  }
}
