import { logAudit } from "./_audit.js";

const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const hex=b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");
async function passwordHash(password){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:100000,hash:"SHA-256"},key,256);
  return "pbkdf2$100000$"+hex(salt)+"$"+hex(bits);
}
function same(a,b){
  if(typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
function validOrigin(request){try{return request.headers.get("Origin")===new URL(request.url).origin}catch{return false}}

export async function onRequestPost({request,env}){
  if(!validOrigin(request))return json({success:false,message:"İstek kaynağı geçersiz."},403);
  if(!env.DB)return json({success:false,message:"Veritabanı bağlantısı bulunamadı."},503);
  if(!env.ADMIN_BOOTSTRAP_TOKEN)return json({success:false,message:"İlk kurulum anahtarı Preview ortamında tanımlanmamış."},503);
  try{
    const data=await request.json();
    if(!same(String(data.setupToken||""),String(env.ADMIN_BOOTSTRAP_TOKEN)))return json({success:false,message:"Kurulum anahtarı geçersiz."},403);
    const count=await env.DB.prepare("SELECT COUNT(*) AS total FROM admins").first();
    if(Number(count?.total)>0)return json({success:false,message:"İlk yönetici kurulumu daha önce yapılmış. Bu uç nokta tekrar kullanılamaz."},409);
    const users=Array.isArray(data.users)?data.users:[];
    if(users.length!==2)return json({success:false,message:"Tam olarak iki süper yönetici bilgisi gerekli."},400);
    const normalized=users.map(u=>({
      username:String(u.username||"").trim().toLowerCase(),
      email:String(u.email||"").trim().toLowerCase(),
      password:String(u.password||"")
    }));
    for(const u of normalized){
      if(!/^[a-z0-9._-]{3,50}$/.test(u.username)||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(u.email))return json({success:false,message:"Kullanıcı adı veya e-posta biçimi geçersiz."},400);
      if(u.password.length<12||u.password.length>128||!/[A-Z]/.test(u.password)||!/[a-z]/.test(u.password)||!/[0-9]/.test(u.password)||!/[^A-Za-z0-9]/.test(u.password))return json({success:false,message:"Her şifre en az 12 karakter ve büyük/küçük harf, rakam, özel karakter içermeli."},400);
    }
    if(normalized[0].username===normalized[1].username||normalized[0].email===normalized[1].email)return json({success:false,message:"İki kullanıcı adı ve e-posta birbirinden farklı olmalı."},400);
    const hashes=await Promise.all(normalized.map(u=>passwordHash(u.password)));
    await env.DB.batch(normalized.map((u,i)=>env.DB.prepare("INSERT INTO admins (username,email,password_hash,role,is_active,created_at,updated_at,permissions_json) VALUES (?,?,?,'superadmin',1,datetime('now'),datetime('now'),'{}')").bind(u.username,u.email,hashes[i])));
    await logAudit(env.DB,request,null,{action:"initial_superadmins_created",entity_type:"security",entity_title:"İlk iki süper yönetici oluşturuldu",details:{usernames:normalized.map(u=>u.username),count:2}});
    return json({success:true,message:"İki süper yönetici hesabı oluşturuldu. Kurulum anahtarı artık kullanılmayacak."},201);
  }catch(error){
    console.error("ADMIN BOOTSTRAP ERROR",error);
    return json({success:false,message:"Kurulum tamamlanamadı. Veritabanı şemasını kontrol edin."},500);
  }
}
