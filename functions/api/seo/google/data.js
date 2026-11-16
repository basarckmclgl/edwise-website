import { requirePermission } from "../../_auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const PREVIEW="yonetim-paneli.edwise.pages.dev";
function b64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
async function cryptoKey(env){if(!env.SEO_TOKEN_ENCRYPTION_KEY)throw new Error("SEO_TOKEN_ENCRYPTION_KEY Secret bulunamadı.");const raw=b64(env.SEO_TOKEN_ENCRYPTION_KEY);if(raw.length!==32)throw new Error("Şifreleme anahtarı 32 byte değil.");return crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["decrypt"]);}
async function getAccessToken(env,db){
 const row=await db.prepare("SELECT encrypted_refresh_token,iv FROM seo_google_tokens WHERE id=1").first();
 if(!row)throw new Error("Google Search Console hesabı bağlı değil. Önce Google hesabını bağla.");
 const key=await cryptoKey(env);
 const clear=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64(row.iv)},key,b64(row.encrypted_refresh_token));
 const refreshToken=new TextDecoder().decode(clear);
 const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.GOOGLE_OAUTH_CLIENT_ID,client_secret:env.GOOGLE_OAUTH_CLIENT_SECRET,refresh_token:refreshToken,grant_type:"refresh_token"})});
 const token=await response.json();if(!response.ok||!token.access_token)throw new Error("Google erişim anahtarı yenilenemedi: "+(token.error_description||token.error||"Bilinmeyen hata"));
 return token.access_token;
}
async function query(accessToken,siteUrl,body){
 const response=await fetch("https://www.googleapis.com/webmasters/v3/sites/"+encodeURIComponent(siteUrl)+"/searchAnalytics/query",{method:"POST",headers:{Authorization:"Bearer "+accessToken,"Content-Type":"application/json"},body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw new Error(result.error?.message||"Search Console verisi alınamadı.");return result.rows||[];
}
function dateDaysAgo(n){const d=new Date();d.setUTCDate(d.getUTCDate()-n);return d.toISOString().slice(0,10);}
export async function onRequestGet(context){
 try{
  if(new URL(context.request.url).hostname!==PREVIEW)return json({success:false,message:"Bu servis yalnızca Preview ortamında kullanılabilir."},404);
  const auth=await requirePermission(context,"seo","view");if(auth.response)return auth.response;
  const db=context.env["edwise-deneme"];if(!db)return json({success:false,message:"Preview veritabanı bağlantısı bulunamadı."},503);
  const accessToken=await getAccessToken(context.env,db);
  const siteUrl="sc-domain:edwisedanismanlik.com";
  const startDate=dateDaysAgo(30),endDate=dateDaysAgo(3);
  const base={startDate,endDate};
  const [totals,pages,queries]=await Promise.all([
   query(accessToken,siteUrl,{...base,dimensions:["date"],rowLimit:1000}),
   query(accessToken,siteUrl,{...base,dimensions:["page"],rowLimit:10}),
   query(accessToken,siteUrl,{...base,dimensions:["query"],rowLimit:10})
  ]);
  const summary=totals.reduce((a,r)=>({clicks:a.clicks+(r.clicks||0),impressions:a.impressions+(r.impressions||0),weightedPosition:a.weightedPosition+(r.position||0)*(r.impressions||0),weightedCtr:a.weightedCtr+(r.ctr||0)*(r.impressions||0)}),{clicks:0,impressions:0,weightedPosition:0,weightedCtr:0});
  return json({success:true,period:{startDate,endDate},summary:{clicks:summary.clicks,impressions:summary.impressions,ctr:summary.impressions?summary.clicks/summary.impressions:0,position:summary.impressions?summary.weightedPosition/summary.impressions:0},pages:pages.map(r=>({page:r.keys?.[0]||"",clicks:r.clicks||0,impressions:r.impressions||0,ctr:r.ctr||0,position:r.position||0})),queries:queries.map(r=>({query:r.keys?.[0]||"",clicks:r.clicks||0,impressions:r.impressions||0,ctr:r.ctr||0,position:r.position||0}))});
 }catch(e){return json({success:false,message:e.message||"Search Console verileri alınamadı."},400);}
}
