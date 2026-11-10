
async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(
    new RegExp("(?:^|;\\s*)" + name + "=([^;]*)")
  );

  return match ? decodeURIComponent(match[1]) : null;
}

export async function requireAdmin(context) {
  const token = getCookie(context.request, "edwise_session");

  if (!token) {
    return {
      admin: null,
      response: Response.json(
        { success: false, message: "Oturum açmanız gerekiyor." },
        { status: 401 }
      )
    };
  }

  const tokenHash = await hashToken(token);

  const result = await context.env.DB.prepare(`
    SELECT
      a.id,
      a.username,
      a.email,
      a.role
    FROM admin_sessions s
    INNER JOIN admins a ON a.id = s.admin_id
    WHERE s.token_hash = ?
      AND datetime(s.expires_at) > datetime('now')
      AND a.is_active = 1
    LIMIT 1
  `).bind(tokenHash).first();

  if (!result) {
    return {
      admin: null,
      response: Response.json(
        { success: false, message: "Oturum geçersiz veya süresi dolmuş." },
        { status: 401 }
      )
    };
  }

  return {
    admin: result,
    response: null
  };
}
