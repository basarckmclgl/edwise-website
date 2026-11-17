// EDWISE: legacy account-creation endpoint disabled.
// The preview installation uses exactly two fixed super-admin accounts.
export async function onRequestPost() {
  return Response.json(
    { success: false, message: "Yeni yönetici hesabı oluşturma devre dışıdır." },
    { status: 403, headers: { "Cache-Control": "no-store" } }
  );
}
