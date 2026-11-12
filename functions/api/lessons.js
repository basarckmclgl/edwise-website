import { requireEditor } from "./_auth.js";
import { logAudit } from "./_audit.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
async function auth(context){const a=await requireEditor(context);return a.response?{response:a.response}:{admin:a.admin};}
async function ensure(DB){
 await DB.prepare(`CREATE TABLE IF NOT EXISTS lesson_sessions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 course TEXT NOT NULL,
 title TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft',
 notes TEXT NOT NULL DEFAULT '',
 started_at TEXT,
 ended_at TEXT,
 created_by TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
 )`).run();
}
async function originOk(request){const origin=request.headers.get("Origin");try{return !!origin&&origin===new URL(request.url).origin;}catch{return false;}}
const courses=["ielts","toefl","yds","yokdil","speaking-club","education-consultancy"];
export async function onRequestGet(context){
 const a=await auth(context);if(a.response)return a.response;
 try{await ensure(context.env.DB);const course=new URL(context.request.url).searchParams.get("course");const rows=course&&courses.includes(course)?await context.env.DB.prepare("SELECT * FROM lesson_sessions WHERE course=? ORDER BY updated_at DESC,id DESC").bind(course).all():await context.env.DB.prepare("SELECT * FROM lesson_sessions ORDER BY updated_at DESC,id DESC LIMIT 300").all();return json({success:true,sessions:rows.results||[]});}
 catch(e){return json({success:false,message:"Ders kayıtları alınamadı."},500);}
}
export async function onRequestPost(context){
 if(!(await originOk(context.request)))return json({success:false,message:"İstek kaynağı geçersiz."},403);
 const a=await auth(context);if(a.response)return a.response;
 try{await ensure(context.env.DB);const d=await context.request.json();const course=String(d.course||"");const title=String(d.title||"").trim().slice(0,160);if(!courses.includes(course)||!title)return json({success:false,message:"Eğitim alanı ve ders başlığı zorunludur."},400);
 const result=await context.env.DB.prepare("INSERT INTO lesson_sessions(course,title,status,notes,created_by) VALUES(?,?,'draft',?,?)").bind(course,title,String(d.notes||"").slice(0,20000),String(a.admin?.email||a.admin?.username||"Yönetici")).run();
 const row=await context.env.DB.prepare("SELECT * FROM lesson_sessions WHERE id=?").bind(result.meta.last_row_id).first();
 await logAudit(context.env.DB,context.request,a.admin,{action:"lesson_created",entity_type:"lesson",entity_id:row.id,entity_title:title,details:{course}});
 return json({success:true,session:row},201);
 }catch(e){return json({success:false,message:"Ders oluşturulamadı."},500);}
}
export async function onRequestPut(context){
 if(!(await originOk(context.request)))return json({success:false,message:"İstek kaynağı geçersiz."},403);
 const a=await auth(context);if(a.response)return a.response;
 try{await ensure(context.env.DB);const d=await context.request.json();const id=Number(d.id);if(!Number.isInteger(id)||id<1)return json({success:false,message:"Ders kaydı geçersiz."},400);
 const before=await context.env.DB.prepare("SELECT * FROM lesson_sessions WHERE id=?").bind(id).first();if(!before)return json({success:false,message:"Ders bulunamadı."},404);
 let status=before.status,started=before.started_at,ended=before.ended_at;
 if(d.action==="start"){if(status==="finished")return json({success:false,message:"Tamamlanmış ders yeniden başlatılamaz; yeni ders oluşturun."},409);status="live";started=started||new Date().toISOString();ended=null;}
 else if(d.action==="finish"){if(status!=="live")return json({success:false,message:"Yalnızca devam eden ders bitirilebilir."},409);status="finished";ended=new Date().toISOString();}
 else if(d.action==="save"){}
 else return json({success:false,message:"Geçersiz işlem."},400);
 const title=String(d.title??before.title).trim().slice(0,160);const notes=String(d.notes??before.notes).slice(0,20000);if(!title)return json({success:false,message:"Ders başlığı boş olamaz."},400);
 await context.env.DB.prepare("UPDATE lesson_sessions SET title=?,notes=?,status=?,started_at=?,ended_at=?,updated_at=datetime('now') WHERE id=?").bind(title,notes,status,started,ended,id).run();
 const after=await context.env.DB.prepare("SELECT * FROM lesson_sessions WHERE id=?").bind(id).first();
 await logAudit(context.env.DB,context.request,a.admin,{action:"lesson_"+d.action,entity_type:"lesson",entity_id:id,entity_title:title,details:{before,after}});
 return json({success:true,session:after});
 }catch(e){return json({success:false,message:"Ders kaydedilemedi."},500);}
}
export async function onRequestDelete(context){
 if(!(await originOk(context.request)))return json({success:false,message:"İstek kaynağı geçersiz."},403);
 const a=await auth(context);if(a.response)return a.response;
 try{await ensure(context.env.DB);const id=Number(new URL(context.request.url).searchParams.get("id"));if(!Number.isInteger(id)||id<1)return json({success:false,message:"Ders kaydı geçersiz."},400);const before=await context.env.DB.prepare("SELECT * FROM lesson_sessions WHERE id=?").bind(id).first();if(!before)return json({success:false,message:"Ders bulunamadı."},404);await context.env.DB.prepare("DELETE FROM lesson_sessions WHERE id=?").bind(id).run();await logAudit(context.env.DB,context.request,a.admin,{action:"lesson_deleted",entity_type:"lesson",entity_id:id,entity_title:before.title,details:{before}});return json({success:true});}
 catch(e){return json({success:false,message:"Ders silinemedi."},500);}
}