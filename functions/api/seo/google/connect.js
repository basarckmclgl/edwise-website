import { requirePermission } from "../../_auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const PREVIEW="pinar-iskelet.edwise.pages.dev";
async function sha(value){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
export async function onRequestPost(context){
 const {request,env}=context;const url=new URL(request.url);
 if(url.hostname!==PREVIEW)return json({success:false,message:"Preview only"},404);
 const auth=await requirePermission(context,"seo","edit");if(auth.response)return auth.response;
 if(!env["edwise-deneme"])return json({success:false,message:"Preview DB binding missing"},503);
 if(!env.GOOGLE_OAUTH_CLIENT_ID)return json({success:false,message:"Google OAuth client ID secret is not configured"},503);
 const state=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
 const stateHash=await sha(state);const db=env["edwise-deneme"];
 await db.prepare("CREATE TABLE IF NOT EXISTS seo_google_oauth_state (state_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
 await db.prepare("INSERT INTO seo_google_oauth_state(state_hash,created_at) VALUES(?,datetime('now'))").bind(stateHash).run();
 await db.prepare("DELETE FROM seo_google_oauth_state WHERE created_at < datetime('now','-1 hour')").run();
 const redirectUri="https://yonetim-paneli.edwise.pages.dev/api/seo/google/callback";
 const params=new URLSearchParams({client_id:env.GOOGLE_OAUTH_CLIENT_ID,redirect_uri:redirectUri,response_type:"code",scope:"https://www.googleapis.com/auth/webmasters.readonly",access_type:"offline",prompt:"consent",include_granted_scopes:"true",state});
 return json({success:true,url:"https://accounts.google.com/o/oauth2/v2/auth?"+params.toString()});
}
