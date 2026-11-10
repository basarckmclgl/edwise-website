
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

function errorResponse(message, fallback, status = 500) {
  return json({
    success: false,
    message: `${fallback}: ${String(message || "Bilinmeyen hata")}`
  }, status);
}

async function getServiceSchema(context) {
  const result = await context.env.DB
    .prepare("PRAGMA table_info('services')")
    .all();

  const columns = result.results || [];

  if (!columns.length) {
    throw new Error("services tablosu bulunamadı.");
  }

  const names = new Set(columns.map(column => column.name));

  const required = [
    "id",
    "title",
    "slug",
    "description",
    "image_url",
    "content",
    "status",
    "sort_order",
    "created_at",
    "updated_at"
  ];

  const missing = required.filter(name => !names.has(name));

  if (missing.length) {
    throw new Error(
      "Eksik veritabanı sütunları: " + missing.join(", ")
    );
  }

  return columns;
}

function isIntegerPrimaryKey(column) {
  return (
    column &&
    Number(column.pk) > 0 &&
    String(column.type || "").toUpperCase() === "INTEGER"
  );
}

function prepareServiceValues(body) {
  const title = clean(body.title, 200);
  const slug = clean(body.slug, 200).toLowerCase();
  const description = clean(body.description, 2000);
  const image_url = clean(body.image_url, 2000);
  const content = clean(body.content, 30000);

  const status =
    body.status === "published" ? "published" : "draft";

  const sort_order =
    body.sort_order === "" || body.sort_order == null
      ? 0
      : Number(body.sort_order);

  if (!title || !slug) {
    throw new Error("Hizmet başlığı ve bağlantı adı zorunludur.");
  }

  if (!validSlug(slug)) {
    throw new Error(
      "Bağlantı adı yalnızca küçük harf, rakam ve tire içerebilir."
    );
  }

  if (!Number.isFinite(sort_order)) {
    throw new Error("Sıralama değeri geçerli bir sayı olmalıdır.");
  }

  return {
    title,
    slug,
    description,
    image_url,
    content,
    status,
    sort_order
  };
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

    return json({
      success: true,
      services: results || []
    });
  } catch (error) {
    return errorResponse(
      error?.message,
      "Hizmetler alınamadı"
    );
  }
}

export async function onRequestPost(context) {
  const denied = await authorize(context);
  if (denied) return denied;

  try {
    const body = await context.request.json();
    const values = prepareServiceValues(body);

    const columns = await getServiceSchema(context);
    const idColumn = columns.find(column => column.name === "id");

    const now = new Date().toISOString();

    const integerId = isIntegerPrimaryKey(idColumn);

    const id = integerId ? null : crypto.randomUUID();

    const insertColumns = [
      ...(integerId ? [] : ["id"]),
      "title",
      "slug",
      "description",
      "image_url",
      "content",
      "status",
      "sort_order",
      "created_at",
      "updated_at"
    ];

    const insertValues = [
      ...(integerId ? [] : [id]),
      values.title,
      values.slug,
      values.description,
      values.image_url,
      values.content,
      values.status,
      values.sort_order,
      now,
      now
    ];

    const placeholders = insertColumns.map(() => "?").join(", ");

    const result = await context.env.DB.prepare(
      `INSERT INTO services (${insertColumns.join(", ")})
       VALUES (${placeholders})`
    ).bind(...insertValues).run();

    return json({
      success: true,
      message: "Hizmet oluşturuldu.",
      id: integerId
        ? result.meta?.last_row_id
        : id
    }, 201);

  } catch (error) {
    const message = String(error?.message || error);

    if (message.includes("UNIQUE")) {
      return errorResponse(
        "Bu bağlantı adı zaten kullanılıyor.",
        "Hizmet oluşturulamadı",
        409
      );
    }

    return errorResponse(
      message,
      "Hizmet oluşturulamadı"
    );
  }
}

export async function onRequestPut(context) {
  const denied = await authorize(context);
  if (denied) return denied;

  try {
    const body = await context.request.json();

    const id = clean(body.id, 100);

    if (!id) {
      return json({
        success: false,
        message: "Hizmet ID bilgisi zorunludur."
      }, 400);
    }

    const values = prepareServiceValues(body);
    const now = new Date().toISOString();

    const result = await context.env.DB.prepare(
      `UPDATE services
       SET title = ?,
           slug = ?,
           description = ?,
           image_url = ?,
           content = ?,
           status = ?,
           sort_order = ?,
           updated_at = ?
       WHERE id = ?`
    ).bind(
      values.title,
      values.slug,
      values.description,
      values.image_url,
      values.content,
      values.status,
      values.sort_order,
      now,
      id
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
    const message = String(error?.message || error);

    if (message.includes("UNIQUE")) {
      return errorResponse(
        "Bu bağlantı adı başka bir hizmette kullanılıyor.",
        "Hizmet güncellenemedi",
        409
      );
    }

    return errorResponse(
      message,
      "Hizmet güncellenemedi"
    );
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
    return errorResponse(
      error?.message,
      "Hizmet silinemedi"
    );
  }
}
