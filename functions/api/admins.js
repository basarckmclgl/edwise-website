// EDWISE: account management endpoints are intentionally disabled.
// The preview installation uses exactly two fixed super-admin accounts.
// Neither account may create, edit, deactivate, or delete the other.
function disabled() {
  return Response.json(
    { success: false, message: "Yönetici hesapları bu uç noktadan yönetilemez." },
    { status: 403, headers: { "Cache-Control": "no-store" } }
  );
}
export async function onRequestGet() { return disabled(); }
export async function onRequestPost() { return disabled(); }
export async function onRequestPut() { return disabled(); }
export async function onRequestDelete() { return disabled(); }
