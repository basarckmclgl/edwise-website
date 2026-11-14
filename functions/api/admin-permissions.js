import { requireSuperAdmin } from "./_auth.js";

const MODULES = [
  "dashboard", "pages", "services", "applications", "menu",
  "seo", "languages", "settings", "users"
];
const ACTIONS = ["view", "create", "edit", "delete", "publish"];

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
function validPermissions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([module, actions]) =>
    MODULES.includes(module) && actions && typeof actions === "object" &&
    !Array.isArray(actions) && Object.entries(actions).every(([action, allowed]) =>
      ACTIONS.includes(action) && typeof allowed === "boolean"
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
        "SELECT id, role_key, role_name, permissions_json, is_system, updated_at FROM admin_role_templates ORDER BY role_name"
      ).all()
    ]);
    return json({
      success: true,
      modules: MODULES,
      actions: ACTIONS,
      users: users.results || [],
      templates: (templates.results || []).map(row => ({
        ...row,
        permissions: JSON.parse(row.permissions_json || "{}")
      }))
    });
  } catch (error) {
    return json({
      success: false,
      code: "PERMISSIONS_MIGRATION_REQUIRED",
      message: "Yetki yönetimi veritabanı geçişi henüz uygulanmamış. migrations/0002_user_permissions.sql çalıştırılmalı."
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
      return json({ success: false, message: "Yetki matrisi geçersiz. Modül ve işlem anahtarlarını kontrol edin." }, 400);
    }
    const serialized = JSON.stringify(permissions);
    if (body.target === "user") {
      const id = Number(body.userId);
      if (!Number.isInteger(id) || id < 1 || id === Number(auth.admin.id)) {
        return json({ success: false, message: "Geçerli bir kullanıcı seçin. Kendi yetkilerinizi bu ekrandan değiştiremezsiniz." }, 400);
      }
      const target = await context.env.DB.prepare("SELECT id, role, permissions_json FROM admins WHERE id = ?").bind(id).first();
      if (!target || target.role === "superadmin") return json({ success: false, message: "Kullanıcı bulunamadı veya korumalı hesaptır." }, 404);
      const roleKey = String(body.roleKey || "").trim();
      if (roleKey && !["content_admin","editor","viewer"].includes(roleKey)) return json({ success:false,message:"Kullanıcı rolü geçersiz." },400);
      const saved = { ...permissions, __role_key: roleKey || JSON.parse(target.permissions_json || "{}").__role_key || "content_admin" };
      await context.env.DB.prepare(
        "UPDATE admins SET permissions_json = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(JSON.stringify(saved), id).run();
      return json({ success: true, message: "Kullanıcıya özel yetkiler kaydedildi." });
    }
    if (body.target === "template") {
      const roleKey = String(body.roleKey || "").trim();
      const roleName = String(body.roleName || "").trim().slice(0, 80);
      if (!/^[a-z][a-z0-9_]{2,39}$/.test(roleKey) || !roleName || roleKey === "superadmin") {
        return json({ success: false, message: "Geçerli bir rol şablonu adı ve anahtarı girin." }, 400);
      }
      await context.env.DB.prepare(`
        INSERT INTO admin_role_templates (role_key, role_name, permissions_json, is_system, updated_by, updated_at)
        VALUES (?, ?, ?, 0, ?, datetime('now'))
        ON CONFLICT(role_key) DO UPDATE SET
          role_name = excluded.role_name,
          permissions_json = excluded.permissions_json,
          updated_by = excluded.updated_by,
          updated_at = datetime('now')
      `).bind(roleKey, roleName, serialized, auth.admin.id).run();
      return json({ success: true, message: "Rol şablonu kaydedildi." });
    }
    return json({ success: false, message: "Kaydetme hedefi belirtilmedi." }, 400);
  } catch (error) {
    return json({
      success: false,
      code: "PERMISSIONS_MIGRATION_REQUIRED",
      message: "Yetki tabloları hazır değil. Önce migrations/0002_user_permissions.sql uygulanmalı."
    }, 503);
  }
}
