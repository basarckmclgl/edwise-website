import { requireAdmin } from "./_auth.js";
export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (auth.response) return auth.response;
  return Response.json({ success: true, authenticated: true, admin: auth.admin, workInProgress: auth.workInProgress || false }, { headers: { "Cache-Control": "no-store" } });
}
