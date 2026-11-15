import { requireEditor } from "./_auth.js";
import { logAudit } from "./_audit.js";

const json = (data, status = 200) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store" }
});
const recipient = "edwisedanismanlik@gmail.com";

async function ensureTable(DB) {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT,
    program TEXT NOT NULL,format TEXT NOT NULL,availability TEXT,note TEXT,
    status TEXT NOT NULL DEFAULT 'new',created_at TEXT NOT NULL DEFAULT (datetime('now')),
    priority TEXT NOT NULL DEFAULT 'normal',internal_note TEXT NOT NULL DEFAULT '',
    follow_up_at TEXT,archived_at TEXT
  )`).run();
  const cols=await DB.prepare("PRAGMA table_info(applications)").all();
  const existing=new Set((cols.results||[]).map(x=>x.name));
  for(const [name,sql] of [["priority","ALTER TABLE applications ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'"],["internal_note","ALTER TABLE applications ADD COLUMN internal_note TEXT NOT NULL DEFAULT ''"],["follow_up_at","ALTER TABLE applications ADD COLUMN follow_up_at TEXT"],["archived_at","ALTER TABLE applications ADD COLUMN archived_at TEXT"]]){
    if(!existing.has(name)) await DB.prepare(sql).run();
  }
  await DB.prepare(`CREATE TABLE IF NOT EXISTS application_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,application_id INTEGER NOT NULL,admin_email TEXT,
    action TEXT NOT NULL,details TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
}
async function history(DB,id,admin,action,details={}){
  await DB.prepare("INSERT INTO application_history (application_id,admin_email,action,details) VALUES (?,?,?,?)")
    .bind(id,admin?.email||"",action,JSON.stringify(details)).run();
}
function validOrigin(request) {
  const origin = request.headers.get("Origin");
  try { return !!origin && origin === new URL(request.url).origin; } catch { return false; }
}
function clean(v, n) { return String(v || "").trim().slice(0, n); }

export async function onRequestPost({ request, env }) {
  if (!validOrigin(request)) return json({ success:false, message:"İstek kaynağı doğrulanamadı." },403);
  try {
    const body = await request.json();
    const data = {
      name: clean(body.name,100), phone: clean(body.phone,30),
      email: clean(body.email,120), program: clean(body.program,100),
      format: clean(body.format,60), availability: clean(body.availability,100),
      note: clean(body.note,1000)
    };
    if (!data.name || !data.phone || !data.program || !data.format || body.privacy !== true) {
      return json({ success:false, message:"Zorunlu alanları ve KVKK bilgilendirme kutusunu kontrol edin." },400);
    }
    await ensureTable(env.DB);
    const result = await env.DB.prepare(`INSERT INTO applications
      (name,phone,email,program,format,availability,note)
      VALUES (?,?,?,?,?,?,?)`).bind(data.name,data.phone,data.email,data.program,data.format,data.availability,data.note).run();

    const trackingSessionId = clean(body.trackingSessionId,64);
    if (/^[a-zA-Z0-9_-]{12,64}$/.test(trackingSessionId)) {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS application_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        event_name TEXT NOT NULL,
        page_path TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`).run();
      await env.DB.prepare("INSERT INTO application_events (session_id,event_name,page_path) VALUES (?,?,?)")
        .bind(trackingSessionId,"application_saved","/pages/basvuru.html").run();
    }
    let emailSent = false;
    if (env.RESEND_API_KEY && env.RESEND_FROM_EMAIL) {
      const lines = [
        "Yeni EDWISE başvurusu", "",
        "Ad Soyad: " + data.name, "Telefon: " + data.phone,
        "E-posta: " + (data.email || "-"), "Program: " + data.program,
        "Eğitim tercihi: " + data.format, "Uygun zaman: " + (data.availability || "-"),
        "Not: " + (data.note || "-"), "Başvuru No: " + result.meta.last_row_id
      ];
      try {
        const mail = await fetch("https://api.resend.com/emails", {
          method:"POST",
          headers:{ Authorization:"Bearer " + env.RESEND_API_KEY, "Content-Type":"application/json" },
          body:JSON.stringify({ from:env.RESEND_FROM_EMAIL, to:[recipient], subject:"EDWISE Yeni Başvuru #" + result.meta.last_row_id, text:lines.join("\n") })
        });
        emailSent = mail.ok;
      } catch {
        emailSent = false;
      }
    }
    if (/^[a-zA-Z0-9_-]{12,64}$/.test(trackingSessionId)) {
      await env.DB.prepare("INSERT INTO application_events (session_id,event_name,page_path) VALUES (?,?,?)")
        .bind(trackingSessionId,emailSent?"email_sent":"email_failed","/pages/basvuru.html").run();
    }
    return json({ success:true, applicationId:result.meta.last_row_id, emailSent });
  } catch (error) {
    return json({ success:false, message:"Başvuru kaydedilemedi. Lütfen tekrar deneyin." },500);
  }
}

export async function onRequestGet(context) {
  const auth = await requireEditor(context);
  if (auth.response) return auth.response;
  try {
    await ensureTable(context.env.DB);
    const { results } = await context.env.DB.prepare(
      "SELECT * FROM applications ORDER BY (archived_at IS NULL) DESC, created_at DESC LIMIT 500"
    ).all();
    return json({ success:true, applications:results || [] });
  } catch {
    return json({ success:false, message:"Başvurular alınamadı." },500);
  }
}

export async function onRequestPut(context) {
  if (!validOrigin(context.request)) return json({ success:false,message:"İstek kaynağı doğrulanamadı." },403);
  const auth=await requireEditor(context); if(auth.response)return auth.response;
  try{
    const body=await context.request.json(),id=Number(body.id);
    if(!Number.isInteger(id)||id<1)return json({success:false,message:"Başvuru numarası geçersiz."},400);
    await ensureTable(context.env.DB);
    const DB=context.env.DB, before=await DB.prepare("SELECT * FROM applications WHERE id=?").bind(id).first();
    if(!before)return json({success:false,message:"Başvuru bulunamadı."},404);
    let action=clean(body.action||"status",30),details={};
    if(action==="status"){
      const status=clean(body.status,20);
      if(!["new","contacted","completed"].includes(status))return json({success:false,message:"Durum geçersiz."},400);
      await DB.prepare("UPDATE applications SET status=? WHERE id=?").bind(status,id).run();
      details={before:before.status,after:status};
    }else if(action==="manage"){
      const priority=clean(body.priority||before.priority,20);
      const internalNote=clean(body.internal_note??before.internal_note,2000);
      const follow=body.follow_up_at===null||body.follow_up_at===""?null:clean(body.follow_up_at,30);
      if(!["normal","high"].includes(priority))return json({success:false,message:"Öncelik geçersiz."},400);
      if(follow&&!/^\d{4}-\d{2}-\d{2}$/.test(follow))return json({success:false,message:"Takip tarihi geçersiz."},400);
      await DB.prepare("UPDATE applications SET priority=?,internal_note=?,follow_up_at=? WHERE id=?").bind(priority,internalNote,follow,id).run();
      details={priority,follow_up_at:follow,noteChanged:internalNote!==before.internal_note};
    }else if(action==="archive"){
      await DB.prepare("UPDATE applications SET archived_at=COALESCE(archived_at,datetime('now')) WHERE id=?").bind(id).run();
      details={archived:true};
    }else if(action==="restore"){
      await DB.prepare("UPDATE applications SET archived_at=NULL WHERE id=?").bind(id).run();
      details={archived:false};
    }else return json({success:false,message:"İşlem türü tanınmadı."},400);
    await history(DB,id,auth.admin,action,details);
    await logAudit(DB,context.request,auth.admin,{action:"application_"+action,entity_type:"application",entity_id:id,entity_title:"Başvuru #"+id,details});
    return json({success:true});
  }catch(error){return json({success:false,message:"Başvuru güncellenemedi."},500);}
}
