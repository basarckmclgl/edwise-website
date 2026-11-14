const DEFAULT_THEME={
 primary:"#291447",accent:"#c5a0f2",surface:"#f7f3fb",text:"#261a35",
 header:"#ffffff",hero:"#291447",footer:"#1b0d2d",font:"Inter",buttonRadius:"6px"
};
export async function onRequestGet(context){
 try{
  const row=await context.env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='live_theme' LIMIT 1").first();
  let theme=DEFAULT_THEME;
  if(row?.setting_value){
   try{theme={...DEFAULT_THEME,...JSON.parse(row.setting_value)};}catch{}
  }
  const menuRow=await context.env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='menu_theme' LIMIT 1").first();
  let menu=[];
  if(menuRow?.setting_value){try{menu=JSON.parse(menuRow.setting_value);}catch{}}
  menu=Array.isArray(menu)?menu.filter(item=>item&&item.visible!==false).sort((a,b)=>(a.order??0)-(b.order??0)):[];
  const tr=await context.env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='static_page_trash' LIMIT 1").first();
  let removed=[];try{removed=JSON.parse(tr?.setting_value||"[]");}catch{}
  const removedPaths=new Set(Array.isArray(removed)?removed.map(item=>item.page_path):[]);
  menu=menu.filter(item=>{try{return !removedPaths.has(new URL(item.url,context.request.url).pathname);}catch{return true;}});
  return Response.json({success:true,theme,menu,menuConfigured:!!menuRow},{headers:{"Cache-Control":"no-store, max-age=0"}});
 }catch(error){return Response.json({success:false,message:"Tasarım ayarları alınamadı."},{status:500});}
}
