
import { requireEditor } from "./_auth.js";

export async function onRequestGet(context) {
  try {
    const auth = await requireEditor(context);
    if (auth.response) return auth.response;

    const db = context.env["edwise-deneme"];

    if (!db) {
      return Response.json(
        { error: "Veritabanı bağlantısı bulunamadı." },
        { status: 500 }
      );
    }

    await db.prepare(`CREATE TABLE IF NOT EXISTS media (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 file_name TEXT NOT NULL UNIQUE,
 file_url TEXT NOT NULL,
 file_type TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`).run();

    const result = await db.prepare(`
      SELECT id, file_name, file_url, file_type, created_at
      FROM media
      ORDER BY created_at DESC, id DESC
    `).all();

    const media = (result.results || []).map(item => ({
      ...item,
      file_url: `/api/media/${encodeURIComponent(item.file_name)}`
    }));

    return Response.json({
      success: true,
      media
    });

  } catch (error) {
    return Response.json({
      error: `Medya listesi alınamadı: ${error.message}`
    }, { status: 500 });
  }
}
