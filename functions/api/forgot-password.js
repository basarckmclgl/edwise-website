function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
function hex(bytes) { return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2,"0")).join(""); }
async function hashToken(token) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))); }

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return json({success:false,message:"İstek kaynağı geçersiz."},403);
  try {
    if (!env.DB) return json({success:false,message:"Veritabanı bağlantısı yok."},500);
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase().slice(0,254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({success:false,message:"Geçerli bir e-posta adresi girin."},400);
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE);`);
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS admin_password_reset_limits (ip_address TEXT PRIMARY KEY, last_request_at TEXT NOT NULL DEFAULT (datetime('now')));`);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const limited = await env.DB.prepare("SELECT (julianday('now')-julianday(last_request_at))*86400 AS age FROM admin_password_reset_limits WHERE ip_address=?").bind(ip).first();
    if (limited && Number(limited.age) < 60) return json({success:true,message:"E-posta adresi kayıtlıysa şifre yenileme bağlantısı gönderilecektir."});
    await env.DB.prepare("INSERT INTO admin_password_reset_limits(ip_address,last_request_at) VALUES(?,datetime('now')) ON CONFLICT(ip_address) DO UPDATE SET last_request_at=datetime('now')").bind(ip).run();
    const admin = await env.DB.prepare("SELECT id,email,is_active FROM admins WHERE lower(email)=? AND is_active=1 LIMIT 1").bind(email).first();
    if (!admin || !admin.email) return json({success:true,message:"E-posta adresi kayıtlıysa şifre yenileme bağlantısı gönderilecektir."});
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
      console.error("Password reset email is not configured: RESEND_API_KEY / RESEND_FROM_EMAIL missing.");
      return json({success:false,message:"E-posta gönderimi henüz yapılandırılmamış. Yönetici e-posta servisi ayarlanmalı."},503);
    }
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await hashToken(token);
    await env.DB.prepare("UPDATE admin_password_reset_tokens SET used_at=datetime('now') WHERE admin_id=? AND used_at IS NULL").bind(admin.id).run();
    const expiresAt = new Date(Date.now()+30*60*1000).toISOString();
    await env.DB.prepare("INSERT INTO admin_password_reset_tokens(admin_id,token_hash,expires_at) VALUES(?,?,?)").bind(admin.id,tokenHash,expiresAt).run();
    const resetUrl = new URL("/yonetim/sifre-sifirla.html", request.url);
    resetUrl.searchParams.set("token",token);
    const html = `<!doctype html><html lang="tr"><body style="font-family:Arial,sans-serif;color:#342344;line-height:1.6"><div style="max-width:560px;margin:30px auto;padding:28px;border:1px solid #eee5f7;border-radius:16px"><h2 style="color:#54218f">EDWISE şifre yenileme</h2><p>Şifrenizi yenilemek için aşağıdaki bağlantıyı kullanın. Bağlantı 30 dakika geçerlidir ve yalnızca bir kez kullanılabilir.</p><p style="margin:28px 0"><a href="${resetUrl.href}" style="background:#7138b8;color:#fff;padding:13px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Şifremi Yenile</a></p><p>Bu talebi siz oluşturmadıysanız bu e-postayı dikkate almayın. Şifreniz değiştirilmeyecektir.</p><small>EDWISE Yönetim Merkezi</small></div></body></html>`;
    const mail = await fetch("https://api.resend.com/emails", {method:"POST",headers:{"Authorization":`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:env.RESEND_FROM_EMAIL,to:[admin.email],subject:"EDWISE şifre yenileme bağlantısı",html})});
    if (!mail.ok) {
      const detail = await mail.text();
      console.error("Resend email error:", mail.status, detail);
      await env.DB.prepare("UPDATE admin_password_reset_tokens SET used_at=datetime('now') WHERE token_hash=?").bind(tokenHash).run();
      return json({success:false,message:"E-posta gönderilemedi. E-posta servisi ayarlarını kontrol edin."},502);
    }
    return json({success:true,message:"E-posta adresi kayıtlıysa şifre yenileme bağlantısı gönderilecektir."});
  } catch (error) {
    console.error("EDWISE FORGOT PASSWORD ERROR:",error);
    return json({success:false,message:"Şifre yenileme talebi işlenirken sunucu hatası oluştu."},500);
  }
}
