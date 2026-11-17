import { requireAdmin } from "./_auth.js";
function json(data,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store"}});}
async function hashToken(token){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");}
export async function onRequestGet(context){
 try{
  const auth=await requireAdmin(context);if(auth.response)return auth.response;
  const cookie=context.request.headers.get("Cookie")||"",match=cookie.match(/(?:^|;\s*)edwise_session=([a-f0-9]{64})(?:;|$)/i);
  if(!match)return json({success:false,message:"Oturum doğrulanamadı."},401);
  const db=context.env.DB,currentHash=await hashToken(match[1]);
  const current=await db.prepare("SELECT expires_at FROM admin_sessions WHERE admin_id=? AND token_hash=? AND datetime(expires_at)>datetime('now') LIMIT 1").bind(auth.admin.id,currentHash).first();
  if(!current)return json({success:false,message:"Aktif oturum bulunamadı."},401);
  const count=await db.prepare("SELECT COUNT(*) AS total FROM admin_sessions WHERE admin_id=? AND token_hash<>? AND datetime(expires_at)>datetime('now')").bind(auth.admin.id,currentHash).first();
  return json({success:true,currentExpiresAt:current.expires_at,otherSessionCount:Number(count?.total||0)});
 }catch(error){console.error("EDWISE SESSIONS GET ERROR:",error);return json({success:false,message:"Oturum bilgileri alınamadı."},500);}
}
export async function onRequestPost(context){
 const {request}=context;const origin=request.headers.get("Origin");if(!origin||origin!==new URL(request.url).origin)return json({success:false,message:"İstek kaynağı geçersiz."},403);
 try{
  const auth=await requireAdmin(context);if(auth.response)return auth.response;
  const cookie=request.headers.get("Cookie")||"",match=cookie.match(/(?:^|;\s*)edwise_session=([a-f0-9]{64})(?:;|$)/i);
  if(!match)return json({success:false,message:"Oturum doğrulanamadı."},401);
  const db=context.env.DB,currentHash=await hashToken(match[1]);
  const result=await db.prepare("DELETE FROM admin_sessions WHERE admin_id=? AND token_hash<>?").bind(auth.admin.id,currentHash).run();
  return json({success:true,message:"Diğer cihazlardaki oturumlar kapatıldı.",revoked:Number(result?.meta?.changes||0)});
 }catch(error){console.error("EDWISE SESSIONS POST ERROR:",error);return json({success:false,message:"Diğer oturumlar kapatılamadı."},500);}
}
