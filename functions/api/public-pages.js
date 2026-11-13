
export async function onRequestGet({ request, env }) {
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS preview_page_trash (page_id INTEGER PRIMARY KEY, deleted_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
    const url = new URL(request.url);
    const slug = url.searchParams.get("slug");

    let result;

    if (slug) {
      result = await env.DB.prepare(
        `SELECT id, title, slug, content, meta_title, meta_description
         FROM pages
         WHERE slug = ? AND status = 'published' AND NOT EXISTS (SELECT 1 FROM preview_page_trash t WHERE t.page_id = pages.id)
         LIMIT 1`
      ).bind(slug).first();

      if (!result) {
        return Response.json(
          { success: false, message: "Yayımlanmış sayfa bulunamadı." },
          { status: 404 }
        );
      }

      return Response.json({ success: true, page: result });
    }

    result = await env.DB.prepare(
      `SELECT id, title, slug, content, meta_title, meta_description
       FROM pages
       WHERE status = 'published' AND NOT EXISTS (SELECT 1 FROM preview_page_trash t WHERE t.page_id = pages.id)
       ORDER BY updated_at DESC`
    ).all();

    return Response.json({
      success: true,
      pages: result.results || []
    });
  } catch (error) {
    return Response.json(
      { success: false, message: "Sayfalar alınamadı." },
      { status: 500 }
    );
  }
}
