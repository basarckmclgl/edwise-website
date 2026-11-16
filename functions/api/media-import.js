import { requireEditor } from "./_auth.js";
import { logAudit } from "./_audit.js";

function json(data,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store"}});}
function base64ToBytes(value){
  const binary=atob(value.replace(/\n/g,""));
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
function toBase64(bytes){
  let binary="";
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
function detectType(bytes){
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return "image/png";
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return "image/jpeg";
  if(bytes.length>=12&&String.fromCharCode(...bytes.subarray(0,4))==="RIFF"&&String.fromCharCode(...bytes.subarray(8,12))==="WEBP")return "image/webp";
  if(bytes.length>=6&&/^GIF8[79]a$/.test(String.fromCharCode(...bytes.subarray(0,6))))return "image/gif";
  return null;
}

export async function onRequestPost(context){
  const {request,env}=context;
  try{
    const origin=request.headers.get("Origin");
    if(!origin||origin!==new URL(request.url).origin)return json({success:false,error:"İstek kaynağı geçersiz."},403);
    const auth=await requireEditor(context);
    if(auth.response)return auth.response;
    if(!env.DB||!env.GITHUB_TOKEN||!env.GITHUB_REPO)return json({success:false,error:"Sunucu ayarları eksik."},500);

    const mediaBranch=env.MEDIA_GITHUB_BRANCH||"main";
    const headers={"Authorization":"Bearer "+env.GITHUB_TOKEN,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"EDWISE-CMS"};
    const sources=[
      {path:"media/4117a118-e1e2-47b0-b56b-74833991107a.png",copy:false},
      {path:"assets/images/logo.png",copy:true}
    ];
    const imported=[];
    const skipped=[];

    for(const source of sources){
      const sourceName=source.path.split("/").pop();
      const sourceResponse=await fetch("https://api.github.com/repos/"+env.GITHUB_REPO+"/contents/"+source.path+"?ref="+encodeURIComponent(mediaBranch),{headers});
      if(!sourceResponse.ok){skipped.push({file:sourceName,reason:"Kaynak dosya okunamadı."});continue;}
      const sourceData=await sourceResponse.json();
      const bytes=base64ToBytes(sourceData.content||"");
      const type=detectType(bytes);
      if(!type){skipped.push({file:sourceName,reason:"Dosya geçerli bir görsel değil."});continue;}

      let filename=sourceName;
      if(source.copy){
        const extension=type==="image/jpeg"?"jpg":type.split("/")[1];
        filename=crypto.randomUUID()+"."+extension;
        const put=await fetch("https://api.github.com/repos/"+env.GITHUB_REPO+"/contents/media/"+filename,{
          method:"PUT",headers:{...headers,"Content-Type":"application/json"},
          body:JSON.stringify({message:"EDWISE: site görselini medya kütüphanesine aktar",content:toBase64(bytes),branch:mediaBranch})
        });
        if(!put.ok){skipped.push({file:sourceName,reason:"Medya deposuna kopyalanamadı."});continue;}
      }

      const existing=await env.DB.prepare("SELECT id FROM media WHERE file_name=?").bind(filename).first();
      if(existing){skipped.push({file:sourceName,reason:"Zaten medya kütüphanesinde."});continue;}

      const url="/api/media/"+filename;
      await env.DB.prepare("INSERT INTO media (file_name,file_url,file_type,created_at) VALUES (?,?,?,datetime('now'))").bind(filename,url,type).run();
      const record=await env.DB.prepare("SELECT * FROM media WHERE file_name=?").bind(filename).first();
      await logAudit(env.DB,request,auth.admin,{action:"media_imported",entity_type:"media",entity_id:filename,entity_title:sourceName,details:{before:null,after:record,source_path:source.path}});
      imported.push({file:sourceName,filename,url});
    }

    return json({success:true,imported,skipped,message:imported.length+" görsel medya kütüphanesine aktarıldı."});
  }catch(error){return json({success:false,error:error?.message||"Görsel aktarımı başarısız."},500);}
}
