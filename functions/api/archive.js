import { requireSuperAdmin } from "./_auth.js";
import { ensureAuditTable } from "./_audit.js";

const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const safe=(value,max=180)=>String(value??"").replace(/[\u0000-\u001f\u007f]/g," ").slice(0,max).trim();
function originOk(request){const origin=request.headers.get("Origin");try{return !!origin&&origin===new URL(request.url).origin}catch{return false}}

async function ensureArchive(db){
 await db.exec(`
 CREATE TABLE IF NOT EXISTS archive_records(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  record_date TEXT,
  summary_json TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_type,source_id)
 );
 CREATE INDEX IF NOT EXISTS idx_archive_records_type_date ON archive_records(source_type,record_date);
 CREATE TABLE IF NOT EXISTS archive_jobs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL,
  archived_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
 );`);
}
async function saveRecord(db,type,id,date,summary){
 const result=await db.prepare("INSERT OR IGNORE INTO archive_records(source_type,source_id,record_date,summary_json) VALUES(?,?,?,?)")
  .bind(type,String(id),date||null,JSON.stringify(summary)).run();
 return Number(result.meta?.changes)||0;
}
export async function onRequestGet(context){
 const auth=await requireSuperAdmin(context);if(auth.response)return auth.response;
 try{
  const db=context.env.DB;await ensureArchive(db);
  const counts=await db.prepare("SELECT source_type,COUNT(*) AS total,MAX(archived_at) AS last_archived FROM archive_records GROUP BY source_type").all();
  const jobs=await db.prepare("SELECT id,status,archived_count,skipped_count,message,created_at FROM archive_jobs ORDER BY id DESC LIMIT 10").all();
  const records=await db.prepare("SELECT id,source_type,source_id,record_date,summary_json,archived_at FROM archive_records ORDER BY id DESC LIMIT 100").all();
  const total=await db.prepare("SELECT COUNT(*) AS total FROM archive_records").first();
  return json({success:true,total:Number(total?.total)||0,counts:counts.results||[],jobs:jobs.results||[],records:(records.results||[]).map(row=>({...row,summary:(()=>{try{return JSON.parse(row.summary_json||"{}")}catch{return {}}})()}))});
 }catch(error){console.error("Archive GET",error);return json({success:false,message:"Arşiv bilgileri alınamadı."},500)}
}
export async function onRequestPost(context){
 if(!originOk(context.request))return json({success:false,message:"İstek kaynağı doğrulanamadı."},403);
 const auth=await requireSuperAdmin(context);if(auth.response)return auth.response;
 const db=context.env.DB;
 try{
  await ensureArchive(db);
  await db.exec(`
   CREATE TABLE IF NOT EXISTS application_events(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,event_name TEXT NOT NULL,page_path TEXT,country_code TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE TABLE IF NOT EXISTS applications(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT,program TEXT NOT NULL,format TEXT NOT NULL,availability TEXT,note TEXT,status TEXT NOT NULL DEFAULT 'new',created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  await ensureAuditTable(db);
  const job=await db.prepare("INSERT INTO archive_jobs(status,message) VALUES('running','Arşivleme başlatıldı')").run();
  let archived=0,skipped=0;
  const eventRows=await db.prepare(`SELECT date(created_at) AS record_date,event_name,page_path,country_code,COUNT(*) AS event_count,COUNT(DISTINCT session_id) AS sessions
   FROM application_events GROUP BY date(created_at),event_name,page_path,country_code ORDER BY record_date LIMIT 5000`).all();
  for(const row of eventRows.results||[]){
   const key=[row.record_date,row.event_name,row.page_path||"",row.country_code||""].join("|");
   const changed=await saveRecord(db,"analytics",key,row.record_date,{event:safe(row.event_name,40),page:safe(row.page_path,180),country:safe(row.country_code,2),count:Number(row.event_count)||0,sessions:Number(row.sessions)||0});
   archived+=changed;skipped+=1-changed;
  }
  const appRows=await db.prepare("SELECT id,program,format,availability,status,created_at FROM applications ORDER BY id LIMIT 5000").all();
  for(const row of appRows.results||[]){
   const changed=await saveRecord(db,"application",row.id,row.created_at,{applicationNumber:Number(row.id),program:safe(row.program,100),format:safe(row.format,60),availability:safe(row.availability,100),status:safe(row.status,30),createdAt:row.created_at||null});
   archived+=changed;skipped+=1-changed;
  }
  const auditRows=await db.prepare("SELECT id,actor_username,actor_role,action,entity_type,entity_id,entity_title,created_at FROM admin_audit_log ORDER BY id LIMIT 5000").all().catch(()=>({results:[]}));
  for(const row of auditRows.results||[]){
   const changed=await saveRecord(db,"admin_audit",row.id,row.created_at,{actor:safe(row.actor_username,100),role:safe(row.actor_role,40),action:safe(row.action,80),entityType:safe(row.entity_type,40),entityId:safe(row.entity_id,100),title:safe(row.entity_title,180),createdAt:row.created_at||null});
   archived+=changed;skipped+=1-changed;
  }
  const msg="Kişisel iletişim alanları, IP, tarayıcı bilgisi ve serbest metin notları arşive alınmadı. Kaynak kayıtlar silinmedi.";
  await db.prepare("UPDATE archive_jobs SET status='completed',archived_count=?,skipped_count=?,message=? WHERE id=?").bind(archived,skipped,msg,job.meta.last_row_id).run();
  return json({success:true,archived,skipped,message:msg});
 }catch(error){
  console.error("Archive POST",error);
  return json({success:false,message:"Arşivleme tamamlanamadı. Kaynak veriler silinmedi."},500);
 }
}
