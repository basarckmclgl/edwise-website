
import { requireEditor } from "./_auth.js";

function json(data, status = 200) {
  return Response.json(data, { status });
}

function makeSlug(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function validStatus(status) {
  return status === "draft" || status === "published";
}

async function authorized(context) {
  const result = await requireEditor(context);
  if (result.response) return { response: result.response };
  return { admin: result.admin };
}

async function checkOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;

  return origin === new URL(request.url).origin;
}

export async function onRequestGet(context) {
  try {
    const auth = await authorized(context);
    if (auth.response) return auth.response;

    const result = await context.env.DB.prepare(`
      SELECT id, title, slug, content, meta_title,
             meta_description, status, created_at, updated_at
      FROM pages
      ORDER BY updated_at DESC
    `).all();

    return json({
      success: true,
      pages: result.results || []
    });
  } catch (error) {
    return json({
      success: false,
      message: "Sayfalar alınamadı."
    }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    if (!(await checkOrigin(context.request))) {
      return json({ success: false, message: "İstek kaynağı geçersiz." }, 403);
    }

    const auth = await authorized(context);
    if (auth.response) return auth.response;

    const data = await context.request.json();

    const title = String(data.title || "").trim();
    const slug = makeSlug(data.slug || title);
    const content = String(data.content || "");
    const metaTitle = String(data.meta_title || "").trim();
    const metaDescription = String(data.meta_description || "").trim();
    const status = data.status || "draft";

    if (!title || !slug) {
      return json({ success: false, message: "Başlık ve URL adresi zorunludur." }, 400);
    }

    if (!validStatus(status)) {
      return json({ success: false, message: "Geçersiz yayın durumu." }, 400);
    }

    const existing = await context.env.DB.prepare(
      "SELECT id FROM pages WHERE slug = ? LIMIT 1"
    ).bind(slug).first();

    if (existing) {
      return json({ success: false, message: "Bu URL adresi zaten kullanılıyor." }, 409);
    }

    const result = await context.env.DB.prepare(`
      INSERT INTO pages
      (title, slug, content, meta_title, meta_description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      title, slug, content, metaTitle, metaDescription, status
    ).run();

    return json({
      success: true,
      message: "Sayfa oluşturuldu.",
      id: result.meta.last_row_id
    }, 201);

  } catch (error) {
    return json({ success: false, message: "Sayfa oluşturulamadı." }, 500);
  }
}

export async function onRequestPut(context) {
  try {
    if (!(await checkOrigin(context.request))) {
      return json({ success: false, message: "İstek kaynağı geçersiz." }, 403);
    }

    const auth = await authorized(context);
    if (auth.response) return auth.response;

    const data = await context.request.json();
    const id = Number(data.id);
    const title = String(data.title || "").trim();
    const slug = makeSlug(data.slug || title);
    const content = String(data.content || "");
    const metaTitle = String(data.meta_title || "").trim();
    const metaDescription = String(data.meta_description || "").trim();
    const status = data.status || "draft";

    if (!Number.isInteger(id) || id < 1 || !title || !slug) {
      return json({ success: false, message: "Sayfa bilgileri eksik veya hatalı." }, 400);
    }

    if (!validStatus(status)) {
      return json({ success: false, message: "Geçersiz yayın durumu." }, 400);
    }

    const duplicate = await context.env.DB.prepare(
      "SELECT id FROM pages WHERE slug = ? AND id != ? LIMIT 1"
    ).bind(slug, id).first();

    if (duplicate) {
      return json({ success: false, message: "Bu URL adresi başka bir sayfada kullanılıyor." }, 409);
    }

    const result = await context.env.DB.prepare(`
      UPDATE pages
      SET title = ?, slug = ?, content = ?, meta_title = ?,
          meta_description = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      title, slug, content, metaTitle, metaDescription, status, id
    ).run();

    if (!result.meta.changes) {
      return json({ success: false, message: "Sayfa bulunamadı." }, 404);
    }

    return json({ success: true, message: "Sayfa güncellendi." });

  } catch (error) {
    return json({ success: false, message: "Sayfa güncellenemedi." }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    if (!(await checkOrigin(context.request))) {
      return json({ success: false, message: "İstek kaynağı geçersiz." }, 403);
    }

    const auth = await authorized(context);
    if (auth.response) return auth.response;

    const id = Number(new URL(context.request.url).searchParams.get("id"));

    if (!Number.isInteger(id) || id < 1) {
      return json({ success: false, message: "Geçerli bir sayfa numarası belirtilmedi." }, 400);
    }

    const result = await context.env.DB.prepare(
      "DELETE FROM pages WHERE id = ?"
    ).bind(id).run();

    if (!result.meta.changes) {
      return json({ success: false, message: "Sayfa bulunamadı." }, 404);
    }

    return json({ success: true, message: "Sayfa silindi." });

  } catch (error) {
    return json({ success: false, message: "Sayfa silinemedi." }, 500);
  }
}
