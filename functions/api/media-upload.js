
import { requireEditor } from "./_auth.js";
import { logAudit } from "./_audit.js";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 8192;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, i + chunkSize)
    );
  }

  return btoa(binary);
}

function checkOrigin(request){const origin=request.headers.get("Origin");try{return !!origin&&origin===new URL(request.url).origin}catch{return false}}

function validImageSignature(bytes,type){
 if(type==="image/png")return bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
 if(type==="image/jpeg")return bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(type==="image/gif")return bytes.length>=6&&String.fromCharCode(...bytes.subarray(0,6)).match(/^GIF8[79]a$/);
 if(type==="image/webp")return bytes.length>=12&&String.fromCharCode(...bytes.subarray(0,4))==="RIFF"&&String.fromCharCode(...bytes.subarray(8,12))==="WEBP";
 return false;
}

export async function onRequestPost(context) {
  try {
    if(!checkOrigin(context.request))return json({error:"İstek kaynağı geçersiz."},403);
    const auth = await requireEditor(context);

    if (auth.response) return auth.response;

    const token = context.env.GITHUB_TOKEN;
    const repo = context.env.GITHUB_REPO;
    const db = context.env.DB;

    if (!token || !repo || !db) {
      return json({
        error: "GitHub veya veritabanı bağlantısı bulunamadı."
      }, 500);
    }

    const form = await context.request.formData();
    const file = form.get("file");

    if (!file || typeof file.arrayBuffer !== "function" || !file.size) {
      return json({ error: "Lütfen bir görsel seç." }, 400);
    }

    if (!ALLOWED_TYPES[file.type]) {
      return json({
        error: "JPG, PNG, WEBP veya GIF dosyası seçmelisin."
      }, 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return json({
        error: "Dosya boyutu en fazla 5 MB olabilir."
      }, 400);
    }

    const extension = ALLOWED_TYPES[file.type];
    const filename = `${crypto.randomUUID()}.${extension}`;
    const path = `media/${filename}`;
    const url = `/api/media/${filename}`;

    const bytes = new Uint8Array(await file.arrayBuffer());
    if(!validImageSignature(bytes,file.type))return json({error:"Dosya içeriği seçilen görsel türüyle eşleşmiyor."},400);

    const githubResponse = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "EDWISE-CMS"
        },
        body: JSON.stringify({
          message: `EDWISE CMS görseli: ${filename}`,
          content: toBase64(bytes),
          branch: "main"
        })
      }
    );

    const githubData = await githubResponse.json();

    if (!githubResponse.ok) {
      return json({
        error: githubData.message || "GitHub yüklemesi başarısız."
      }, 502);
    }

    try {
      await db.prepare(`
        INSERT INTO media
          (file_name, file_url, file_type, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).bind(filename, url, file.type).run();

    } catch (dbError) {
      await logAudit(db,context.request,auth.admin,{action:"media_uploaded",entity_type:"media",entity_id:filename,entity_title:filename,details:{before:null,after:{file_name:filename,file_url:url,file_type:file.type},database_record_warning:true}});
      return json({
        success: true,
        warning: "Görsel GitHub'a yüklendi ancak veritabanı kaydı başarısız.",
        filename,
        url
      }, 207);
    }

    const mediaRecord = await db.prepare("SELECT * FROM media WHERE file_name = ?").bind(filename).first();
    await logAudit(db,context.request,auth.admin,{action:"media_uploaded",entity_type:"media",entity_id:filename,entity_title:filename,details:{before:null,after:mediaRecord||{file_name:filename,file_url:url,file_type:file.type}}});
    return json({
      success: true,
      filename,
      url,
      message: "Görsel yüklendi ve medya kütüphanesine kaydedildi."
    });

  } catch (error) {
    return json({
      error: `Sunucu hatası: ${error?.message || "Bilinmeyen hata"}`
    }, 500);
  }
}
