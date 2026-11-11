const AUDIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS admin_audit_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_id INTEGER,
 actor_username TEXT,
 actor_role TEXT,
 action TEXT NOT NULL,
 entity_type TEXT NOT NULL,
 entity_id TEXT,
 entity_title TEXT,
 details_json TEXT,
 ip_address TEXT,
 user_agent TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_log(actor_id, created_at DESC);
`;

export async function ensureAuditTable(db) {
 await db.exec(AUDIT_SCHEMA);
}

export async function logAudit(db, request, admin, event) {
 try {
  await ensureAuditTable(db);
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || null;
  const agent = (request.headers.get("User-Agent") || "").slice(0, 500);
  await db.prepare(`
   INSERT INTO admin_audit_log
   (actor_id,actor_username,actor_role,action,entity_type,entity_id,entity_title,details_json,ip_address,user_agent)
   VALUES (?,?,?,?,?,?,?,?,?,?)
  `).bind(
   admin?.id ?? null, admin?.username ?? "Bilinmeyen", admin?.role ?? "unknown",
   String(event.action || "unknown").slice(0,80),
   String(event.entity_type || "system").slice(0,40),
   event.entity_id == null ? null : String(event.entity_id).slice(0,100),
   event.entity_title == null ? null : String(event.entity_title).slice(0,250),
   event.details == null ? null : JSON.stringify(event.details),
   ip, agent
  ).run();
 } catch (error) {
  console.error("EDWISE audit log error", error);
 }
}
