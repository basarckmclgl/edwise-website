const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow"}});

async function countTable(db,table,excludeDeleted=false){
  const schema=await db.prepare("PRAGMA table_info('"+table+"')").all();
  const columns=new Set((schema.results||[]).map(column=>column.name));
  if(!columns.size)return {count:null,available:false};
  const where=excludeDeleted&&columns.has("deleted_at")?" WHERE deleted_at IS NULL":"";
  const result=await db.prepare("SELECT COUNT(*) AS total FROM "+table+where).first();
  return {count:Number(result?.total||0),available:true};
}

export async function onRequestGet({request,env}){
  const host=new URL(request.url).hostname;
  if(host!=="pinar-iskelet.edwise.pages.dev"){
    return json({success:false,message:"Bu salt-okunur önizleme uç noktası yalnızca Pınar ortamında kullanılabilir."},404);
  }
  try{
    if(!env.DB)return json({success:false,message:"Veritabanı bağlantısı bulunamadı."},503);
    const [pages,services,applications,media]=await Promise.all([
      countTable(env.DB,"pages",true),
      countTable(env.DB,"services"),
      countTable(env.DB,"applications"),
      countTable(env.DB,"media")
    ]);
    let pendingApplications=null;
    if(applications.available){
      const columns=await env.DB.prepare("PRAGMA table_info('applications')").all();
      if((columns.results||[]).some(c=>c.name==="status")){
        const pending=await env.DB.prepare("SELECT COUNT(*) AS total FROM applications WHERE status=?").bind("new").first();
        pendingApplications=Number(pending?.total||0);
      }
    }
    return json({success:true,counts:{pages,services,applications,pendingApplications,media},readOnly:true,updatedAt:new Date().toISOString()});
  }catch(error){
    return json({success:false,message:"Genel Bakış verileri alınamadı: "+String(error?.message||error)},500);
  }
}