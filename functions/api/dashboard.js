import { requirePermission } from "./_auth.js";
const json = (data, status = 200) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store" }
});

async function countTable(db, table, excludeDeleted = false) {
  const schema = await db.prepare("PRAGMA table_info('" + table + "')").all();
  const columns = new Set((schema.results || []).map(column => column.name));
  if (!columns.size) return { count: null, available: false };

  const where = excludeDeleted && columns.has("deleted_at")
    ? " WHERE deleted_at IS NULL"
    : "";
  const result = await db.prepare("SELECT COUNT(*) AS total FROM " + table + where).first();
  return { count: Number(result?.total || 0), available: true };
}

export async function onRequestGet(context) {
  try {
    const auth = await requirePermission(context, "dashboard", "view");
    if (auth.response) return auth.response;
    const db = context.env.DB;
    if (!db) return json({ success: false, message: "Veritabanı bağlantısı bulunamadı." }, 503);

    const [pages, services, applications, media] = await Promise.all([
      countTable(db, "pages", true),
      countTable(db, "services"),
      countTable(db, "applications"),
      countTable(db, "media")
    ]);

    let pendingApplications = null;
    if (applications.available) {
      const pending = await db.prepare("SELECT COUNT(*) AS total FROM applications WHERE status = ?").bind("new").first();
      pendingApplications = Number(pending?.total || 0);
    }

    return json({
      success: true,
      counts: {
        pages,
        services,
        applications,
        pendingApplications,
        media
      },
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return json({
      success: false,
      message: "Genel Bakış verileri alınamadı: " + String(error?.message || error)
    }, 500);
  }
}
