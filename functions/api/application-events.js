import { requireSuperAdmin } from "./_auth.js";

const json = (data, status = 200) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store" }
});
const allowedEvents = new Set([
  "apply_click", "form_view", "form_start", "submit_attempt",
  "form_abandon", "application_saved", "email_sent", "email_failed",
  "whatsapp_redirect", "site_return", "page_view", "scroll_25", "scroll_50", "scroll_75", "scroll_90"
]);
function validOrigin(request) {
  const origin = request.headers.get("Origin");
  try { return !!origin && origin === new URL(request.url).origin; } catch { return false; }
}
function clean(value, max) { return String(value || "").trim().slice(0, max); }
async function ensureTable(DB) {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS application_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    page_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
  await DB.prepare("CREATE INDEX IF NOT EXISTS idx_application_events_created ON application_events(created_at)").run();
  await DB.prepare("CREATE INDEX IF NOT EXISTS idx_application_events_session ON application_events(session_id)").run();
}
async function recordEvent(DB, sessionId, eventName, pagePath) {
  await DB.prepare("INSERT INTO application_events (session_id,event_name,page_path) VALUES (?,?,?)")
    .bind(sessionId,eventName,pagePath).run();
}
export async function onRequestPost({ request, env }) {
  if (!validOrigin(request)) return json({ success:false, message:"İstek kaynağı doğrulanamadı." },403);
  try {
    const body = await request.json();
    const eventName = clean(body.event,40);
    const sessionId = clean(body.sessionId,64);
    const pagePath = clean(body.path,180);
    if (!allowedEvents.has(eventName) || !/^[a-zA-Z0-9_-]{12,64}$/.test(sessionId)) {
      return json({ success:false, message:"Analiz kaydı geçersiz." },400);
    }
    await ensureTable(env.DB);
    await recordEvent(env.DB,sessionId,eventName,pagePath);
    return json({ success:true });
  } catch {
    return json({ success:false, message:"Analiz kaydı alınamadı." },500);
  }
}
export async function onRequestGet(context) {
  const auth = await requireSuperAdmin(context);
  if (auth.response) return auth.response;
  try {
    const DB = context.env.DB;
    await ensureTable(DB);
    const { results } = await DB.prepare(`
      SELECT event_name, COUNT(*) AS event_count, COUNT(DISTINCT session_id) AS sessions
      FROM application_events
      WHERE datetime(created_at) >= datetime('now','-30 days')
      GROUP BY event_name
    `).all();
    const totals = {};
    for (const event of allowedEvents) totals[event] = { count:0, sessions:0 };
    for (const row of results || []) {
      if (totals[row.event_name]) totals[row.event_name] = {
        count:Number(row.event_count)||0, sessions:Number(row.sessions)||0
      };
    }
    const pageResult = await DB.prepare(`
      SELECT page_path,
       SUM(CASE WHEN event_name='page_view' THEN 1 ELSE 0 END) AS views,
       COUNT(DISTINCT CASE WHEN event_name='page_view' THEN session_id END) AS visitors,
       SUM(CASE WHEN event_name='scroll_25' THEN 1 ELSE 0 END) AS scroll_25,
       SUM(CASE WHEN event_name='scroll_50' THEN 1 ELSE 0 END) AS scroll_50,
       SUM(CASE WHEN event_name='scroll_75' THEN 1 ELSE 0 END) AS scroll_75,
       SUM(CASE WHEN event_name='scroll_90' THEN 1 ELSE 0 END) AS scroll_90
      FROM application_events
      WHERE datetime(created_at) >= datetime('now','-30 days')
       AND event_name IN ('page_view','scroll_25','scroll_50','scroll_75','scroll_90')
      GROUP BY page_path ORDER BY views DESC LIMIT 100
    `).all();
    const pageReports=(pageResult.results||[]).map(row=>({
      path:row.page_path||"/",views:Number(row.views)||0,visitors:Number(row.visitors)||0,
      scroll25:Number(row.scroll_25)||0,scroll50:Number(row.scroll_50)||0,
      scroll75:Number(row.scroll_75)||0,scroll90:Number(row.scroll_90)||0
    }));
    const detailResult = await DB.prepare(`
      SELECT substr(session_id,1,7) || '…' AS session_label,
             event_name, page_path, created_at
      FROM application_events
      WHERE datetime(created_at) >= datetime('now','-30 days')
        AND event_name IN ('page_view','scroll_25','scroll_50','scroll_75','scroll_90')
      ORDER BY datetime(created_at) DESC
      LIMIT 300
    `).all();
    const pageRecords = (detailResult.results || []).map(row => ({
      session: row.session_label || '—',
      event: row.event_name,
      path: row.page_path || '/',
      date: row.created_at || ''
    }));
    return json({ success:true, periodDays:30, totals, pageReports, pageRecords });
  } catch {
    return json({ success:false, message:"Başvuru hunisi verileri alınamadı." },500);
  }
}
