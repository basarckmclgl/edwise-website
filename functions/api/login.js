import { logAudit } from "./_audit.js";

async function verifyPassword(password, storedHash) {
  const parts = storedHash.split("$");

  if (parts.length !== 4 || parts[0] !== "pbkdf2") {
    return false;
  }

  const iterations = Number(parts[1]);
  const saltHex = parts[2];
  const expectedHex = parts[3];

  if (
    iterations !== 100000 ||
    !/^[0-9a-f]{32}$/i.test(saltHex) ||
    !/^[0-9a-f]{64}$/i.test(expectedHex)
  ) {
    return false;
  }

  const salt = new Uint8Array(
    saltHex.match(/.{2}/g).map(byte => parseInt(byte, 16))
  );

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const result = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    key,
    256
  );

  const actualHex = Array.from(new Uint8Array(result))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

  let difference = actualHex.length ^ expectedHex.length;

  for (let i = 0; i < actualHex.length; i++) {
    difference |= actualHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }

  return difference === 0;
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({ success: false, message: "Veritabanı bağlantısı yok." }, 500);
    }

    const origin = request.headers.get("Origin");

    if (!origin || origin !== new URL(request.url).origin) {
      return json({ success: false, message: "İstek kaynağı geçersiz." }, 403);
    }

    await env.DB.exec(`CREATE TABLE IF NOT EXISTS admin_login_attempts (ip_address TEXT NOT NULL, username TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, first_attempt_at TEXT NOT NULL DEFAULT (datetime('now')), last_attempt_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(ip_address,username));`);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const data = await request.json();
    const username = String(data.username || "").trim().slice(0,50);
    const password = String(data.password || "");
    const attempt = await env.DB.prepare("SELECT attempts,(julianday('now')-julianday(first_attempt_at))*1440 AS age_minutes FROM admin_login_attempts WHERE ip_address=? AND username=?").bind(ip,username.toLowerCase()).first();
    const ipAttempts = await env.DB.prepare("SELECT COALESCE(SUM(attempts),0) AS attempts FROM admin_login_attempts WHERE ip_address=? AND (julianday('now')-julianday(last_attempt_at))*1440<15").bind(ip).first();
    if((attempt && Number(attempt.attempts)>=8 && Number(attempt.age_minutes)<15) || Number(ipAttempts?.attempts)>=20){
      await logAudit(env.DB,request,null,{action:"login_rate_limited",entity_type:"security",entity_title:"Giriş denemesi sınırlandı",details:{username,attempts:attempt.attempts}});
      return json({success:false,message:"Çok fazla başarısız giriş denemesi. 15 dakika sonra tekrar deneyin."},429);
    }

    if (!username || !password || password.length > 128) {
      return json({ success: false, message: "Kullanıcı adı veya parola hatalı." }, 400);
    }

    const admin = await env.DB.prepare(`
      SELECT id, username, email, password_hash, role, force_password_change
      FROM admins
      WHERE username = ? AND is_active = 1
      LIMIT 1
    `).bind(username).first();

    if (!admin) {
      await env.DB.prepare(`INSERT INTO admin_login_attempts(ip_address,username,attempts) VALUES(?,?,1) ON CONFLICT(ip_address,username) DO UPDATE SET attempts=CASE WHEN (julianday('now')-julianday(first_attempt_at))*1440>15 THEN 1 ELSE attempts+1 END,first_attempt_at=CASE WHEN (julianday('now')-julianday(first_attempt_at))*1440>15 THEN datetime('now') ELSE first_attempt_at END,last_attempt_at=datetime('now')`).bind(ip,username.toLowerCase()).run();
      await logAudit(env.DB,request,null,{action:"login_failed",entity_type:"security",entity_title:"Başarısız yönetici girişi",details:{username,reason:"account_not_found"}});
      return json({ success: false, message: "Kullanıcı adı veya parola hatalı." }, 401);
    }

    const validPassword = await verifyPassword(
      password,
      admin.password_hash
    );

    if (!validPassword) {
      await env.DB.prepare(`INSERT INTO admin_login_attempts(ip_address,username,attempts) VALUES(?,?,1) ON CONFLICT(ip_address,username) DO UPDATE SET attempts=CASE WHEN (julianday('now')-julianday(first_attempt_at))*1440>15 THEN 1 ELSE attempts+1 END,first_attempt_at=CASE WHEN (julianday('now')-julianday(first_attempt_at))*1440>15 THEN datetime('now') ELSE first_attempt_at END,last_attempt_at=datetime('now')`).bind(ip,username.toLowerCase()).run();
      await logAudit(env.DB,request,null,{action:"login_failed",entity_type:"security",entity_title:"Başarısız yönetici girişi",details:{username,reason:"invalid_password"}});
      return json({ success: false, message: "Kullanıcı adı veya parola hatalı." }, 401);
    }
    await env.DB.prepare("DELETE FROM admin_login_attempts WHERE ip_address=? AND username=?").bind(ip,username.toLowerCase()).run();

    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(randomBytes)
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");

    const tokenHash = await hashToken(token);

    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    await env.DB.prepare(`
      DELETE FROM admin_sessions
      WHERE expires_at <= ?
    `).bind(new Date().toISOString()).run();

    await env.DB.prepare(`
      INSERT INTO admin_sessions
        (admin_id, token_hash, expires_at)
      VALUES (?, ?, ?)
    `).bind(admin.id, tokenHash, expiresAt).run();

    await env.DB.prepare(`
      UPDATE admins
      SET last_login_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(admin.id).run();

    await logAudit(env.DB,request,{id:admin.id,username:admin.username,role:admin.role},{action:"login_success",entity_type:"admin",entity_id:admin.id,entity_title:admin.username,details:{}});
    const cookie = [
      `edwise_session=${token}`,
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Path=/",
      "Max-Age=604800"
    ].join("; ");

    return json({
      success: true,
      message: "Giriş başarılı.",
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        force_password_change: Number(admin.force_password_change) === 1
      }
    }, 200, {
      "Set-Cookie": cookie
    });

  } catch (error) {
    console.error("EDWISE LOGIN ERROR:", error);

    return json({
      success: false,
      message: "Giriş sırasında sunucu hatası oluştu."
    }, 500);
  }
}
