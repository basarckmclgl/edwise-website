
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
      SELECT a.id, a.username, a.email, a.role, a.permissions_json, a.force_password_change
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

    let own = {};
    try { own = JSON.parse(admin.permissions_json || "{}"); } catch {}
    const roleKey = String(own.__role_key || admin.role);
    const template = await env.DB.prepare("SELECT permissions_json FROM admin_role_templates WHERE role_key=? LIMIT 1").bind(roleKey).first();
    let templatePermissions = {};
    try { templatePermissions = JSON.parse(template?.permissions_json || "{}"); } catch {}
    const builtin = {
      content_admin:{dashboard:{view:true},pages:{view:true,create:true,edit:true,delete:true,publish:true},services:{view:true,create:true,edit:true,delete:true,publish:true},applications:{view:true,create:true,edit:true},menu:{view:true,create:true,edit:true,delete:true,publish:true},seo:{view:true,edit:true},languages:{view:true,create:true,edit:true,publish:true},settings:{view:true,create:true,edit:true},users:{view:false}},
      editor:{dashboard:{view:true},pages:{view:true,create:true,edit:true},services:{view:true,create:true,edit:true},applications:{view:true},menu:{view:true},seo:{view:true,edit:true},languages:{view:true,edit:true},settings:{view:true},users:{view:false}},
      viewer:{dashboard:{view:true},pages:{view:true},services:{view:true},applications:{view:true},menu:{view:true},seo:{view:true},languages:{view:true},settings:{view:true},users:{view:false}}
    };
    const base = Object.keys(templatePermissions).length ? templatePermissions : (builtin[roleKey] || builtin.content_admin);
    const permissions = {...base};
    for (const [module, actions] of Object.entries(own)) if (module !== "__role_key") permissions[module] = {...(base[module]||{}),...(actions||{})};
    delete admin.permissions_json;
    return json({
      success: true,
      authenticated: true,
      admin: {...admin, role_key:roleKey, permissions}
    });

  } catch (error) {
    console.error("EDWISE SESSION ERROR:", error);
    return json({
      success: false,
      message: "Oturum kontrolünde sunucu hatası oluştu."
    }, 500);
  }
}
