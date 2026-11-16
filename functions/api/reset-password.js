function json(data,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store"}});}
function hex(bytes){return Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,"0")).join("");}
async function hashToken(token){return hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)));}
async function hashPassword(password){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:100000,hash:"SHA-256"},key,256);
  return `pbkdf2$100000$${hex(salt)}$${hex(bits)}`;
}
export async function onRequestPost({request,env}){
  const origin=request.headers.get("Origin");
  if(!origin||origin!==new URL(request.url).origin)return json({success:false,message:"İstek kaynağı geçersiz."},403);
  try{
    const body=await request.json();
    const token=String(body.token||"");
    const password=String(body.password||"");
    if(!/^[a-f0-9]{64}$/i.test(token))return json({success:false,message:"Bağlantı geçersiz veya süresi dolmuş."},400);
    if(password.length<8||password.length>128)return json({success:false,message:"Yeni şifre 8–128 karakter arasında olmalıdır."},400);
    const tokenHash=await hashToken(token);
    const row=await env.DB.prepare("SELECT id,admin_id FROM admin_password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND datetime(expires_at)>datetime('now') LIMIT 1").bind(tokenHash).first();
    if(!row)return json({success:false,message:"Bağlantı geçersiz, daha önce kullanılmış veya süresi dolmuş."},400);
    const passwordHash=await hashPassword(password);
    await env.DB.prepare("UPDATE admins SET password_hash=?,updated_at=datetime('now') WHERE id=? AND is_active=1").bind(passwordHash,row.admin_id).run();
    await env.DB.prepare("UPDATE admin_password_reset_tokens SET used_at=datetime('now') WHERE admin_id=? AND used_at IS NULL").bind(row.admin_id).run();
    await env.DB.prepare("DELETE FROM admin_sessions WHERE admin_id=?").bind(row.admin_id).run();
    return json({success:true,message:"Şifreniz yenilendi. Yeni şifrenizle giriş yapabilirsiniz."});
  }catch(error){console.error("EDWISE RESET PASSWORD ERROR:",error);return json({success:false,message:"Şifre yenilenirken sunucu hatası oluştu."},500);}
}
