
import { requireEditor } from "./_auth.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function checkOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;

  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function cleanSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function validatePost(data) {
  const title = String(data.title || "").trim();
  const slug = cleanSlug(data.slug || title);
  const status = data.status === "published" ? "published" : "draft";

  if (!title) throw new Error("Blog başlığı zorunludur.");
  if (!slug) throw new Error("Geçerli bir URL adresi girilmelidir.");

  return {
    title,
    slug,
    excerpt: String(data.excerpt || "").trim(),
    content: String(data.content || "").trim(),
    image_url: String(data.image_url || "").trim(),
    meta_title: String(data.meta_title || "").trim(),
    meta_description: String(data.meta_description || "").trim(),
    status
  };
}

function getRequestId(context, data = {}) {
  const url = new URL(context.request.url);

  return (
    data.id ??
    url.searchParams.get("id") ??
    context.params?.id ??
    null
  );
}

export async function onRequestGet(context) {
  const auth = await requireEditor(context);
  if (auth.response) return auth.response;

  try {
    const { results } = await context.env.DB.prepare(
      "SELECT id, title, slug, excerpt, content, image_url, meta_title, meta_description, status, published_at, created_at, updated_at FROM posts ORDER BY created_at DESC"
    ).all();

    return json({
      success: true,
      posts: results || []
    });
  } catch (error) {
    console.error("Posts GET error:", error);
    return json({
      success: false,
      message: "Blog yazıları alınamadı."
    }, 500);
  }
}

export async function onRequestPost(context) {
  const auth = await requireEditor(context);
  if (auth.response) return auth.response;

  if (!(await checkOrigin(context.request))) {
    return json({
      success: false,
      message: "Geçersiz istek kaynağı."
    }, 403);
  }

  try {
    const data = await context.request.json();
    const post = validatePost(data);
    const DB = context.env.DB;

    const columns = [
      "title",
      "slug",
      "excerpt",
      "content",
      "image_url",
      "meta_title",
      "meta_description",
      "status",
      "published_at"
    ];

    const values = [
      post.title,
      post.slug,
      post.excerpt,
      post.content,
      post.image_url,
      post.meta_title,
      post.meta_description,
      post.status,
      post.status === "published" ? new Date().toISOString() : null
    ];

    const tableInfo = await DB.prepare(
      "PRAGMA table_info(posts)"
    ).all();

    const idColumn = (tableInfo.results || []).find(
      column => column.name === "id"
    );

    if (!idColumn) {
      throw new Error("Posts tablosunda ID sütunu bulunamadı.");
    }

    const isInteger = String(idColumn.type || "")
      .toUpperCase()
      .includes("INT");

    if (!isInteger) {
      if (Number(idColumn.pk) < 1) {
        throw new Error("Posts ID sütunu birincil anahtar değil.");
      }

      columns.unshift("id");
      values.unshift(crypto.randomUUID());
    }

    const placeholders = columns.map(() => "?").join(", ");

    const result = await DB.prepare(
      `INSERT INTO posts (${columns.join(", ")}) VALUES (${placeholders})`
    ).bind(...values).run();

    const newId = isInteger
      ? result.meta?.last_row_id
      : values[0];

    return json({
      success: true,
      id: newId,
      message: post.status === "published"
        ? "Blog yazısı başarıyla yayımlandı."
        : "Blog yazısı taslak olarak kaydedildi."
    }, 201);

  } catch (error) {
    console.error("Posts POST error:", error);
    return json({
      success: false,
      message: error.message || "Blog yazısı kaydedilemedi."
    }, 400);
  }
}

export async function onRequestPut(context) {
  const auth = await requireEditor(context);
  if (auth.response) return auth.response;

  if (!(await checkOrigin(context.request))) {
    return json({
      success: false,
      message: "Geçersiz istek kaynağı."
    }, 403);
  }

  try {
    const data = await context.request.json();
    const id = getRequestId(context, data);

    if (id === undefined || id === null || String(id).trim() === "") {
      return json({
        success: false,
        message: "Düzenlenecek blog yazısının ID bilgisi eksik."
      }, 400);
    }

    const post = validatePost(data);
    const DB = context.env.DB;

    const existing = await DB.prepare(
      "SELECT id, published_at FROM posts WHERE id = ?"
    ).bind(id).first();

    if (!existing) {
      return json({
        success: false,
        message: "Blog yazısı bulunamadı."
      }, 404);
    }

    let publishedAt = existing.published_at || null;

    if (post.status === "published" && !publishedAt) {
      publishedAt = new Date().toISOString();
    }

    if (post.status === "draft") {
      publishedAt = null;
    }

    await DB.prepare(
      "UPDATE posts SET title = ?, slug = ?, excerpt = ?, content = ?, image_url = ?, meta_title = ?, meta_description = ?, status = ?, published_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(
      post.title,
      post.slug,
      post.excerpt,
      post.content,
      post.image_url,
      post.meta_title,
      post.meta_description,
      post.status,
      publishedAt,
      id
    ).run();

    return json({
      success: true,
      id,
      message: "Blog yazısı başarıyla güncellendi."
    });

  } catch (error) {
    console.error("Posts PUT error:", error);
    return json({
      success: false,
      message: error.message || "Blog yazısı güncellenemedi."
    }, 400);
  }
}

export async function onRequestDelete(context) {
  
  const auth = await requireEditor(context);
  if (auth.response) return auth.response;

  if (!(await checkOrigin(context.request))) {
    return json({
      success: false,
      message: "Geçersiz istek kaynağı."
    }, 403);
  }

  try {
    const url = new URL(context.request.url);
    let id = url.searchParams.get("id");

    if (!id) {
      const data = await context.request.json().catch(() => ({}));
      id = getRequestId(context, data);
    }

    if (id === undefined || id === null || String(id).trim() === "") {
      return json({
        success: false,
        message: "Silinecek blog yazısının ID bilgisi eksik."
      }, 400);
    }

    const result = await context.env.DB.prepare(
      "DELETE FROM posts WHERE id = ?"
    ).bind(id).run();

    if (!result.meta?.changes) {
      return json({
        success: false,
        message: "Blog yazısı bulunamadı."
      }, 404);
    }

    return json({
      success: true,
      id,
      message: "Blog yazısı başarıyla silindi."
    });

  } catch (error) {
    console.error("Posts DELETE error:", error);
    return json({
      success: false,
      message: error.message || "Blog yazısı silinemedi."
    }, 500);
  }
}
