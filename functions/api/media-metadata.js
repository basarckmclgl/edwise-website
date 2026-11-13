import { requireEditor } from "./_auth.js";
import { logAudit } from "./_audit.js";

const CREATE_METADATA = `
CREATE TABLE IF NOT EXISTS media_metadata (
 media_id INTEGER PRIMARY KEY,
 byte_size INTEGER,
 alt_text TEXT NOT NULL DEFAULT '',
 title TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
)`;

export async function onRequestPut(context) {
  const origin=context.request.headers.get("Origin");
  try { if(!origin||origin!==new URL(context.request.url).origin)return Response.json({success:false,error:"İstek kaynağı geçersiz."},{status:403}); } catch { return Response.json({success:false,error:"İstek kaynağı geçersiz."},{status:403}); }
  const auth=await requireEditor(context);
  if(auth.response)return auth.response;
  try {
    const db=context.env.DB;
    await db.prepare(CREATE_METADATA).run();
    const body=await context.request.json();
    const id=Number(body.media_id);
    if(!Number.isSafeInteger(id)||id<1)return Response.json({success:false,error:"Geçersiz medya kaydı."},{status:400});
    const clean=(v,max)=>typeof v==="string"?v.trim().slice(0,max):"";
    const alt=clean(body.alt_text,500),title=clean(body.title,250),description=clean(body.description,3000);
    const record=await db.prepare("SELECT id,file_name FROM media WHERE id=?").bind(id).first();
    if(!record)return Response.json({success:false,error:"Medya kaydı bulunamadı."},{status:404});
    await db.prepare(`INSERT INTO media_metadata(media_id,alt_text,title,description,updated_at)
      VALUES(?,?,?,?,datetime('now'))
      ON CONFLICT(media_id) DO UPDATE SET alt_text=excluded.alt_text,title=excluded.title,description=excluded.description,updated_at=datetime('now')`)
      .bind(id,alt,title,description).run();
    await logAudit(db,context.request,auth.admin,{action:"media_metadata_updated",entity_type:"media",entity_id:id,entity_title:record.file_name,details:{alt_text:alt,title,description}});
    return Response.json({success:true,message:"Medya bilgileri kaydedildi."});
  } catch(error) {
    return Response.json({success:false,error:error?.message||"Medya bilgileri kaydedilemedi."},{status:500});
  }
}