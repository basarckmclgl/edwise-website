
export async function onRequestGet({ request, env }) {
  try {
    try { await env.DB.prepare("ALTER TABLE pages ADD COLUMN deleted_at TEXT").run(); }
    catch (error) { if (!/duplicate column|already exists/i.test(String(error?.message || error))) throw error; }
    const url = new URL(request.url);
    const slug = url.searchParams.get("slug");
    const rawPagePath = url.searchParams.get("path");
    const pagePath = rawPagePath === "/" ? "/index.html" : rawPagePath;

    let result;

    if (pagePath) {
      const tr=await env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='static_page_trash' LIMIT 1").first();
      let removed=[];try{removed=JSON.parse(tr?.setting_value||"[]");}catch{}
      if(Array.isArray(removed)&&removed.some(item=>item.page_path===pagePath))return Response.json({success:false,deleted:true,message:"Bu sayfa yayından kaldırılmış."},{status:410,headers:{"Cache-Control":"no-store"}});
      result = await env.DB.prepare("SELECT id, title, slug, content, meta_title, meta_description FROM pages WHERE page_path = ? AND status = 'published' AND deleted_at IS NULL LIMIT 1").bind(pagePath).first();
      if (result) return Response.json({ success: true, page: result }, { headers: { "Cache-Control": "no-store" } });
      return Response.json({ success: false, message: "Yayımlanmış sayfa bulunamadı." }, { status: 404 });
    }

    if (slug) {
      result = await env.DB.prepare(
        `SELECT id, title, slug, content, meta_title, meta_description
         FROM pages
         WHERE slug = ? AND status = 'published' AND deleted_at IS NULL
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
       WHERE status = 'published' AND deleted_at IS NULL
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
