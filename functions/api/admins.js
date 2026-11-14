
import { requireSuperAdmin } from "./_auth.js";
import { logAudit } from "./_audit.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function authorize(context) {
  const auth = await requireSuperAdmin(context);
  if (auth.response) return { response: auth.response };
  return { admin: auth.admin };
}

function checkOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;

  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function clean(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Mevcut giriş sistemiyle uyumlu PBKDF2 şifreleme.
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    key,
    256
  );

  return `pbkdf2$100000$${toHex(salt)}$${toHex(derived)}`;
}

// Kullanıcı listesini getir.
export async function onRequestGet(context) {
  try {
    const auth = await authorize(context);
    if (auth.response) return auth.response;

    const result = await context.env.DB.prepare(`
      SELECT
        id, username, email, role, is_active, permissions_json, force_password_change,
        created_at, updated_at, last_login_at
      FROM admins
      ORDER BY created_at DESC
    `).all();

    return json({
      success: true,
      admins: result.results || []
    });

  } catch (error) {
    return json({
      success: false,
      message: "Kullanıcılar alınamadı."
    }, 500);
  }
}

// Yeni içerik editörü oluştur.
export async function onRequestPost(context) {
  if (!checkOrigin(context.request)) {
    return json({
      success: false,
      message: "İstek kaynağı geçersiz."
    }, 403);
  }

  try {
    const auth = await authorize(context);
    if (auth.response) return auth.response;

    const data = await context.request.json();

    const username = clean(data.username, 50);
    const email = clean(data.email, 254).toLowerCase();
    const password = String(data.password || "");

    if (username.length < 3) {
      return json({
        success: false,
        message: "Kullanıcı adı en az 3 karakter olmalıdır."
      }, 400);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({
        success: false,
        message: "Geçerli bir e-posta adresi girin."
      }, 400);
    }

    if (password.length < 8) {
      return json({
        success: false,
        message: "Şifre en az 8 karakter olmalıdır."
      }, 400);
    }

    const passwordHash = await hashPassword(password);

    const result = await context.env.DB.prepare(`
      INSERT INTO admins (
        username, email, password_hash,
        role, is_active, created_at, updated_at
      )
      VALUES (?, ?, ?, 'content_admin', 1, datetime('now'), datetime('now'))
    `).bind(username, email, passwordHash).run();

    await logAudit(context.env.DB,context.request,auth.admin,{action:"admin_created",entity_type:"admin",entity_id:result.meta?.last_row_id,entity_title:username,details:{email,role:"content_admin",is_active:true}});
    return json({success:true,message:"Yeni kullanıcı oluşturuldu.",id:result.meta?.last_row_id},201);

  } catch (error) {
    const message = String(error?.message || error);

    if (message.includes("UNIQUE")) {
      return json({
        success: false,
        message: "Bu kullanıcı adı veya e-posta zaten kullanılıyor."
      }, 409);
    }

    return json({
      success: false,
      message: "Kullanıcı oluşturulamadı."
    }, 500);
  }
}

// Kullanıcı bilgilerini, şifresini veya erişimini güncelle.
export async function onRequestPut(context) {
  if (!checkOrigin(context.request)) {
    return json({
      success: false,
      message: "İstek kaynağı geçersiz."
    }, 403);
  }

  try {
    const auth = await authorize(context);
    if (auth.response) return auth.response;

    const data = await context.request.json();
    const id = Number(data.id);

    if (!Number.isInteger(id) || id < 1) {
      return json({
        success: false,
        message: "Geçerli kullanıcı ID bilgisi gerekli."
      }, 400);
    }

    if (id === Number(auth.admin.id)) {
      return json({
        success: false,
        message: "Kendi yönetici hesabınızı bu bölümden değiştiremezsiniz."
      }, 403);
    }

    const target = await context.env.DB.prepare(
      "SELECT id, username, email, role, is_active, permissions_json FROM admins WHERE id = ?"
    ).bind(id).first();

    if (!target) {
      return json({
        success: false,
        message: "Kullanıcı bulunamadı."
      }, 404);
    }

    if (target.role === "superadmin") {
      return json({
        success: false,
        message: "Ana yönetici hesabı bu bölümden değiştirilemez."
      }, 403);
    }

    const username = clean(data.username, 50);
    const email = clean(data.email, 254).toLowerCase();
    const requestedRole = clean(data.role || "Admin", 50);
    const roleMap = { "Admin":"content_admin", "content_admin":"content_admin", "Editör":"editor", "editor":"editor", "Görüntüleyici":"viewer", "viewer":"viewer" };
    const roleKey = roleMap[requestedRole];
    if (!roleKey) return json({success:false,message:"Geçersiz kullanıcı rolü."},400);
    const existingPermissions = JSON.parse(target.permissions_json || "{}");
    const permissionsJson = JSON.stringify({ ...existingPermissions, __role_key: roleKey });

    if (username.length < 3) {
      return json({
        success: false,
        message: "Kullanıcı adı en az 3 karakter olmalıdır."
      }, 400);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({
        success: false,
        message: "Geçerli bir e-posta adresi girin."
      }, 400);
    }

    if (typeof data.is_active !== "boolean") {
      return json({
        success: false,
        message: "Kullanıcı erişim durumu belirtilmelidir."
      }, 400);
    }

    const password = String(data.password || "");

    if (password && password.length < 8) {
      return json({
        success: false,
        message: "Yeni şifre en az 8 karakter olmalıdır."
      }, 400);
    }

    let passwordHash = null;

    if (password) {
      passwordHash = await hashPassword(password);
    }

    await context.env.DB.prepare(`
     UPDATE admins
SET username = ?,
    email = ?,
    role = 'content_admin',
    permissions_json = ?,
    force_password_change = ?,
    is_active = ?,
    password_hash = COALESCE(?, password_hash),
    updated_at = datetime('now')
WHERE id = ?
    `).bind(
  username,
  email,
  permissionsJson,
  data.force_password_change ? 1 : 0,
  data.is_active ? 1 : 0,
  passwordHash,
  id
).run();

    if (!data.is_active || password) {
      await context.env.DB.prepare(
        "DELETE FROM admin_sessions WHERE admin_id = ?"
      ).bind(id).run();
    }

    await logAudit(context.env.DB,context.request,auth.admin,{action:"admin_updated",entity_type:"admin",entity_id:id,entity_title:username,details:{before:{username:target.username,email:target.email,is_active:Boolean(target.is_active)},after:{username,email,is_active:data.is_active},password_changed:Boolean(password)}});
    return json({success:true,message:"Kullanıcı bilgileri güncellendi."});

  } catch (error) {
    const message = String(error?.message || error);

    if (message.includes("UNIQUE")) {
      return json({
        success: false,
        message: "Bu kullanıcı adı veya e-posta başka bir hesapta kullanılıyor."
      }, 409);
    }

    return json({
      success: false,
      message: "Kullanıcı güncellenemedi."
    }, 500);
  }
}

// Kullanıcıyı silmek yerine devre dışı bırak.
export async function onRequestDelete(context) {
  if (!checkOrigin(context.request)) {
    return json({
      success: false,
      message: "İstek kaynağı geçersiz."
    }, 403);
  }

  try {
    const auth = await authorize(context);
    if (auth.response) return auth.response;

    const id = Number(
      new URL(context.request.url).searchParams.get("id")
    );

    if (!Number.isInteger(id) || id < 1) {
      return json({
        success: false,
        message: "Geçerli kullanıcı ID bilgisi gerekli."
      }, 400);
    }

    if (id === Number(auth.admin.id)) {
      return json({
        success: false,
        message: "Kendi hesabınızı devre dışı bırakamazsınız."
      }, 403);
    }

    const target = await context.env.DB.prepare(
      "SELECT username, role, is_active FROM admins WHERE id = ?"
    ).bind(id).first();

    if (!target) {
      return json({
        success: false,
        message: "Kullanıcı bulunamadı."
      }, 404);
    }

    if (target.role === "superadmin") {
      return json({
        success: false,
        message: "Ana yönetici hesabı devre dışı bırakılamaz."
      }, 403);
    }

    await context.env.DB.prepare(`
      UPDATE admins
      SET is_active = 0,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(id).run();

    await context.env.DB.prepare(
      "DELETE FROM admin_sessions WHERE admin_id = ?"
    ).bind(id).run();

    await logAudit(context.env.DB,context.request,auth.admin,{action:"admin_access_revoked",entity_type:"admin",entity_id:id,entity_title:target.username,details:{before:{is_active:Boolean(target.is_active)},after:{is_active:false},sessions_revoked:true}});
    return json({success:true,message:"Kullanıcının erişimi kaldırıldı."});

  } catch (error) {
    return json({
      success: false,
      message: "Kullanıcı devre dışı bırakılamadı."
    }, 500);
  }
}
