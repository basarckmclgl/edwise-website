
import { requireEditor } from "./_auth.js";

export async function onRequestGet(context) {
  try {
    const auth = await requireEditor(context);
    if (auth.response) return auth.response;

    const db = context.env.DB;

    if (!db) {
      return Response.json(
        { error: "Veritabanı bağlantısı bulunamadı." },
        { status: 500 }
      );
    }

    const result = await db.prepare(`
      SELECT id, file_name, file_url, file_type, created_at
      FROM media
      ORDER BY created_at DESC, id DESC
    `).all();

    return Response.json({
      success: true,
      media: result.results || []
    });

  } catch (error) {
    return Response.json({
      error: `Medya listesi alınamadı: ${error.message}`
    }, { status: 500 });
  }
}
