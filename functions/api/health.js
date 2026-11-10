export async function onRequestGet({ env }) {
  try {
    await env.DB.prepare("SELECT 1").first();

    return Response.json({
      success: true,
      message: "EDWISE CMS veritabanı bağlantısı başarılı."
    });
  } catch (error) {
    return Response.json({
      success: false,
      message: "Veritabanı bağlantısı başarısız."
    }, { status: 500 });
  }
}
