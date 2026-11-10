
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get("slug");

    let result;

    if (slug) {
      result = await env.DB.prepare(
        `SELECT id, title, slug, content, meta_title, meta_description
         FROM pages
         WHERE slug = ? AND status = 'published'
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
       WHERE status = 'published'
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
