import { logAudit } from "./_audit.js";

const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
function validOrigin(r){try{return r.headers.get("Origin")===new URL(r.url).origin}catch{return false}}
async function hash(v){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
const genericMessage="E-posta adresi sistemde kayıtlıysa şifre yenileme bağlantısı gönderildi. Gelen kutunuzu kontrol edin.";

export async function onRequestPost({request,env}){
  if(!validOrigin(request))return json({success:false,message:"İstek kaynağı geçersiz."},403);
  try{
    if(!env.DB)return json({success:false,message:"Şifre yenileme hizmeti şu anda kullanılamıyor."},503);

    const {email=""}=await request.json();
    const address=String(email).trim().toLowerCase().slice(0,160);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))return json({success:false,message:"E-posta adresini kontrol edin."},400);

    const emailHash=await hash(address);
    if(!env.RESEND_API_KEY||!env.RESEND_FROM_EMAIL){
      await logAudit(env.DB,request,null,{action:"password_reset_config_missing",entity_type:"security",entity_title:"Şifre kurtarma e-posta ayarı eksik",details:{email_hash:emailHash,api_key_configured:Boolean(env.RESEND_API_KEY),from_email_configured:Boolean(env.RESEND_FROM_EMAIL)}});
      return json({success:false,message:"Şifre kurtarma e-posta hizmeti henüz yapılandırılmamış. Site yöneticisinin Resend ayarlarını tamamlaması gerekiyor."},503);
    }

    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_password_resets(id INTEGER PRIMARY KEY AUTOINCREMENT,admin_id INTEGER NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')))`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS password_reset_limits(ip_hash TEXT PRIMARY KEY,window_start TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0)`).run();

    const ip=request.headers.get("CF-Connecting-IP")||"unknown";
    const ipHash=await hash(ip);
    const now=new Date().toISOString();
    await env.DB.prepare("INSERT INTO password_reset_limits(ip_hash,window_start,attempts) VALUES(?,?,1) ON CONFLICT(ip_hash) DO UPDATE SET attempts=CASE WHEN (julianday('now')-julianday(window_start))*24>1 THEN 1 ELSE attempts+1 END,window_start=CASE WHEN (julianday('now')-julianday(window_start))*24>1 THEN excluded.window_start ELSE window_start END").bind(ipHash,now).run();
    const limit=await env.DB.prepare("SELECT attempts FROM password_reset_limits WHERE ip_hash=?").bind(ipHash).first();

    if(Number(limit?.attempts)>5){
      await logAudit(env.DB,request,null,{action:"password_reset_rate_limited",entity_type:"security",entity_title:"Şifre kurtarma isteği sınırlandı",details:{email_hash:emailHash,attempts:Number(limit.attempts)}});
      return json({success:true,message:genericMessage});
    }

    const admin=await env.DB.prepare("SELECT id,email,username FROM admins WHERE lower(email)=? AND is_active=1 LIMIT 1").bind(address).first();
    if(!admin){
      await logAudit(env.DB,request,null,{action:"password_reset_account_not_found",entity_type:"security",entity_title:"Şifre kurtarma hesabı eşleşmedi",details:{email_hash:emailHash}});
      return json({success:true,message:genericMessage});
    }

    await env.DB.prepare("DELETE FROM admin_password_resets WHERE admin_id=? OR expires_at<=datetime('now')").bind(admin.id).run();
    const token=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,"0")).join("");
    await env.DB.prepare("INSERT INTO admin_password_resets(admin_id,token_hash,expires_at) VALUES(?,?,?)").bind(admin.id,await hash(token),new Date(Date.now()+30*60*1000).toISOString()).run();

    const link=new URL("/admin/?reset="+encodeURIComponent(token),request.url).toString();
    let sent;
    let responseBody={};
    try{
      sent=await fetch("https://api.resend.com/emails",{
        method:"POST",
        headers:{Authorization:"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},
        body:JSON.stringify({
          from:env.RESEND_FROM_EMAIL,
          to:[admin.email],
          subject:"EDWISE yönetici şifre yenileme",
          text:"Şifrenizi yenilemek için bu bağlantıyı 30 dakika içinde açın:\n"+link+"\nBu isteği siz yapmadıysanız bu e-postayı dikkate almayın."
        })
      });
      try{responseBody=await sent.json()}catch{responseBody={}}
    }catch(error){
      await env.DB.prepare("DELETE FROM admin_password_resets WHERE admin_id=?").bind(admin.id).run();
      await logAudit(env.DB,request,null,{action:"password_reset_email_network_error",entity_type:"security",entity_id:admin.id,entity_title:"Resend bağlantı hatası",details:{email_hash:emailHash,error:String(error?.message||error).slice(0,500)}});
      console.error("EDWISE reset email network error",error);
      return json({success:true,message:genericMessage});
    }

    if(!sent.ok){
      await env.DB.prepare("DELETE FROM admin_password_resets WHERE admin_id=?").bind(admin.id).run();
      const resendMessage=String(responseBody?.message||responseBody?.error||"Resend API request failed").slice(0,500);
      await logAudit(env.DB,request,null,{action:"password_reset_email_rejected",entity_type:"security",entity_id:admin.id,entity_title:"Resend e-posta isteğini reddetti",details:{email_hash:emailHash,http_status:sent.status,resend_message:resendMessage}});
      console.error("EDWISE reset email rejected",{status:sent.status,message:resendMessage});
      return json({success:true,message:genericMessage});
    }

    await logAudit(env.DB,request,null,{action:"password_reset_email_accepted",entity_type:"security",entity_id:admin.id,entity_title:"Resend e-posta isteğini kabul etti",details:{email_hash:emailHash,resend_email_id:responseBody?.id||null}});
    return json({success:true,message:genericMessage});
  }catch(error){
    console.error("PASSWORD RESET REQUEST",error);
    if(env.DB)await logAudit(env.DB,request,null,{action:"password_reset_internal_error",entity_type:"security",entity_title:"Şifre kurtarma sunucu hatası",details:{error:String(error?.message||error).slice(0,500)}});
    return json({success:false,message:"Şifre yenileme isteği şu anda tamamlanamadı."},500);
  }
}
