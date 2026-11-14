import { requireAdmin, getEffectivePermissions } from "./_auth.js";

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function onRequestGet(context) {
  try {
    const auth = await requireAdmin(context);
    if (auth.response) return auth.response;
    const permissions = await getEffectivePermissions(context, auth.admin);
    const { permissions_json, ...admin } = auth.admin;
    return json({
      success: true,
      authenticated: true,
      admin: {
        ...admin,
        role_key: admin.role,
        permissions
      }
    });
  } catch (error) {
    console.error("EDWISE SESSION ERROR:", error);
    return json({ success: false, message: "Oturum kontrolünde sunucu hatası oluştu." }, 500);
  }
}
