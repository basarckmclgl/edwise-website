
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

// Korumalı içerik API'lerinde URL ve HTTP metoduna göre izin kontrolü yapar.
export async function requireEditor(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.toLowerCase();
  const method = context.request.method.toUpperCase();
  let moduleKey = null;

  if (path.includes("/pages")) moduleKey = "pages";
  else if (path.includes("/services")) moduleKey = "services";
  else if (path.includes("/applications")) moduleKey = "applications";
  else if (path.includes("/media")) moduleKey = "pages";

  if (!moduleKey) {
    const auth = await requireAdmin(context);
    if (auth.response) return auth;
    return auth.admin.role === "superadmin" ? auth : authError("Bu işlem için yetkiniz bulunmuyor.", 403);
  }

  let actionKey = method === "GET" || method === "HEAD" ? "view"
    : method === "POST" ? "create"
    : method === "DELETE" ? "delete"
    : method === "PUT" || method === "PATCH" ? "edit" : null;

  // Dosya yönetimi uç noktaları POST kullansa da işlemin gerçek türünü koru.
  if (path.includes("media-delete")) actionKey = "delete";
  else if (path.includes("media-upload") || path.includes("media-import")) actionKey = "create";

  if (!actionKey) return authError("Bu işlem için yetki tanımlı değil.", 403);

  if (moduleKey === "pages" && (method === "PUT" || method === "PATCH")) {
    try {
      const body = await context.request.clone().json();
      if (body?.action === "publish" || body?.status === "published" || body?.published === true) actionKey = "publish";
    } catch {}
  }
  return requirePermission(context, moduleKey, actionKey);
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
      "SELECT a.permissions_json, t.permissions_json AS template_permissions_json FROM admins a LEFT JOIN admin_role_templates t ON t.role_key = a.role WHERE a.id = ? AND a.is_active = 1"
    ).bind(auth.admin.id).first();
    const ownPermissions = JSON.parse(row?.permissions_json || "{}");
    const templatePermissions = JSON.parse(row?.template_permissions_json || "{}");
    const hasUserOverrides = Object.keys(ownPermissions).length > 0;
    const hasTemplatePermissions = Object.keys(templatePermissions).length > 0;

    // Geriye dönük uyumluluk: henüz izin matrisi tanımlanmamış mevcut
    // content_admin hesaplarının eski erişimlerini koru. İlk açık izin
    // kaydı yapıldıktan sonra yalnızca kaydedilen izinler uygulanır.
    const permissions = hasUserOverrides
      ? ownPermissions
      : hasTemplatePermissions
        ? templatePermissions
        : {
            dashboard: { view: true },
            pages: { view: true, create: true, edit: true, delete: true, publish: true },
            services: { view: true, create: true, edit: true, delete: true, publish: true },
            applications: { view: true, create: true, edit: true, delete: true, publish: true },
            menu: { view: true, create: true, edit: true, delete: true },
            seo: { view: true, edit: true },
            languages: { view: true, edit: true },
            settings: { view: true, edit: true },
            users: { view: true }
          };
    if (permissions?.[moduleKey]?.[actionKey] === true) return auth;
    return authError("Bu modülde bu işlem için yetkiniz bulunmuyor.", 403);
  } catch {
    return authError("Yetki sistemi henüz etkinleştirilmedi. Veritabanı geçişi gerekli.", 503);
  }
}
