const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const PREVIEW="yonetim-paneli.edwise.pages.dev";
async function schema(db){
 await db.prepare("CREATE TABLE IF NOT EXISTS seo_google_oauth_state (state_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
 await db.prepare("CREATE TABLE IF NOT EXISTS seo_google_tokens (id INTEGER PRIMARY KEY CHECK(id=1), encrypted_refresh_token TEXT NOT NULL, iv TEXT NOT NULL, scopes TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
}
async function sha(value){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
async function key(env){if(!env.SEO_TOKEN_ENCRYPTION_KEY)throw new Error("SEO_TOKEN_ENCRYPTION_KEY secret is missing");const raw=Uint8Array.from(atob(env.SEO_TOKEN_ENCRYPTION_KEY),c=>c.charCodeAt(0));if(raw.length!==32)throw new Error("SEO_TOKEN_ENCRYPTION_KEY must be 32-byte base64");return crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt","decrypt"]);}
export async function onRequestGet({request,env}){
 const url=new URL(request.url);if(url.hostname!==PREVIEW)return new Response("Not found",{status:404});
 const db=env["edwise-deneme"];if(!db)return new Response("Preview DB binding missing",{status:503});
 const state=url.searchParams.get("state"),code=url.searchParams.get("code"),error=url.searchParams.get("error");
 if(error)return Response.redirect("https://"+PREVIEW+"/yonetim/index.html?seo_google=denied",302);
 if(!state||!code)return new Response("Missing OAuth state or code",{status:400});
 await schema(db);const hash=await sha(state);
 const row=await db.prepare("SELECT state_hash FROM seo_google_oauth_state WHERE state_hash=? AND created_at >= datetime('now','-10 minutes')").bind(hash).first();
 if(!row)return new Response("Invalid or expired OAuth state",{status:400});
 await db.prepare("DELETE FROM seo_google_oauth_state WHERE state_hash=?").bind(hash).run();
 if(!env.GOOGLE_OAUTH_CLIENT_ID||!env.GOOGLE_OAUTH_CLIENT_SECRET)return new Response("Google OAuth client secrets are not configured",{status:503});
 const redirectUri="https://"+PREVIEW+"/api/seo/google/callback";
 const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:env.GOOGLE_OAUTH_CLIENT_ID,client_secret:env.GOOGLE_OAUTH_CLIENT_SECRET,redirect_uri:redirectUri,grant_type:"authorization_code"})});
 const tokens=await tokenResponse.json();if(!tokenResponse.ok||!tokens.refresh_token)return new Response("Google token exchange failed: "+(tokens.error_description||tokens.error||"Refresh token was not returned"),{status:502});
 const iv=crypto.getRandomValues(new Uint8Array(12));const cryptoKey=await key(env);
 const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},cryptoKey,new TextEncoder().encode(tokens.refresh_token));
 const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
 await db.prepare("INSERT INTO seo_google_tokens(id,encrypted_refresh_token,iv,scopes,updated_at) VALUES(1,?,?,?,datetime('now')) ON CONFLICT(id) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token,iv=excluded.iv,scopes=excluded.scopes,updated_at=datetime('now')").bind(b64(encrypted),b64(iv),tokens.scope||"").run();
 return Response.redirect("https://"+PREVIEW+"/yonetim/index.html?seo_google=connected",302);
}
