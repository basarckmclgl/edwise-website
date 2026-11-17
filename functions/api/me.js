import { requireAdmin } from "./_auth.js";
export async function onRequestGet(context) {
  try {
    const auth = await requireAdmin(context);
    if (auth.response) return auth.response;
    return Response.json({ success: true, authenticated: true, admin: auth.admin }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    console.error("EDWISE SESSION PROFILE ERROR:", error);
    return Response.json({ success: false, message: "Hesap bilgileri alınamadı." }, {
      status: 500, headers: { "Cache-Control": "no-store" }
    });
  }
}
