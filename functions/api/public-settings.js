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
  const removedKeys=new Set(["guide"]);
  menu=Array.isArray(menu)?menu.filter(item=>!removedKeys.has(item?.key)&&item?.url!=="/edwise-rehber.html"):[];
  return Response.json({success:true,theme,menu},{headers:{"Cache-Control":"public, max-age=60"}});
 }catch(error){return Response.json({success:false,message:"Tasarım ayarları alınamadı."},{status:500});}
}
