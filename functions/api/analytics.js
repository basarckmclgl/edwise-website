import { requireSuperAdmin } from "./_auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
async function onCloudflare(env,startDate,endDate){
 if(!env.CF_ZONE_TAG||!env.CF_ANALYTICS_API_TOKEN)return {configured:false,error:"Cloudflare için CF_ZONE_TAG ve CF_ANALYTICS_API_TOKEN ayarlanmalı."};
 const headers={Authorization:"Bearer "+env.CF_ANALYTICS_API_TOKEN,"Content-Type":"application/json"};
 const query=`query($zone:String!,$from:Date!,$to:Date!){viewer{zones(filter:{zoneTag:$zone}){httpRequests1dGroups(limit:100,filter:{date_geq:$from,date_leq:$to},orderBy:[date_ASC]){dimensions{date} sum{requests countryMap{clientCountryName requests}} uniq{uniques}}}}}`;
 const response=await fetch("https://api.cloudflare.com/client/v4/graphql",{method:"POST",headers,body:JSON.stringify({query,variables:{zone:env.CF_ZONE_TAG,from:startDate,to:endDate}}),signal:AbortSignal.timeout(12000)});
 const result=await response.json();
 if(!response.ok||result.errors?.length)throw new Error(result.errors?.[0]?.message||"Cloudflare trafik verisi alınamadı.");
 const groups=result.data?.viewer?.zones?.[0]?.httpRequests1dGroups||[];
 const countryMap=new Map();
 groups.forEach(g=>(g.sum?.countryMap||[]).forEach(v=>{const key=v.clientCountryName||"Bilinmiyor";const row=countryMap.get(key)||{country:key,requests:0};row.requests+=Number(v.requests||0);countryMap.set(key,row);}));
 const daily=groups.map(g=>({date:g.dimensions.date,requests:Number(g.sum?.requests||0),uniqueVisitors:Number(g.uniq?.uniques||0)}));
 const totals=daily.reduce((a,v)=>({requests:a.requests+v.requests,dailyUniqueIpTotal:a.dailyUniqueIpTotal+v.uniqueVisitors}),{requests:0,dailyUniqueIpTotal:0});
 let pages=[],pathWarning="";
 try{
  const pq=`query($zone:String!,$from:Time!,$to:Time!){viewer{zones(filter:{zoneTag:$zone}){httpRequestsAdaptiveGroups(limit:10,filter:{datetime_geq:$from,datetime_lt:$to},orderBy:[count_DESC]){count dimensions{clientRequestPath}}}}}`;
  const until=new Date(endDate+"T00:00:00Z");until.setUTCDate(until.getUTCDate()+1);
  const pr=await fetch("https://api.cloudflare.com/client/v4/graphql",{method:"POST",headers,body:JSON.stringify({query:pq,variables:{zone:env.CF_ZONE_TAG,from:startDate+"T00:00:00Z",to:until.toISOString()}}),signal:AbortSignal.timeout(12000)});
  const pd=await pr.json();if(!pr.ok||pd.errors?.length)throw new Error(pd.errors?.[0]?.message||"Sayfa yolu verisi alınamadı.");
  pages=(pd.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups||[]).map(x=>({path:x.dimensions?.clientRequestPath||"/",requests:Number(x.count||0)}));
 }catch(e){pathWarning=e.message||"Sayfa yolu raporu alınamadı.";}
 return {configured:true,totals,daily,countries:[...countryMap.values()].sort((a,b)=>b.requests-a.requests).slice(0,15),pages,pathWarning};
}
export async function onRequestGet(context){
 const auth=await requireSuperAdmin(context);if(auth.response)return auth.response;
 try{const end=new Date(),start=new Date(end);start.setDate(start.getDate()-29);const iso=d=>d.toISOString().slice(0,10);const cloudflare=await onCloudflare(context.env,iso(start),iso(end));return json({success:true,period:{startDate:iso(start),endDate:iso(end)},cloudflare});}
 catch(e){return json({success:false,message:e.message||"Cloudflare analizleri alınamadı."},500);}
}