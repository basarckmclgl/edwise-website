
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

async function authorize(context) {
  const auth = await requireEditor(context);
  if (auth.response) return auth.response;
  return null;
}

function clean(value, maxLength = 10000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function validSlug(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export async function onRequestGet(context) {
  const denied = await authorize(context);
  if (denied) return denied;

  try {
    const { results } = await context.env.DB.prepare(
      `SELECT id, title, slug, description, image_url,
              content, status, sort_order, created_at, updated_at
       FROM services
       ORDER BY sort_order ASC, created_at DESC`
    ).all();

    return json({ success: true, services: results || [] });
  } catch (error) {
    return json({
      success: false,
      message: "Hizmetler alınamadı."
    }, 500);
  }
}

export async function onRequestPost(context) {
  const denied = await authorize(context);
  if (denied) return denied;

  try {
    const body = await context.request.json();

    const title = clean(body.title, 200);
    const slug = clean(body.slug, 200).toLowerCase();
    const description = clean(body.description, 2000);
    const image_url = clean(body.image_url, 2000);
    const content = clean(body.content, 30000);
    const status = body.status === "published" ? "published" : "draft";
    const sort_order = Number.isFinite(Number(body.sort_order))
      ? Number(body.sort_order)
      : 0;

    if (!title || !slug) {
      return json({
        success: false,
        message: "Hizmet başlığı ve bağlantı adı zorunludur."
      }, 400);
    }

    if (!validSlug(slug)) {
      return json({
        success: false,
        message: "Bağlantı adı yalnızca küçük harf, rakam ve tire içerebilir."
      }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await context.env.DB.prepare(
      `INSERT INTO services
       (id, title, slug, description, image_url, content,
        status, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, title, slug, description, image_url, content,
      status, sort_order, now, now
    ).run();

    return json({
      success: true,
      message: "Hizmet oluşturuldu.",
      id
    }, 201);

  } catch (error) {
    const message = String(error?.message || "");

    if (message.includes("UNIQUE")) {
      return json({
        success: false,
        message: "Bu bağlantı adı zaten kullanılıyor."
      }, 409);
    }

      return json({
        success: false,
        message: "Hizmet oluşturulamadı: " + String(error?.message || error)
      }, 500);
    }
}

export async function onRequestPut(context) {
  const denied = await authorize(context);
  if (denied) return denied;

  try {
    const body = await context.request.json();

    const id = clean(body.id, 100);
    const title = clean(body.title, 200);
    const slug = clean(body.slug, 200).toLowerCase();
    const description = clean(body.description, 2000);
    const image_url = clean(body.image_url, 2000);
    const content = clean(body.content, 30000);
    const status = body.status === "published" ? "published" : "draft";
    const sort_order = Number.isFinite(Number(body.sort_order))
      ? Number(body.sort_order)
      : 0;

    if (!id || !title || !slug) {
      return json({
        success: false,
        message: "ID, başlık ve bağlantı adı zorunludur."
      }, 400);
    }

    if (!validSlug(slug)) {
      return json({
        success: false,
        message: "Bağlantı adı geçersiz."
      }, 400);
    }

    const now = new Date().toISOString();

    const result = await context.env.DB.prepare(
      `UPDATE services
       SET title = ?, slug = ?, description = ?, image_url = ?,
           content = ?, status = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      title, slug, description, image_url, content,
      status, sort_order, now, id
    ).run();

    if (!result.meta?.changes) {
      return json({
        success: false,
        message: "Hizmet bulunamadı."
      }, 404);
    }

    return json({
      success: true,
      message: "Hizmet güncellendi."
    });

  } catch (error) {
    const message = String(error?.message || "");

    if (message.includes("UNIQUE")) {
      return json({
        success: false,
        message: "Bu bağlantı adı başka bir hizmette kullanılıyor."
      }, 409);
    }

    return json({
      success: false,
      message: "Hizmet güncellenemedi."
    }, 500);
  }
}

export async function onRequestDelete(context) {
  const denied = await authorize(context);
  if (denied) return denied;

  try {
    const body = await context.request.json();
    const id = clean(body.id, 100);

    if (!id) {
      return json({
        success: false,
        message: "Silinecek hizmetin ID bilgisi gerekli."
      }, 400);
    }

    const result = await context.env.DB.prepare(
      "DELETE FROM services WHERE id = ?"
    ).bind(id).run();

    if (!result.meta?.changes) {
      return json({
        success: false,
        message: "Hizmet bulunamadı."
      }, 404);
    }

    return json({
      success: true,
      message: "Hizmet silindi."
    });

  } catch (error) {
    return json({
      success: false,
      message: "Hizmet silinemedi."
    }, 500);
  }
}
