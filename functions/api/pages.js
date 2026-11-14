
import { requireEditor } from "./_auth.js";
import { logAudit } from "./_audit.js";

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

async function ensureTrashSchema(db) {
  try { await db.prepare("ALTER TABLE pages ADD COLUMN deleted_at TEXT").run(); }
  catch (error) {
    if (!/duplicate column|already exists/i.test(String(error?.message || error))) throw error;
  }
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

  if (!origin) return false;

  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function onRequestGet(context) {
  try {
    const auth = await authorized(context);
    if (auth.response) return auth.response;
    await ensureTrashSchema(context.env.DB);
    const view = new URL(context.request.url).searchParams.get("view");
    if (view === "history") {
      const id = Number(new URL(context.request.url).searchParams.get("id"));
      if (!Number.isInteger(id) || id < 1) return json({success:false,message:"Sayfa kimliği geçersiz."},400);
      const logs = await context.env.DB.prepare(`
        SELECT id, actor_username, action, entity_title, details_json, created_at
        FROM admin_audit_log WHERE entity_type = 'page' AND entity_id = ?
          AND action IN ('page_created','page_created_published','page_updated','page_published','page_unpublished','page_restored','page_version_restored')
        ORDER BY created_at DESC, id DESC LIMIT 100
      `).bind(String(id)).all();
      return json({success:true,history:(logs.results||[]).map(row=>({...row,details:row.details_json?JSON.parse(row.details_json):null}))});
    }
    const trashView = view === "trash";
    const result = await context.env.DB.prepare(`
      SELECT id, title, slug, content, meta_title,
             meta_description, status, created_at, updated_at, deleted_at
      FROM pages
      WHERE ${trashView ? "deleted_at IS NOT NULL" : "deleted_at IS NULL"}
      ORDER BY ${trashView ? "deleted_at" : "updated_at"} DESC
    `).all();

    const migration = await context.env.DB.prepare(
      "SELECT setting_value FROM site_settings WHERE setting_key = ? LIMIT 1"
    ).bind("static_pages_migrated_v1").first();

    return json({
      success: true,
      pages: result.results || [],
      staticPagesMigrated: migration?.setting_value === "done"
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
    await ensureTrashSchema(context.env.DB);

    if (data.action === "restore_version") {
      const id=Number(data.id), auditId=Number(data.audit_id);
      if(!Number.isInteger(id)||id<1||!Number.isInteger(auditId)||auditId<1)return json({success:false,message:"Sürüm bilgisi geçersiz."},400);
      const current=await context.env.DB.prepare("SELECT * FROM pages WHERE id=? AND deleted_at IS NULL").bind(id).first();
      const log=await context.env.DB.prepare("SELECT * FROM admin_audit_log WHERE id=? AND entity_type='page' AND entity_id=?").bind(auditId,String(id)).first();
      if(!current||!log)return json({success:false,message:"Sayfa veya sürüm kaydı bulunamadı."},404);
      let details;try{details=JSON.parse(log.details_json||"{}");}catch{return json({success:false,message:"Sürüm kaydı okunamadı."},400);}
      const target=details.before;
      if(!target||!target.title||!target.slug)return json({success:false,message:"Bu kayıt geri yüklenebilir bir sürüm içermiyor."},400);
      const duplicate=await context.env.DB.prepare("SELECT id FROM pages WHERE slug=? AND id!=? AND deleted_at IS NULL").bind(target.slug,id).first();
      if(duplicate)return json({success:false,message:"Eski URL başka bir aktif sayfada kullanılıyor."},409);
      await context.env.DB.prepare("UPDATE pages SET title=?,slug=?,content=?,meta_title=?,meta_description=?,status=?,updated_at=datetime('now') WHERE id=?")
        .bind(target.title,target.slug,target.content||"",target.meta_title||"",target.meta_description||"",target.status||"draft",id).run();
      const after=await context.env.DB.prepare("SELECT * FROM pages WHERE id=?").bind(id).first();
      await logAudit(context.env.DB,context.request,auth.admin,{action:"page_version_restored",entity_type:"page",entity_id:id,entity_title:after.title,details:{before:current,after,restored_from_audit_id:auditId}});
      return json({success:true,message:"Seçilen sürüm geri yüklendi."});
    }

    if (data.action === "restore") {
      const id = Number(data.id);
      if (!Number.isInteger(id) || id < 1) return json({ success: false, message: "Geçerli bir sayfa belirtilmedi." }, 400);
      const before = await context.env.DB.prepare("SELECT * FROM pages WHERE id = ? AND deleted_at IS NOT NULL").bind(id).first();
      if (!before) return json({ success: false, message: "Silinen sayfa bulunamadı." }, 404);
      const conflict = await context.env.DB.prepare("SELECT id FROM pages WHERE slug = ? AND deleted_at IS NULL LIMIT 1").bind(before.slug).first();
      if (conflict) return json({ success: false, message: "Aynı URL başka bir aktif sayfada kullanılıyor. Önce URL çakışmasını çözün." }, 409);
      await context.env.DB.prepare("UPDATE pages SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?").bind(id).run();
      const after = await context.env.DB.prepare("SELECT * FROM pages WHERE id = ?").bind(id).first();
      await logAudit(context.env.DB,context.request,auth.admin,{action:"page_restored",entity_type:"page",entity_id:id,entity_title:before.title,details:{before,after}});
      return json({ success: true, message: "Sayfa geri yüklendi." });
    }

    if (data.action === "import_static_pages") {
      const marker = await context.env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key = ? LIMIT 1").bind("static_pages_migrated_v1").first();
      if (marker?.setting_value === "done") {
        return json({ success: true, message: "Sabit sayfalar daha önce CMS'ye aktarılmış.", imported: 0, alreadyImported: true });
      }
      const records = Array.isArray(data.pages) ? data.pages : [];
      if (!records.length || records.length > 30) {
        return json({ success: false, message: "Aktarılacak sayfa listesi geçersiz." }, 400);
      }
      let imported = 0;
      for (const page of records) {
        const title = String(page.title || "").trim();
        const slug = makeSlug(page.slug);
        const content = String(page.content || "");
        const status = page.status === "published" ? "published" : "draft";
        if (!title || !slug || !content) continue;
        const existing = await context.env.DB.prepare("SELECT * FROM pages WHERE slug = ? LIMIT 1").bind(slug).first();
        if (existing) {
          await context.env.DB.prepare(`UPDATE pages SET title=?, content=?, meta_title=?, meta_description=?, status=?, updated_at=datetime('now') WHERE id=?`)
            .bind(title, content, String(page.meta_title || "").slice(0, 200), String(page.meta_description || "").slice(0, 500), status, existing.id).run();
        } else {
          await context.env.DB.prepare(`INSERT INTO pages (title,slug,content,meta_title,meta_description,status,created_at,updated_at) VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))`)
            .bind(title, slug, content, String(page.meta_title || "").slice(0, 200), String(page.meta_description || "").slice(0, 500), status).run();
        }
        const after = await context.env.DB.prepare("SELECT * FROM pages WHERE slug = ? LIMIT 1").bind(slug).first();
        await logAudit(context.env.DB,context.request,auth.admin,{action:existing?"page_import_updated":"page_imported",entity_type:"page",entity_id:after?.id,entity_title:title,details:{before:existing,after}});
        imported++;
      }
      await context.env.DB.prepare(`INSERT INTO site_settings (setting_key,setting_value,updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=datetime('now')`)
        .bind("static_pages_migrated_v1", "done").run();
      return json({ success: true, message: imported + " sabit sayfa CMS'ye aktarıldı.", imported });
    }

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

    const created = await context.env.DB.prepare("SELECT * FROM pages WHERE id = ?").bind(result.meta.last_row_id).first();
    await logAudit(context.env.DB,context.request,auth.admin,{action:status==="published"?"page_created_published":"page_created",entity_type:"page",entity_id:result.meta.last_row_id,entity_title:title,details:{before:null,after:created}});
    return json({
      success: true,
      message: "Sayfa oluşturuldu.",
      id: result.meta.last_row_id
    }, 201);

  } catch (error) {
    console.error("EDWISE PAGE CREATE ERROR", error);
    const detail = String(error?.message || error || "Bilinmeyen veritabanı hatası");
    return json({ success: false, message: "Sayfa oluşturulamadı: " + detail.slice(0, 240) }, 500);
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

    const before = await context.env.DB.prepare("SELECT * FROM pages WHERE id = ?").bind(id).first();
    if (!before) return json({ success: false, message: "Sayfa bulunamadı." }, 404);

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

    const after = await context.env.DB.prepare("SELECT * FROM pages WHERE id = ?").bind(id).first();
    const action = before.status !== status ? (status==="published"?"page_published":"page_unpublished") : "page_updated";
    await logAudit(context.env.DB,context.request,auth.admin,{action,entity_type:"page",entity_id:id,entity_title:title,details:{before,after}});
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

    await ensureTrashSchema(context.env.DB);
    const before = await context.env.DB.prepare("SELECT * FROM pages WHERE id = ? AND deleted_at IS NULL").bind(id).first();
    if (!before) return json({ success: false, message: "Sayfa bulunamadı." }, 404);
    const result = await context.env.DB.prepare(
      "UPDATE pages SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL"
    ).bind(id).run();

    if (!result.meta.changes) {
      return json({ success: false, message: "Sayfa bulunamadı." }, 404);
    }

    await logAudit(context.env.DB,context.request,auth.admin,{action:"page_deleted",entity_type:"page",entity_id:id,entity_title:before.title,details:{before,after:null}});
    return json({ success: true, message: "Sayfa silindi." });

  } catch (error) {
    return json({ success: false, message: "Sayfa silinemedi." }, 500);
  }
}
