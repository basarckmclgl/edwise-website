import { requireSuperAdmin } from "./_auth.js";
import { ensureAuditTable, logAudit } from "./_audit.js";

function json(data,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store"}})}
function originOk(request){const origin=request.headers.get("Origin");try{return !!origin&&origin===new URL(request.url).origin}catch{return false}}

export async function onRequestGet(context){
 const auth=await requireSuperAdmin(context);if(auth.response)return auth.response;
 let stage="audit_table_setup";
 try{
  await ensureAuditTable(context.env.DB);
  stage="audit_query";
  const url=new URL(context.request.url);
  const limit=Math.min(200,Math.max(1,Number(url.searchParams.get("limit"))||100));
  const actor=url.searchParams.get("actor");
  const action=url.searchParams.get("action");
  let sql="SELECT id,actor_id,actor_username,actor_role,action,entity_type,entity_id,entity_title,details_json,ip_address,user_agent,created_at FROM admin_audit_log WHERE 1=1";
  const values=[];
  if(actor){sql+=" AND actor_id = ?";values.push(Number(actor))}
  if(action){sql+=" AND action = ?";values.push(action)}
  sql+=" ORDER BY id DESC LIMIT ?";
  values.push(limit);
  const rows=await context.env.DB.prepare(sql).bind(...values).all();
  return json({success:true,events:(rows.results||[]).map(row=>({...row,details:(()=>{try{return JSON.parse(row.details_json||"{}")}catch{return {}}})()}))});
 }catch(error){console.error("Audit GET",stage,error);return json({success:false,message:"İşlem geçmişi alınamadı.",diagnostic:{stage,error:String(error?.message||error).slice(0,500)}},500)}
}

export async function onRequestPost(context){
 if(!originOk(context.request))return json({success:false,message:"İstek kaynağı geçersiz."},403);
 const auth=await requireSuperAdmin(context);if(auth.response)return auth.response;
 const db=context.env.DB;
 try{
  await ensureAuditTable(db);
  const data=await context.request.json();
  if(data.action==="revoke_editor"){
   const id=Number(data.user_id);
   if(!Number.isInteger(id)||id<1||id===Number(auth.admin.id))return json({success:false,message:"Geçersiz kullanıcı."},400);
   const target=await db.prepare("SELECT id,username,role FROM admins WHERE id=?").bind(id).first();
   if(!target||target.role==="superadmin")return json({success:false,message:"Bu hesap durdurulamaz."},403);
   await db.prepare("UPDATE admins SET is_active=0,updated_at=datetime('now') WHERE id=?").bind(id).run();
   await db.prepare("DELETE FROM admin_sessions WHERE admin_id=?").bind(id).run();
   await logAudit(db,context.request,auth.admin,{action:"access_revoked",entity_type:"admin",entity_id:id,entity_title:target.username,details:{reason:String(data.reason||"Ana yönetici müdahalesi").slice(0,500)}});
   return json({success:true,message:"Editör hesabı devre dışı bırakıldı ve tüm oturumları kapatıldı."});
  }
  if(data.action==="restore"){
   const eventId=Number(data.event_id);
   const event=await db.prepare("SELECT * FROM admin_audit_log WHERE id=?").bind(eventId).first();
   if(!event)return json({success:false,message:"Geçmiş kaydı bulunamadı."},404);
   let details={};try{details=JSON.parse(event.details_json||"{}")}catch{}
   const snapshot=details.before||details.snapshot;
   if(!snapshot)return json({success:false,message:"Bu kayıt için geri yüklenebilir bir önceki sürüm saklanmamış."},409);
   if(event.entity_type==="page"){
    if(snapshot.id!=null){
     await db.prepare(`INSERT INTO pages(id,title,slug,content,meta_title,meta_description,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,datetime('now'),datetime('now')) ON CONFLICT(id) DO UPDATE SET title=excluded.title,slug=excluded.slug,content=excluded.content,meta_title=excluded.meta_title,meta_description=excluded.meta_description,status=excluded.status,updated_at=datetime('now')`).bind(snapshot.id,snapshot.title,snapshot.slug,snapshot.content||"",snapshot.meta_title||"",snapshot.meta_description||"",snapshot.status||"draft").run();
    }else{return json({success:false,message:"Sayfa yedeği eksik."},409)}
   }else if(event.entity_type==="post"){
    await db.prepare(`INSERT INTO posts(id,title,slug,excerpt,content,image_url,meta_title,meta_description,status,published_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now')) ON CONFLICT(id) DO UPDATE SET title=excluded.title,slug=excluded.slug,excerpt=excluded.excerpt,content=excluded.content,image_url=excluded.image_url,meta_title=excluded.meta_title,meta_description=excluded.meta_description,status=excluded.status,published_at=excluded.published_at,updated_at=datetime('now')`).bind(snapshot.id,snapshot.title,snapshot.slug,snapshot.excerpt||"",snapshot.content||"",snapshot.image_url||"",snapshot.meta_title||"",snapshot.meta_description||"",snapshot.status||"draft",snapshot.published_at||null).run();
   }else if(event.entity_type==="media"){
    if(!snapshot.file_name||!snapshot.github_sha||!context.env.GITHUB_TOKEN||!context.env.GITHUB_REPO)return json({success:false,message:"Görselin geri yüklenebilir GitHub sürüm bilgisi bulunamadı."},409);
    const headers={"Authorization":"Bearer "+context.env.GITHUB_TOKEN,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"EDWISE-CMS"};
    const blobResponse=await fetch("https://api.github.com/repos/"+context.env.GITHUB_REPO+"/git/blobs/"+snapshot.github_sha,{headers});
    if(!blobResponse.ok)return json({success:false,message:"Görsel yedeği GitHub deposundan alınamadı."},502);
    const blob=await blobResponse.json();
    const putResponse=await fetch("https://api.github.com/repos/"+context.env.GITHUB_REPO+"/contents/media/"+encodeURIComponent(snapshot.file_name),{method:"PUT",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({message:"EDWISE CMS: görsel geri yüklendi - "+snapshot.file_name,content:blob.content,branch:"main"})});
    if(!putResponse.ok)return json({success:false,message:"Görsel dosyası depoya geri yüklenemedi."},502);
    await db.prepare("DELETE FROM media WHERE file_name=?").bind(snapshot.file_name).run();
    await db.prepare("INSERT INTO media(file_name,file_url,file_type,created_at) VALUES(?,?,?,datetime('now'))").bind(snapshot.file_name,snapshot.file_url||("/api/media/"+snapshot.file_name),snapshot.file_type||"image/jpeg").run();
   }else{return json({success:false,message:"Bu kayıt türü için geri yükleme desteklenmiyor."},409)}
   await logAudit(db,context.request,auth.admin,{action:"version_restored",entity_type:event.entity_type,entity_id:event.entity_id,entity_title:event.entity_title,details:{restored_from_event:eventId}});
   return json({success:true,message:"Önceki sürüm geri yüklendi."});
  }
  return json({success:false,message:"Bilinmeyen işlem."},400);
 }catch(error){console.error("Audit POST",error);return json({success:false,message:"İşlem tamamlanamadı."},500)}
}
