import { requireSuperAdmin } from "./_auth.js";

function json(data,status=200){return Response.json(data,{status});}
async function originOk(request){
 const origin=request.headers.get("Origin");
 try{return !!origin && origin===new URL(request.url).origin;}catch{return false;}
}
async function readSettings(DB){
 const result=await DB.prepare("SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('draft_theme','live_theme','menu_theme','site_preferences','panel_preferences')").all();
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
  return json({success:true,draft:values.draft_theme||{},live:values.live_theme||{},menu:values.menu_theme||{},preferences:values.site_preferences||{},panelPreferences:values.panel_preferences||{}});
 }catch(error){return json({success:false,message:"Tasarım ayarları alınamadı."},500);}
}
export async function onRequestPost(context){
 try{
  if(!(await originOk(context.request)))return json({success:false,message:"İstek kaynağı geçersiz."},403);
  const auth=await requireSuperAdmin(context);
  if(auth.response)return auth.response;
  const body=await context.request.json();
  if(body.action==="save_menu"){
   const items=Array.isArray(body.items)?body.items:[];
   if(items.length>100)return json({success:false,message:"Menüde en fazla 100 bağlantı olabilir."},400);
   const clean=items.map((item,index)=>({key:String(item.key||"").slice(0,100),label:String(item.label||"").trim().slice(0,80),url:String(item.url||"").slice(0,300),visible:item.visible!==false,order:index}));
   if(clean.some(item=>!item.key||!item.label||!item.url||!item.url.startsWith("/")||item.url.startsWith("//")))return json({success:false,message:"Menü bağlantılarından biri geçersiz."},400);
   const serialized=JSON.stringify(clean);
   const existing=await context.env.DB.prepare("SELECT id FROM site_settings WHERE setting_key=? LIMIT 1").bind("menu_theme").first();
   if(existing)await context.env.DB.prepare("UPDATE site_settings SET setting_value=?, updated_at=datetime('now') WHERE setting_key=?").bind(serialized,"menu_theme").run();
   else await context.env.DB.prepare("INSERT INTO site_settings (setting_key, setting_value, updated_at) VALUES (?, ?, datetime('now'))").bind("menu_theme",serialized).run();
   return json({success:true,message:"Menü ayarları kaydedildi."});
  }

  if(body.action==="save_panel_preferences"){
   const allowed=["theme","accent","density","fontScale","contrast","motion","links","timezone","dateFormat"];
   const choices={theme:["dark","light","system"],accent:["purple","blue","green","orange"],density:["comfortable","compact"],fontScale:["normal","large","larger"],contrast:["normal","high"],motion:["full","reduced"],links:["normal","underlined"],timezone:["Europe/Istanbul","UTC"],dateFormat:["dd.mm.yyyy","yyyy-mm-dd","mm/dd/yyyy"]};
   const preferences={};
   for(const key of allowed){const value=body.preferences?.[key];if(typeof value!=="string"||!choices[key].includes(value))return json({success:false,message:"Panel ayarlarından biri geçersiz: "+key},400);preferences[key]=value;}
   const serialized=JSON.stringify(preferences);
   const existing=await context.env.DB.prepare("SELECT id FROM site_settings WHERE setting_key=? LIMIT 1").bind("panel_preferences").first();
   if(existing)await context.env.DB.prepare("UPDATE site_settings SET setting_value=?, updated_at=datetime('now') WHERE setting_key=?").bind(serialized,"panel_preferences").run();
   else await context.env.DB.prepare("INSERT INTO site_settings (setting_key, setting_value, updated_at) VALUES (?, ?, datetime('now'))").bind("panel_preferences",serialized).run();
   return json({success:true,message:"Yönetim paneli tercihleri kaydedildi."});
  }
  if(body.action==="save_preferences"){
   const allowed=["siteName","tagline","logoUrl","faviconUrl","language","timezone","phone","whatsapp","email","address","hours","mapUrl","seoTitle","seoDescription","seoKeywords","canonical","robots","instagram","facebook","youtube","linkedin","tiktok","gaId","gsc","metaPixel","colorMode","accentPreset","density","fontScale","contrast","motion","links","dateFormat","cookieBanner","analyticsConsent","externalLinks"];
   const preferences={};
   for(const key of allowed){
    const value=typeof body.preferences?.[key]==="string"?body.preferences[key].trim():"";
    if(value.length>600)return json({success:false,message:"Bir ayar alanı izin verilen karakter sınırını aşıyor."},400);
    const urlFields=["logoUrl","faviconUrl","mapUrl","canonical","instagram","facebook","youtube","linkedin","tiktok"];
    if(urlFields.includes(key)&&value&&!value.startsWith("https://"))return json({success:false,message:"Bağlantılar https:// ile başlamalıdır."},400);
    if(key==="email"&&value&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return json({success:false,message:"E-posta adresi geçersiz."},400);
    if(key==="language"&&!["tr","en","ar"].includes(value))return json({success:false,message:"Dil seçimi geçersiz."},400);
    if(key==="timezone"&&!["Europe/Istanbul","UTC"].includes(value))return json({success:false,message:"Saat dilimi geçersiz."},400);
    if(key==="robots"&&!["index,follow","noindex,nofollow"].includes(value))return json({success:false,message:"İndeksleme seçimi geçersiz."},400);
    if(key==="gaId"&&value&&!/^G-[A-Z0-9]+$/.test(value))return json({success:false,message:"Google Analytics kimliği G- ile başlamalıdır."},400);
    if(key==="metaPixel"&&value&&!/^\d{5,30}$/.test(value))return json({success:false,message:"Meta Pixel kimliği yalnızca rakamlardan oluşmalıdır."},400);
    if(key==="colorMode"&&!["light","dark","system"].includes(value))return json({success:false,message:"Tema seçimi geçersiz."},400);
    if(key==="accentPreset"&&!["purple","blue","green","orange"].includes(value))return json({success:false,message:"Vurgu rengi geçersiz."},400);
    if(key==="density"&&!["comfortable","compact"].includes(value))return json({success:false,message:"Görünüm yoğunluğu geçersiz."},400);
    if(key==="fontScale"&&!["normal","large","larger"].includes(value))return json({success:false,message:"Yazı boyutu seçimi geçersiz."},400);
    if(key==="contrast"&&!["normal","high"].includes(value))return json({success:false,message:"Kontrast seçimi geçersiz."},400);
    if(key==="motion"&&!["full","reduced"].includes(value))return json({success:false,message:"Hareket tercihi geçersiz."},400);
    if(key==="links"&&!["normal","underlined"].includes(value))return json({success:false,message:"Bağlantı görünümü geçersiz."},400);
    if(key==="dateFormat"&&!["dd.mm.yyyy","yyyy-mm-dd","mm/dd/yyyy"].includes(value))return json({success:false,message:"Tarih biçimi geçersiz."},400);
    if(key==="cookieBanner"&&!["enabled","disabled"].includes(value))return json({success:false,message:"Çerez bilgilendirme tercihi geçersiz."},400);
    if(key==="analyticsConsent"&&!["consent","essential"].includes(value))return json({success:false,message:"Analitik çerez tercihi geçersiz."},400);
    if(key==="externalLinks"&&!["newtab","sametab"].includes(value))return json({success:false,message:"Dış bağlantı tercihi geçersiz."},400);
    preferences[key]=value;
   }
   const serialized=JSON.stringify(preferences);
   const existing=await context.env.DB.prepare("SELECT id FROM site_settings WHERE setting_key=? LIMIT 1").bind("site_preferences").first();
   if(existing)await context.env.DB.prepare("UPDATE site_settings SET setting_value=?, updated_at=datetime('now') WHERE setting_key=?").bind(serialized,"site_preferences").run();
   else await context.env.DB.prepare("INSERT INTO site_settings (setting_key, setting_value, updated_at) VALUES (?, ?, datetime('now'))").bind(serialized,"site_preferences").run();
   return json({success:true,message:"Site ayarları kaydedildi."});
  }
  const allowed=["primary","accent","surface","text","header","hero","footer","font","buttonRadius","heroEyebrow","heroTitle","heroDescription","heroButton","surfaceTitle","surfaceDescription","footerText"];
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
   }else if(["heroEyebrow","heroTitle","heroDescription","heroButton","surfaceTitle","surfaceDescription","footerText"].includes(key)){
    if(value.length>500)return json({success:false,message:"Önizleme metni 500 karakteri aşamaz."},400);
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
