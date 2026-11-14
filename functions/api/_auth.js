
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

  if (!match) return null;
  try { return decodeURIComponent(match[1]); }
  catch { return null; }
}

function authError(message, status) {
  return {
    admin: null,
    response: Response.json(
      { success: false, message },
      { status }
    )
  };
}

// Oturum kontrolü: Mevcut giriş sistemi korunur.
export async function requireAdmin(context) {
  const token = getCookie(
    context.request,
    "edwise_session"
  );

  if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
    return authError(
      "Oturum açmanız gerekiyor.",
      401
    );
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
    return authError(
      "Oturum geçersiz veya süresi dolmuş.",
      401
    );
  }

  return {
    admin: result,
    response: null
  };
}

// Yalnızca ana yöneticiye izin verir.
export async function requireSuperAdmin(context) {
  const auth = await requireAdmin(context);

  if (auth.response) {
    return auth;
  }

  if (auth.admin.role !== "superadmin") {
    return authError(
      "Bu işlem için ana yönetici yetkisi gerekiyor.",
      403
    );
  }

  return auth;
}

// Ana yönetici ve içerik editörüne izin verir.
export async function requireEditor(context) {
  const auth = await requireAdmin(context);

  if (auth.response) {
    return auth;
  }

  const allowedRoles = [
    "superadmin",
    "admin",
    "content_admin"
  ];

  if (!allowedRoles.includes(auth.admin.role)) {
    return authError(
      "Bu işlem için yetkiniz bulunmuyor.",
      403
    );
  }

  return auth;
}


// Modül/işlem bazlı yetki kontrolü. API uç noktaları bu yardımcıyı
// kendi işlem anahtarlarıyla çağırarak sunucu tarafında erişimi doğrulamalıdır.
export async function requirePermission(context, moduleKey, actionKey = "view") {
  const auth = await requireAdmin(context);
  if (auth.response) return auth;
  if (auth.admin.role === "superadmin") return auth;

  const allowedModules = ["dashboard", "pages", "services", "applications", "menu", "seo", "languages", "settings", "users"];
  const allowedActions = ["view", "create", "edit", "delete", "publish"];
  if (!allowedModules.includes(moduleKey) || !allowedActions.includes(actionKey)) {
    return authError("Geçersiz yetki anahtarı.", 400);
  }

  try {
    const row = await context.env.DB.prepare(
      "SELECT permissions_json FROM admins WHERE id = ? AND is_active = 1"
    ).bind(auth.admin.id).first();
    const permissions = JSON.parse(row?.permissions_json || "{}");
    if (permissions?.[moduleKey]?.[actionKey] === true) return auth;
    return authError("Bu modülde bu işlem için yetkiniz bulunmuyor.", 403);
  } catch {
    return authError("Yetki sistemi henüz etkinleştirilmedi. Veritabanı geçişi gerekli.", 503);
  }
}
