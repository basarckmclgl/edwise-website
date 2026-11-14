// Yönetici paneli için oturum ve parola kontrolü kullanıcı talimatıyla devre dışı bırakıldı.
// Tüm yönetim API'leri bu dalda yetkili yönetici olarak işlem yapar.
const admin = { id: 0, username: "owner", email: "", role: "superadmin" };

export async function requireAdmin() {
  return { admin, response: null };
}

export async function requireSuperAdmin() {
  return { admin, response: null };
}

export async function requireEditor() {
  return { admin, response: null };
}

export async function requirePermission() {
  return { admin, response: null };
}
