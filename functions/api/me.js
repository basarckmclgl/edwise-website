
async function hashToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) {
      return json({ success: false, message: "Veritabanı bağlantısı yok." }, 500);
    }

    const cookie = request.headers.get("Cookie") || "";
    const match = cookie.match(/(?:^|;\s*)edwise_session=([a-f0-9]{64})(?:;|$)/i);

    if (!match) {
      return json({ success: false, authenticated: false }, 401);
    }

    const tokenHash = await hashToken(match[1]);

    const admin = await env.DB.prepare(`
      SELECT a.id, a.username, a.email, a.role, a.force_password_change
      FROM admin_sessions s
      INNER JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = ?
        AND datetime(s.expires_at) > datetime('now')
      AND a.is_active = 1
      LIMIT 1
    `).bind(tokenHash).first();

    if (!admin) {
      return json({ success: false, authenticated: false }, 401);
    }

    return json({
      success: true,
      authenticated: true,
      admin
    });

  } catch (error) {
    console.error("EDWISE SESSION ERROR:", error);
    return json({
      success: false,
      message: "Oturum kontrolünde sunucu hatası oluştu."
    }, 500);
  }
}
