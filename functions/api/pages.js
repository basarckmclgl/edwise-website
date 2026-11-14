
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

async function ensurePagesSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL DEFAULT '',
      meta_title TEXT NOT NULL DEFAULT '',
      meta_description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      page_path TEXT
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS site_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  try { await db.prepare("ALTER TABLE pages ADD COLUMN page_path TEXT").run(); } catch (error) { if (!/duplicate column|already exists/i.test(String(error?.message || error))) throw error; }
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_pages_status_updated ON pages(status, updated_at DESC)").run();
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
    await ensurePagesSchema(context.env.DB);
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
    const staticTrashRow = await context.env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key = 'static_page_trash' LIMIT 1").first();
    let staticTrash = []; try { staticTrash = JSON.parse(staticTrashRow?.setting_value || "[]"); } catch {}
    const result = await context.env.DB.prepare(`
      SELECT id, title, slug, content, meta_title,
             meta_description, status, created_at, updated_at, deleted_at, page_path
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
      staticPages: trashView ? staticTrash : [],
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
    await ensurePagesSchema(context.env.DB);
    await ensureTrashSchema(context.env.DB);

    if (data.action === "static_delete" || data.action === "static_restore") {
      const pagePath=String(data.page_path||"").trim(), title=String(data.title||"").trim().slice(0,160);
      if(!pagePath.startsWith("/")||pagePath.startsWith("//")||pagePath.includes("..")||/[?#]/.test(pagePath)||pagePath==="/")return json({success:false,message:"Sayfa yolu geçersiz."},400);
      const key="static_page_trash", row=await context.env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key=? LIMIT 1").bind(key).first();
      let trash=[];try{trash=JSON.parse(row?.setting_value||"[]");}catch{} if(!Array.isArray(trash))trash=[];
      if(data.action==="static_delete"){
        if(trash.some(x=>x.page_path===pagePath))return json({success:false,message:"Sayfa zaten silinmiş."},409);
        const menuRow=await context.env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='menu_theme' LIMIT 1").first();
        let menu=[];try{menu=JSON.parse(menuRow?.setting_value||"[]");}catch{}
        const removed=Array.isArray(menu)?menu.filter(item=>{try{return new URL(item.url,context.request.url).pathname===pagePath;}catch{return false;}}):[];
        const next=Array.isArray(menu)?menu.filter(item=>!removed.includes(item)):[];
        trash.push({page_path:pagePath,title:title||pagePath,deleted_at:new Date().toISOString(),removedMenuItems:removed});
        const value=JSON.stringify(trash);
        if(row)await context.env.DB.prepare("UPDATE site_settings SET setting_value=?,updated_at=datetime('now') WHERE setting_key=?").bind(value,key).run();
        else await context.env.DB.prepare("INSERT INTO site_settings(setting_key,setting_value,updated_at) VALUES(?,?,datetime('now'))").bind(key,value).run();
        if(menuRow)await context.env.DB.prepare("UPDATE site_settings SET setting_value=?,updated_at=datetime('now') WHERE setting_key='menu_theme'").bind(JSON.stringify(next)).run();
        await logAudit(context.env.DB,context.request,auth.admin,{action:"static_page_deleted",entity_type:"page",entity_id:"static:"+pagePath,entity_title:title||pagePath,details:{page_path:pagePath,removedMenuItems:removed}});
        return json({success:true,message:"Sayfa yayımlanmış siteden kaldırıldı."});
      }
      const item=trash.find(x=>x.page_path===pagePath);if(!item)return json({success:false,message:"Silinen sayfa kaydı bulunamadı."},404);
      trash=trash.filter(x=>x.page_path!==pagePath);
      await context.env.DB.prepare("UPDATE site_settings SET setting_value=?,updated_at=datetime('now') WHERE setting_key=?").bind(JSON.stringify(trash),key).run();
      if(item.removedMenuItems?.length){
        const menuRow=await context.env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='menu_theme' LIMIT 1").first();
        let menu=[];try{menu=JSON.parse(menuRow?.setting_value||"[]");}catch{}
        const restored=[...menu,...item.removedMenuItems.filter(old=>!menu.some(cur=>cur.key===old.key||cur.url===old.url))];
        if(menuRow)await context.env.DB.prepare("UPDATE site_settings SET setting_value=?,updated_at=datetime('now') WHERE setting_key='menu_theme'").bind(JSON.stringify(restored)).run();
      }
      await logAudit(context.env.DB,context.request,auth.admin,{action:"static_page_restored",entity_type:"page",entity_id:"static:"+pagePath,entity_title:item.title||pagePath,details:{page_path:pagePath}});
      return json({success:true,message:"Sayfa yeniden yayıma açıldı."});
    }

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
    const pagePath = String(data.page_path || "").trim().slice(0,300);
    if (pagePath && (!pagePath.startsWith("/") || pagePath.startsWith("//") || pagePath.includes("..") || /[?#]/.test(pagePath))) return json({success:false,message:"Sayfa yolu geçersiz."},400);
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
      (title, slug, content, meta_title, meta_description, status, page_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      title, slug, content, metaTitle, metaDescription, status, pagePath || null
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
    await ensurePagesSchema(context.env.DB);
    await ensureTrashSchema(context.env.DB);
    const id = Number(data.id);
    const title = String(data.title || "").trim();
    const slug = makeSlug(data.slug || title);
    const content = String(data.content || "");
    const metaTitle = String(data.meta_title || "").trim();
    const metaDescription = String(data.meta_description || "").trim();
    const pagePath = String(data.page_path || "").trim().slice(0,300);
    if (pagePath && (!pagePath.startsWith("/") || pagePath.startsWith("//") || pagePath.includes("..") || /[?#]/.test(pagePath))) return json({success:false,message:"Sayfa yolu geçersiz."},400);
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
          meta_description = ?, status = ?, page_path = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      title, slug, content, metaTitle, metaDescription, status, pagePath || null, id
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

    await ensurePagesSchema(context.env.DB);
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
