async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

function authError(message, status) {
  return { admin: null, response: Response.json({ success: false, message }, { status, headers: { "Cache-Control": "no-store" } }) };
}

export function normalizeRole(role) {
  const value = String(role || "").trim().toLowerCase();
  if (value === "superadmin") return "superadmin";
  if (["content_admin", "editor", "viewer", "admin"].includes(value)) return "content_admin";
  return null;
}

const CONTENT_ADMIN_DEFAULTS = Object.freeze({
  dashboard: { view: true },
  pages: { view: true, create: true, edit: true, delete: false, publish: true },
  services: { view: true, create: true, edit: true, delete: false, publish: true },
  media: { view: true, create: true, edit: true, delete: false },
  applications: { view: true, create: false, edit: true, delete: false },
  menu: { view: true, create: false, edit: true, delete: false },
  profile: { view: true, create: false, edit: true, delete: false }
});

const CONTENT_ADMIN_LIMITS = Object.freeze({
  dashboard: ["view"],
  pages: ["view", "create", "edit", "publish"],
  services: ["view", "create", "edit", "publish"],
  media: ["view", "create", "edit"],
  applications: ["view", "edit"],
  menu: ["view", "edit"],
  profile: ["view", "edit"]
});

export async function getEffectivePermissions(context, admin) {
  const role = normalizeRole(admin?.role);
  if (role === "superadmin") return { superadmin: true };
  if (role !== "content_admin") return {};

  const row = await context.env.DB.prepare(
    "SELECT a.permissions_json, t.permissions_json AS template_permissions_json FROM admins a LEFT JOIN admin_role_templates t ON t.role_key = 'content_admin' WHERE a.id = ? AND a.is_active = 1"
  ).bind(admin.id).first();

  let own = {};
  let template = {};
  try { own = JSON.parse(row?.permissions_json || admin.permissions_json || "{}"); } catch {}
  try { template = JSON.parse(row?.template_permissions_json || "{}"); } catch {}

  const result = {};
  for (const [module, allowedActions] of Object.entries(CONTENT_ADMIN_LIMITS)) {
    result[module] = {};
    for (const action of allowedActions) {
      const fallback = CONTENT_ADMIN_DEFAULTS[module]?.[action] === true;
      const templateValue = template?.[module]?.[action];
      const ownValue = own?.[module]?.[action];
      const value = typeof ownValue === "boolean" ? ownValue
        : typeof templateValue === "boolean" ? templateValue
        : fallback;
      result[module][action] = value;
    }
  }
  return result;
}

export async function requireAdmin(context) {
  const token = getCookie(context.request, "edwise_session");
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return authError("Oturum açmanız gerekiyor.", 401);

  const tokenHash = await hashToken(token);
  const result = await context.env.DB.prepare(`
    SELECT a.id, a.username, a.email, a.role, a.permissions_json, a.force_password_change
    FROM admin_sessions s
    INNER JOIN admins a ON a.id = s.admin_id
    WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now') AND a.is_active = 1
    LIMIT 1
  `).bind(tokenHash).first();

  if (!result) return authError("Oturum geçersiz veya süresi dolmuş.", 401);

  const canonicalRole = normalizeRole(result.role);
  if (!canonicalRole) return authError("Bu hesabın yönetim paneline erişim yetkisi yok.", 403);
  const admin = { ...result, role: canonicalRole };

  if (Number(result.force_password_change) === 1) {
    const path = new URL(context.request.url).pathname;
    const method = context.request.method.toUpperCase();
    const allowed = (path === "/api/change-password" && method === "POST") ||
      (path === "/api/profile" && method === "GET") ||
      (path === "/api/logout" && method === "POST");
    if (!allowed) {
      return {
        admin,
        response: Response.json(
          { success: false, code: "PASSWORD_CHANGE_REQUIRED", message: "Devam etmeden önce ilk giriş şifrenizi değiştirmeniz gerekiyor." },
          { status: 403, headers: { "Cache-Control": "no-store" } }
        )
      };
    }
  }
  return { admin, response: null };
}

export async function requireSuperAdmin(context) {
  const auth = await requireAdmin(context);
  if (auth.response) return auth;
  if (auth.admin.role !== "superadmin") return authError("Bu işlem için Süper Yönetici yetkisi gerekiyor.", 403);
  return auth;
}

export async function requirePermission(context, moduleKey, actionKey = "view") {
  const auth = await requireAdmin(context);
  if (auth.response) return auth;
  if (auth.admin.role === "superadmin") return auth;

  const allowedActions = ["view", "create", "edit", "delete", "publish"];
  if (!Object.prototype.hasOwnProperty.call(CONTENT_ADMIN_LIMITS, moduleKey) ||
      !allowedActions.includes(actionKey) ||
      !CONTENT_ADMIN_LIMITS[moduleKey].includes(actionKey)) {
    return authError("Bu modül veya işlem İçerik Yöneticisi için tanımlı değil.", 403);
  }

  try {
    const permissions = await getEffectivePermissions(context, auth.admin);
    if (permissions?.[moduleKey]?.[actionKey] === true) return auth;
    return authError("Bu modülde bu işlem için yetkiniz bulunmuyor.", 403);
  } catch {
    return authError("Yetki sistemi henüz etkinleştirilmedi. Veritabanı geçişi gerekli.", 503);
  }
}

// İçerik API'lerinde hem modül hem de işlem bazlı sunucu yetkisi.
export async function requireEditor(context) {
  const path = new URL(context.request.url).pathname.toLowerCase();
  const method = context.request.method.toUpperCase();
  let moduleKey = null;

  if (path === "/api/pages" || path.startsWith("/api/pages/")) moduleKey = "pages";
  else if (path === "/api/services" || path.startsWith("/api/services/")) moduleKey = "services";
  else if (path === "/api/applications" || path.startsWith("/api/applications/")) moduleKey = "applications";
  else if (path === "/api/media" || path.startsWith("/api/media/") || path.includes("media-upload") || path.includes("media-delete") || path.includes("media-import") || path.includes("media-metadata")) moduleKey = "media";

  if (!moduleKey) {
    const auth = await requireAdmin(context);
    if (auth.response) return auth;
    return auth.admin.role === "superadmin" ? auth : authError("Bu işlem için yetkiniz bulunmuyor.", 403);
  }

  let actionKey = method === "GET" || method === "HEAD" ? "view"
    : method === "POST" ? "create"
    : method === "DELETE" ? "delete"
    : method === "PUT" || method === "PATCH" ? "edit" : null;

  if (path.includes("media-delete")) actionKey = "delete";
  else if (path.includes("media-upload") || path.includes("media-import")) actionKey = "create";
  if (!actionKey) return authError("Bu işlem için yetki tanımlı değil.", 403);

  const auth = await requireAdmin(context);
  if (auth.response) return auth;
  if (auth.admin.role === "superadmin") return auth;

  let isPublish = false;
  if (["pages", "services"].includes(moduleKey) && ["POST", "PUT", "PATCH"].includes(method)) {
    try {
      const body = await context.request.clone().json();
      isPublish = body?.action === "publish" || body?.status === "published" || body?.published === true;
    } catch {}
  }

  try {
    const permissions = await getEffectivePermissions(context, auth.admin);
    if (permissions?.[moduleKey]?.[actionKey] !== true) return authError("Bu modülde bu işlem için yetkiniz bulunmuyor.", 403);
    if (isPublish && permissions?.[moduleKey]?.publish !== true) return authError("Yayınlama yetkiniz bulunmuyor.", 403);
    return auth;
  } catch {
    return authError("Yetki sistemi henüz etkinleştirilmedi. Veritabanı geçişi gerekli.", 503);
  }
}
