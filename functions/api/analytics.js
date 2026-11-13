import { requireSuperAdmin } from "./_auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
async function fetchJson(url,options={},timeout=12000){
 const response=await fetch(url,{...options,signal:AbortSignal.timeout(timeout)});
 let data;try{data=await response.json();}catch{throw new Error("Analiz servisinden geçersiz yanıt alındı (HTTP "+response.status+").");}
 if(!response.ok)throw new Error(data.error?.message||data.error_description||data.message||"Analiz servisi HTTP "+response.status+" hatası verdi.");
 return data;
}

function b64url(value){
 const bytes=new TextEncoder().encode(value);
 let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);
 return btoa(binary).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
function b64urlBytes(bytes){let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");}
function decodePem(value){
 const raw=value.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,"");
 const binary=atob(raw);return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
async function getGoogleAccessToken(secret){
 let account=JSON.parse(String(secret).replace(/^\\uFEFF/,"").trim());
 if(typeof account==="string")account=JSON.parse(account.trim());
 if(account?.credentials&&typeof account.credentials==="object")account=account.credentials;
 if(account?.service_account&&typeof account.service_account==="object")account=account.service_account;
 if(!account||typeof account!=="object")throw new Error("GA4 anahtarının JSON yapısı servis hesabı nesnesi değil.");
 const missing=[];
 if(!account.client_email)missing.push("client_email");
 if(!account.private_key)missing.push("private_key");
 if(missing.length)throw new Error("GA4 JSON içinde "+missing.join(" ve ")+" alanı bulunamadı. Dosyada görülen alanlar: "+Object.keys(account).join(", "));
 const now=Math.floor(Date.now()/1000);
 const header=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
 const claim=b64url(JSON.stringify({iss:account.client_email,scope:"https://www.googleapis.com/auth/analytics.readonly",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600}));
 const unsigned=header+"."+claim;
 const key=await crypto.subtle.importKey("pkcs8",decodePem(account.private_key),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
 const signature=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(unsigned));
 const jwt=unsigned+"."+b64urlBytes(new Uint8Array(signature));
 const data=await fetchJson("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:jwt})},10000);
 if(!data.access_token)throw new Error(data.error_description||data.error||"Google erişim anahtarı alınamadı.");
 return data.access_token;
}
async function onGoogleAnalytics(env,startDate,endDate){
 if(!env.GA4_SERVICE_ACCOUNT_JSON)return {configured:false,error:"GA4_SERVICE_ACCOUNT_JSON gizli değişkeni bulunamadı."};
 const propertyId=env.GA4_PROPERTY_ID||"563996837";
 const token=await getGoogleAccessToken(env.GA4_SERVICE_ACCOUNT_JSON);
 async function report(dimensions,metrics,limit=100){
  const data=await fetchJson("https://analyticsdata.googleapis.com/v1beta/properties/"+propertyId+":runReport",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({dateRanges:[{startDate,endDate}],dimensions:dimensions.map(name=>({name})),metrics:metrics.map(name=>({name})),limit})},12000);
  return data.rows||[];
 }
 const [summary,daily,countries,pages,sources]=await Promise.all([
  report([],["activeUsers","sessions","screenPageViews","eventCount"],1),
  report(["date"],["activeUsers","sessions","screenPageViews"],100),
  report(["country"],["activeUsers","sessions"],20),
  report(["pagePath"],["screenPageViews","activeUsers"],20),
  report(["sessionSourceMedium"],["sessions","activeUsers"],20)
 ]);
 let realtime=null,realtimeError="";
 try{const live=await fetchJson("https://analyticsdata.googleapis.com/v1beta/properties/"+propertyId+":runRealtimeReport",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({metrics:[{name:"activeUsers"},{name:"eventCount"},{name:"screenPageViews"}]})},10000);realtime={activeUsers:Number(live.rows?.[0]?.metricValues?.[0]?.value||0),eventCount:Number(live.rows?.[0]?.metricValues?.[1]?.value||0),pageViews:Number(live.rows?.[0]?.metricValues?.[2]?.value||0)};}catch(error){realtimeError=error.message||"GA4 gerçek zamanlı verisi alınamadı.";}
 const vals=summary[0]?.metricValues||[];
 const number=(row,index)=>Number(row?.metricValues?.[index]?.value||0);
 return {configured:true,propertyId,totals:{activeUsers:number(summary[0],0),sessions:number(summary[0],1),pageViews:number(summary[0],2),eventCount:number(summary[0],3)},realtime,realtimeError,daily:daily.map(r=>({date:(r.dimensionValues?.[0]?.value||"").replace(/^(\d{4})(\d{2})(\d{2})$/,"$1-$2-$3"),activeUsers:number(r,0),sessions:number(r,1),pageViews:number(r,2)})),countries:countries.map(r=>({country:r.dimensionValues?.[0]?.value||"Bilinmiyor",activeUsers:number(r,0),sessions:number(r,1)})),pages:pages.map(r=>({path:r.dimensionValues?.[0]?.value||"/",pageViews:number(r,0),activeUsers:number(r,1)})),sources:sources.map(r=>({source:r.dimensionValues?.[0]?.value||"Bilinmiyor",sessions:number(r,0),activeUsers:number(r,1)}))};
}

async function onCloudflare(env,startDate,endDate){
 if(!env.CF_ZONE_TAG||!env.CF_ANALYTICS_API_TOKEN)return {configured:false,unavailable:true};
 const headers={Authorization:"Bearer "+env.CF_ANALYTICS_API_TOKEN,"Content-Type":"application/json"};
 const query=`query($zone:String!,$from:Date!,$to:Date!){viewer{zones(filter:{zoneTag:$zone}){httpRequests1dGroups(limit:100,filter:{date_geq:$from,date_leq:$to},orderBy:[date_ASC]){dimensions{date} sum{requests countryMap{clientCountryName requests}} uniq{uniques}}}}}`;
 const result=await fetchJson("https://api.cloudflare.com/client/v4/graphql",{method:"POST",headers,body:JSON.stringify({query,variables:{zone:env.CF_ZONE_TAG,from:startDate,to:endDate}})},12000);
 if(result.errors?.length)throw new Error(result.errors.map(x=>x.message).join("; "));
 const groups=result.data?.viewer?.zones?.[0]?.httpRequests1dGroups||[];
 const countryMap=new Map();
 groups.forEach(g=>(g.sum?.countryMap||[]).forEach(v=>{const key=v.clientCountryName||"Bilinmiyor";const row=countryMap.get(key)||{country:key,requests:0};row.requests+=Number(v.requests||0);countryMap.set(key,row);}));
 const daily=groups.map(g=>({date:g.dimensions.date,requests:Number(g.sum?.requests||0),uniqueVisitors:Number(g.uniq?.uniques||0)}));
 const totals=daily.reduce((a,v)=>({requests:a.requests+v.requests,dailyUniqueIpTotal:a.dailyUniqueIpTotal+v.uniqueVisitors}),{requests:0,dailyUniqueIpTotal:0});
 let pages=[],pathWarning="";
 try{
  const pq=`query($zone:String!,$from:Time!,$to:Time!){viewer{zones(filter:{zoneTag:$zone}){httpRequestsAdaptiveGroups(limit:10,filter:{datetime_geq:$from,datetime_lt:$to},orderBy:[count_DESC]){count dimensions{clientRequestPath}}}}}`;
  const until=new Date(endDate+"T00:00:00Z");until.setUTCDate(until.getUTCDate()+1);
  const pd=await fetchJson("https://api.cloudflare.com/client/v4/graphql",{method:"POST",headers,body:JSON.stringify({query:pq,variables:{zone:env.CF_ZONE_TAG,from:startDate+"T00:00:00Z",to:until.toISOString()}})},12000);
  if(pd.errors?.length)throw new Error(pd.errors.map(x=>x.message).join("; "));
  pages=(pd.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups||[]).map(x=>({path:x.dimensions?.clientRequestPath||"/",requests:Number(x.count||0)}));
 }catch(e){pathWarning=e.message||"Sayfa yolu raporu alınamadı.";}
 return {configured:true,totals,daily,countries:[...countryMap.values()].sort((a,b)=>b.requests-a.requests).slice(0,15),pages,pathWarning};
}
export async function onRequestGet(context){
 const auth=await requireSuperAdmin(context);if(auth.response)return auth.response;
 try{const end=new Date(),start=new Date(end);start.setDate(start.getDate()-29);const iso=d=>d.toISOString().slice(0,10);const startDate=iso(start),endDate=iso(end);const [cfResult,gaResult]=await Promise.allSettled([onCloudflare(context.env,startDate,endDate),onGoogleAnalytics(context.env,startDate,endDate)]);const cloudflare=cfResult.status==="fulfilled"?cfResult.value:{configured:false,error:cfResult.reason?.message||"Cloudflare verisi alınamadı."};const googleAnalytics=gaResult.status==="fulfilled"?gaResult.value:{configured:false,error:gaResult.reason?.message||"Google Analytics verisi alınamadı."};return json({success:true,period:{startDate,endDate},cloudflare,googleAnalytics});}
 catch(e){return json({success:false,message:e.message||"Cloudflare analizleri alınamadı."},500);}
}