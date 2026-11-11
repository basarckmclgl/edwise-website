import { requireSuperAdmin } from "./_auth.js";

function json(data,status=200){return Response.json(data,{status});}
async function originOk(request){
 const origin=request.headers.get("Origin");
 try{return !!origin && origin===new URL(request.url).origin;}catch{return false;}
}
async function readSettings(DB){
 const result=await DB.prepare("SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('draft_theme','live_theme')").all();
 const values={};
 for(const row of result.results||[]){
  try{values[row.setting_key]=JSON.parse(row.setting_value);}catch{values[row.setting_key]={};}
 }
 return values;
}
export async function onRequestGet(context){
 try{
  const auth=await requireSuperAdmin(context);
  if(auth.response)return auth.response;
  const values=await readSettings(context.env.DB);
  return json({success:true,draft:values.draft_theme||{},live:values.live_theme||{}});
 }catch(error){return json({success:false,message:"Tasarım ayarları alınamadı."},500);}
}
export async function onRequestPost(context){
 try{
  if(!(await originOk(context.request)))return json({success:false,message:"İstek kaynağı geçersiz."},403);
  const auth=await requireSuperAdmin(context);
  if(auth.response)return auth.response;
  const body=await context.request.json();
  const allowed=["primary","accent","surface","text","header","hero","footer","font","buttonRadius"];
  const theme={};
  for(const key of allowed){
   if(typeof body.theme?.[key]!=="string")continue;
   const value=body.theme[key].trim();
   if(key==="font"){
    if(!["Inter","Arial","Georgia","'Times New Roman'","Verdana"].includes(value))return json({success:false,message:"Geçersiz yazı tipi."},400);
    theme[key]=value;
   }else if(key==="buttonRadius"){
    if(!/^(0|[2-9]|1[0-8])px$/.test(value))return json({success:false,message:"Buton köşe değeri 0–18 px olmalıdır."},400);
    theme[key]=value;
   }else{
    if(!/^#[0-9a-fA-F]{6}$/.test(value))return json({success:false,message:"Renk değerleri 6 haneli HEX formatında olmalıdır."},400);
    theme[key]=value;
   }
  }
  if(Object.keys(theme).length!==allowed.length)return json({success:false,message:"Tüm tasarım alanlarını doldurun."},400);
  const action=body.action;
  if(!["draft","publish"].includes(action))return json({success:false,message:"Geçersiz işlem."},400);
  const key=action==="publish"?"live_theme":"draft_theme";
  const serialized=JSON.stringify(theme);
  const existing=await context.env.DB.prepare("SELECT id FROM site_settings WHERE setting_key=? LIMIT 1").bind(key).first();
  if(existing){
   await context.env.DB.prepare("UPDATE site_settings SET setting_value=?, updated_at=datetime('now') WHERE setting_key=?").bind(serialized,key).run();
  }else{
   await context.env.DB.prepare("INSERT INTO site_settings (setting_key, setting_value, updated_at) VALUES (?, ?, datetime('now'))").bind(key,serialized).run();
  }
  return json({success:true,message:action==="publish"?"Tasarım yayımlandı.":"Tasarım taslak olarak kaydedildi."});
 }catch(error){return json({success:false,message:"Tasarım kaydedilemedi."},500);}
}
