import { requireSuperAdmin } from "./_auth.js";

const MODULES = ["dashboard", "pages", "services", "media", "applications", "menu", "profile"];
const ACTIONS = ["view", "create", "edit", "delete", "publish"];
const MODULE_ACTIONS = {
  dashboard: ["view"],
  pages: ["view", "create", "edit", "publish"],
  services: ["view", "create", "edit", "publish"],
  media: ["view", "create", "edit"],
  applications: ["view", "edit"],
  menu: ["view", "edit"],
  profile: ["view", "edit"]
};

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
function validPermissions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([module, actions]) =>
    MODULES.includes(module) && actions && typeof actions === "object" &&
    !Array.isArray(actions) && Object.entries(actions).every(([action, allowed]) =>
      ACTIONS.includes(action) && MODULE_ACTIONS[module].includes(action) && typeof allowed === "boolean"
    )
  );
}
function sameOrigin(request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

export async function onRequestGet(context) {
  const auth = await requireSuperAdmin(context);
  if (auth.response) return auth.response;
  try {
    const [users, templates] = await Promise.all([
      context.env.DB.prepare(
        "SELECT id, username, email, role, is_active, permissions_json, force_password_change FROM admins ORDER BY username"
      ).all(),
      context.env.DB.prepare(
        "SELECT id, role_key, role_name, permissions_json, is_system, updated_at FROM admin_role_templates WHERE role_key = 'content_admin' ORDER BY role_name"
      ).all()
    ]);
    return json({
      success: true,
      roles: [{ role_key: "superadmin", role_name: "Süper Yönetici" }, { role_key: "content_admin", role_name: "İçerik Yöneticisi" }],
      modules: MODULES,
      actions: ACTIONS,
      users: (users.results || []).map(row => ({ ...row, role: row.role === "superadmin" ? "superadmin" : "content_admin" })),
      templates: (templates.results || []).map(row => ({
        ...row,
        permissions: JSON.parse(row.permissions_json || "{}")
      }))
    });
  } catch {
    return json({
      success: false,
      code: "PERMISSIONS_MIGRATION_REQUIRED",
      message: "Yetki yönetimi tabloları hazır değil. Veritabanı geçişi gerekli."
    }, 503);
  }
}

export async function onRequestPut(context) {
  if (!sameOrigin(context.request)) return json({ success: false, message: "İstek kaynağı geçersiz." }, 403);
  const auth = await requireSuperAdmin(context);
  if (auth.response) return auth.response;
  try {
    const body = await context.request.json();
    const permissions = body.permissions;
    if (!validPermissions(permissions)) {
      return json({ success: false, message: "Yetki matrisi geçersiz. Yalnızca tanımlı içerik modülleri ve işlemleri kullanılabilir." }, 400);
    }

    if (body.target === "user") {
      const id = Number(body.userId);
      if (!Number.isInteger(id) || id < 1 || id === Number(auth.admin.id)) {
        return json({ success: false, message: "Geçerli bir kullanıcı seçin. Süper Yönetici kendi yetkilerini bu ekrandan değiştiremez." }, 400);
      }
      const target = await context.env.DB.prepare("SELECT id, role FROM admins WHERE id = ?").bind(id).first();
      if (!target || target.role === "superadmin") return json({ success: false, message: "Kullanıcı bulunamadı veya korumalı hesaptır." }, 404);
      const saved = { ...permissions, __role_key: "content_admin" };
      await context.env.DB.prepare(
        "UPDATE admins SET role = 'content_admin', permissions_json = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(JSON.stringify(saved), id).run();
      return json({ success: true, message: "İçerik Yöneticisi kullanıcı yetkileri kaydedildi." });
    }

    if (body.target === "template") {
      const roleKey = String(body.roleKey || "").trim();
      if (roleKey !== "content_admin") {
        return json({ success: false, message: "Yalnızca İçerik Yöneticisi rol şablonu düzenlenebilir." }, 400);
      }
      await context.env.DB.prepare(`
        INSERT INTO admin_role_templates (role_key, role_name, permissions_json, is_system, updated_by, updated_at)
        VALUES ('content_admin', 'İçerik Yöneticisi', ?, 1, ?, datetime('now'))
        ON CONFLICT(role_key) DO UPDATE SET
          role_name = 'İçerik Yöneticisi',
          permissions_json = excluded.permissions_json,
          is_system = 1,
          updated_by = excluded.updated_by,
          updated_at = datetime('now')
      `).bind(JSON.stringify(permissions), auth.admin.id).run();
      return json({ success: true, message: "İçerik Yöneticisi rol şablonu kaydedildi." });
    }

    return json({ success: false, message: "Kaydetme hedefi belirtilmedi." }, 400);
  } catch {
    return json({
      success: false,
      code: "PERMISSIONS_MIGRATION_REQUIRED",
      message: "Yetki tabloları hazır değil. Veritabanı geçişi gerekli."
    }, 503);
  }
}
