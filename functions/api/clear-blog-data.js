import { requireSuperAdmin } from "./_auth.js";
import { logAudit } from "./_audit.js";

export async function onRequestPost(context){
 const origin=context.request.headers.get("Origin");
 try{
  if(!origin||origin!==new URL(context.request.url).origin){
   return Response.json({success:false,message:"Geçersiz istek kaynağı."},{status:403});
  }
  const auth=await requireSuperAdmin(context);
  if(auth.response)return auth.response;
  const result=await context.env.DB.prepare("DELETE FROM posts").run();
  await logAudit(context.env.DB,context.request,auth.admin,{
   action:"posts_purged",entity_type:"post",entity_id:"all",
   entity_title:"Blog kayıtlarının tamamı silindi",
   details:{deleted_count:result.meta?.changes||0}
  });
  return Response.json({success:true,deleted:result.meta?.changes||0,message:"Blog kayıtları kalıcı olarak silindi."},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("Blog cleanup failed:",error);
  return Response.json({success:false,message:"Blog kayıtları silinemedi."},{status:500});
 }
}
