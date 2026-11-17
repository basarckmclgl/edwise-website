import { requireEditor } from "./_auth.js";
import { logAudit } from "./_audit.js";

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin");
  try { if(!origin || origin !== new URL(context.request.url).origin) return Response.json({success:false,error:"İstek kaynağı geçersiz."},{status:403}); } catch { return Response.json({success:false,error:"İstek kaynağı geçersiz."},{status:403}); }
  const auth = await requireEditor(context);
  if (auth.response) return auth.response;

  const { request, env } = context;

  try {
    const db = env["edwise-deneme"];
    const storageBranch = "onizleme";
    if (!db || !env.GITHUB_TOKEN || !env.GITHUB_REPO) {
      return Response.json({ success: false, error: "Sunucu ayarları eksik." }, { status: 500 });
    }

    await db.prepare(`CREATE TABLE IF NOT EXISTS media (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 file_name TEXT NOT NULL UNIQUE,
 file_url TEXT NOT NULL,
 file_type TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`).run();

    const body = await request.json();
    let fileName = typeof body.file_name === "string" ? body.file_name : "";

    // Geriye dönük uyumluluk: eski raw GitHub adresleri ve yeni /api/media/ adresleri.
    if (!fileName && typeof body.file_url === "string") {
      try {
        const url = new URL(body.file_url, "https://edwisedanismanlik.com");
        const apiMatch = url.pathname.match(/^\/api\/media\/([a-f0-9-]{36}\.(?:jpg|png|webp|gif))$/i);
        const rawMatch = url.pathname.match(/^\/basarckmclgl\/edwise-website\/main\/media\/([a-f0-9-]{36}\.(?:jpg|png|webp|gif))$/i);
        const legacyMatch = url.pathname.match(/\/media\/([a-f0-9-]{36}\.(?:jpg|png|webp|gif))$/i);
        fileName = (apiMatch || rawMatch || legacyMatch)?.[1] || "";
      } catch (_) {}
    }

    if (!/^[a-f0-9-]{36}\.(jpg|png|webp|gif)$/i.test(fileName)) {
      return Response.json({ success: false, error: "Geçersiz görsel adresi veya dosya adı." }, { status: 400 });
    }

    const before = await db.prepare("SELECT * FROM media WHERE file_name = ?").bind(fileName).first();
    const apiUrl = "https://api.github.com/repos/" + env.GITHUB_REPO +
      "/contents/media/" + encodeURIComponent(fileName) + "?ref=" + storageBranch;
    const headers = {
      "Authorization": "Bearer " + env.GITHUB_TOKEN,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "EDWISE-CMS"
    };

    const fileResponse = await fetch(apiUrl, { headers });
    if (fileResponse.status === 404) {
      // Depoda zaten yoksa bile yetim veritabanı kaydını temizle.
      await db.prepare("DELETE FROM media WHERE file_name = ?").bind(fileName).run();
      await logAudit(db,request,auth.admin,{action:"media_deleted",entity_type:"media",entity_id:fileName,entity_title:fileName,details:{before:before||{file_name:fileName},after:null,storage_state:"already_missing"}});
      return Response.json({ success: true, message: "Dosya depoda yoktu; medya kaydı temizlendi." });
    }
    if (!fileResponse.ok) {
      return Response.json({ success: false, error: "Görsel deposundan silme bilgisi alınamadı." }, { status: 502 });
    }

    const fileData = await fileResponse.json();
    const deleteResponse = await fetch(apiUrl, {
      method: "DELETE",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "EDWISE CMS: " + fileName + " silindi",
        sha: fileData.sha,
        branch: storageBranch
      })
    });

    if (!deleteResponse.ok) {
      const details = await deleteResponse.json().catch(() => ({}));
      return Response.json({
        success: false,
        error: details.message || "Görsel GitHub üzerinden silinemedi."
      }, { status: 502 });
    }

    await db.prepare("DELETE FROM media WHERE file_name = ?").bind(fileName).run();
    await logAudit(db,request,auth.admin,{action:"media_deleted",entity_type:"media",entity_id:fileName,entity_title:fileName,details:{before:{...(before||{file_name:fileName}),github_sha:fileData.sha},after:null}});
    return Response.json({ success: true, message: "Görsel başarıyla silindi." });
  } catch (error) {
    return Response.json({
      success: false,
      error: error?.message || "Silme işlemi başarısız."
    }, { status: 500 });
  }
}