const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow"}});

async function ensureDashboardTables(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL DEFAULT '',
    meta_title TEXT NOT NULL DEFAULT '',
    meta_description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    program TEXT NOT NULL,
    format TEXT NOT NULL,
    availability TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL UNIQUE,
    file_url TEXT NOT NULL,
    file_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
}

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
    await ensureDashboardTables(env.DB);
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