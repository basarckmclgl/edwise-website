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
    country_code TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
  try { await DB.prepare("ALTER TABLE application_events ADD COLUMN country_code TEXT").run(); } catch (error) { /* column already exists */ }
  await DB.prepare("CREATE INDEX IF NOT EXISTS idx_application_events_created ON application_events(created_at)").run();
  await DB.prepare("CREATE INDEX IF NOT EXISTS idx_application_events_session ON application_events(session_id)").run();
}
async function recordEvent(DB, sessionId, eventName, pagePath, countryCode) {
  await DB.prepare("INSERT INTO application_events (session_id,event_name,page_path,country_code) VALUES (?,?,?,?)")
    .bind(sessionId,eventName,pagePath,countryCode).run();
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
    const countryCode = clean(request.cf?.country || request.headers.get("CF-IPCountry") || "",2).toUpperCase().replace(/[^A-Z]/g,"");
    await recordEvent(env.DB,sessionId,eventName,pagePath,countryCode || null);
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
    // Analiz kayıtları en fazla 30 gün saklanır.
    await DB.prepare("DELETE FROM application_events WHERE datetime(created_at) < datetime('now','-30 days')").run();
    const range = new URL(context.request.url).searchParams.get("range") || "30days";
    const rangeDays = range === "day" ? 1 : range === "week" ? 7 : 30;
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
      SELECT page_path, country_code,
       SUM(CASE WHEN event_name='page_view' THEN 1 ELSE 0 END) AS views,
       COUNT(DISTINCT CASE WHEN event_name='page_view' THEN session_id END) AS visitors,
       SUM(CASE WHEN event_name='scroll_25' THEN 1 ELSE 0 END) AS scroll_25,
       SUM(CASE WHEN event_name='scroll_50' THEN 1 ELSE 0 END) AS scroll_50,
       SUM(CASE WHEN event_name='scroll_75' THEN 1 ELSE 0 END) AS scroll_75,
       SUM(CASE WHEN event_name='scroll_90' THEN 1 ELSE 0 END) AS scroll_90
      FROM application_events
      WHERE datetime(created_at) >= datetime('now','-30 days')
       AND event_name IN ('page_view','scroll_25','scroll_50','scroll_75','scroll_90')
      GROUP BY page_path, country_code ORDER BY views DESC LIMIT 200
    `).all();
    const pageReports=(pageResult.results||[]).map(row=>({
      path:row.page_path||"/",country:row.country_code||"",views:Number(row.views)||0,visitors:Number(row.visitors)||0,
      scroll25:Number(row.scroll_25)||0,scroll50:Number(row.scroll_50)||0,
      scroll75:Number(row.scroll_75)||0,scroll90:Number(row.scroll_90)||0
    }));
    const detailResult = await DB.prepare(`
      SELECT substr(session_id,1,7) || '…' AS session_label,
             event_name, page_path, created_at, country_code
      FROM application_events
      WHERE datetime(created_at) >= datetime('now','-30 days')
        AND event_name IN ('page_view','scroll_25','scroll_50','scroll_75','scroll_90')
      ORDER BY datetime(created_at) DESC
      LIMIT 300
    `).all();
    const pageRecords = (detailResult.results || []).map(row => ({
      session: row.session_label || '—',
      country: row.country_code || '',
      event: row.event_name,
      path: row.page_path || '/',
      date: row.created_at || ''
    }));
    const funnelResult = await DB.prepare(`
      SELECT substr(session_id,1,7) || '…' AS session_label,
             event_name, page_path, created_at, country_code
      FROM application_events
      WHERE datetime(created_at) >= datetime('now','-30 days')
        AND event_name IN ('apply_click','form_view','form_start','submit_attempt','form_abandon','application_saved','email_sent','email_failed','whatsapp_redirect','site_return')
      ORDER BY datetime(created_at) DESC
      LIMIT 300
    `).all();
    const funnelRecords = (funnelResult.results || []).map(row => ({
      session: row.session_label || '—',
      country: row.country_code || '',
      event: row.event_name,
      path: row.page_path || '/',
      date: row.created_at || ''
    }));
    const historyResult = await DB.prepare(`
      SELECT date(created_at) AS report_date,
        COUNT(*) AS total_events,
        COUNT(DISTINCT session_id) AS sessions,
        SUM(CASE WHEN event_name='apply_click' THEN 1 ELSE 0 END) AS apply_click,
        SUM(CASE WHEN event_name='form_view' THEN 1 ELSE 0 END) AS form_view,
        SUM(CASE WHEN event_name='form_start' THEN 1 ELSE 0 END) AS form_start,
        SUM(CASE WHEN event_name='application_saved' THEN 1 ELSE 0 END) AS application_saved,
        SUM(CASE WHEN event_name='email_sent' THEN 1 ELSE 0 END) AS email_sent,
        SUM(CASE WHEN event_name='whatsapp_redirect' THEN 1 ELSE 0 END) AS whatsapp_redirect,
        SUM(CASE WHEN event_name='page_view' THEN 1 ELSE 0 END) AS page_views
      FROM application_events
      WHERE datetime(created_at) >= datetime('now', ?)
      GROUP BY date(created_at)
      ORDER BY report_date DESC
    `).bind(`-${rangeDays} days`).all();
    const historyRows = (historyResult.results || []).map(row => ({
      date:row.report_date || "", total:Number(row.total_events)||0, sessions:Number(row.sessions)||0,
      applyClick:Number(row.apply_click)||0, formView:Number(row.form_view)||0,
      formStart:Number(row.form_start)||0, applications:Number(row.application_saved)||0,
      emails:Number(row.email_sent)||0, whatsapp:Number(row.whatsapp_redirect)||0,
      pageViews:Number(row.page_views)||0
    }));
    const historyTotals = historyRows.reduce((sum,row) => {
      for (const key of ["total","sessions","applyClick","formView","formStart","applications","emails","whatsapp","pageViews"]) sum[key]+=row[key];
      return sum;
    },{total:0,sessions:0,applyClick:0,formView:0,formStart:0,applications:0,emails:0,whatsapp:0,pageViews:0});
    return json({ success:true, periodDays:30, totals, pageReports, pageRecords, funnelRecords, historyRange:range, historyRows, historyTotals });
  } catch {
    return json({ success:false, message:"Başvuru hunisi verileri alınamadı." },500);
  }
}
