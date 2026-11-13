import { requireSuperAdmin } from "./_auth.js";
import { logAudit } from "./_audit.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
function originOk(request){try{return !!request.headers.get("Origin")&&request.headers.get("Origin")===new URL(request.url).origin}catch{return false}}
export async function onRequestGet(context){
 const auth=await requireSuperAdmin(context);if(auth.response)return auth.response;
 try{const row=await context.env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='site_status' LIMIT 1").first();let status="online";try{status=JSON.parse(row?.setting_value||"\"online\"")}catch{}return json({success:true,status:status==="maintenance"?"maintenance":"online"});}catch{return json({success:false,message:"Site durumu alınamadı."},500)}
}
export async function onRequestPost(context){
 if(!originOk(context.request))return json({success:false,message:"İstek kaynağı geçersiz."},403);
 const auth=await requireSuperAdmin(context);if(auth.response)return auth.response;
 try{const body=await context.request.json();if(typeof body.maintenance!=="boolean")return json({success:false,message:"Geçerli bir bakım durumu gerekli."},400);
 const status=body.maintenance?"maintenance":"online";
 await context.env.DB.prepare("INSERT INTO site_settings(setting_key,setting_value,updated_at) VALUES('site_status',?,datetime('now')) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=datetime('now')").bind(JSON.stringify(status)).run();
 await logAudit(context.env.DB,context.request,auth.admin,{action:body.maintenance?"site_maintenance_enabled":"site_maintenance_disabled",entity_type:"site",entity_id:"site_status",entity_title:body.maintenance?"Site bakım moduna alındı":"Site yeniden yayına açıldı",details:{status}});
 return json({success:true,status,message:body.maintenance?"Site bakım moduna alındı. Yönetim paneli erişilebilir kalır.":"Site yeniden yayına açıldı."});
 }catch{return json({success:false,message:"Site durumu değiştirilemedi."},500)}
}