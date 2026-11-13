import { requireEditor } from "./_auth.js";

const CREATE_METADATA = `
CREATE TABLE IF NOT EXISTS media_metadata (
 media_id INTEGER PRIMARY KEY,
 byte_size INTEGER,
 alt_text TEXT NOT NULL DEFAULT '',
 title TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
)`;

export async function onRequestGet(context) {
  try {
    const auth = await requireEditor(context);
    if (auth.response) return auth.response;
    const db = context.env.DB;
    if (!db) return Response.json({success:false,error:"Veritabanı bağlantısı bulunamadı."},{status:500});
    await db.prepare(CREATE_METADATA).run();
    const result = await db.prepare(`
      SELECT m.id,m.file_name,m.file_url,m.file_type,m.created_at,
             mm.byte_size,mm.alt_text,mm.title,mm.description
      FROM media m LEFT JOIN media_metadata mm ON mm.media_id=m.id
      ORDER BY m.created_at DESC,m.id DESC
    `).all();
    const media = (result.results || []).map(item => ({
      ...item,
      file_url: `/api/media/${encodeURIComponent(item.file_name)}`
    }));
    return Response.json({success:true,media,metadata_supported:true});
  } catch (error) {
    return Response.json({success:false,error:`Medya listesi alınamadı: ${error.message}`},{status:500});
  }
}