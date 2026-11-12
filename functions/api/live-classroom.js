import { requireEditor } from "./_auth.js";
import { logAudit } from "./_audit.js";

const json = (data, status = 200) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store" }
});

const courses = ["ielts", "toefl", "yds", "yokdil", "speaking-club", "education-consultancy"];
const API_BASE = "https://api.cloudflare.com/client/v4";

function originOk(request) {
  const origin = request.headers.get("Origin");
  try { return !!origin && origin === new URL(request.url).origin; }
  catch { return false; }
}

function config(env) {
  const accountId = env.REALTIMEKIT_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
  const appId = env.REALTIMEKIT_APP_ID;
  const apiToken = env.REALTIMEKIT_API_TOKEN || env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !appId || !apiToken) {
    throw new Error("RealtimeKit bağlantısı henüz yapılandırılmamış. Cloudflare ortam değişkenleri eksik.");
  }
  return { accountId, appId, apiToken };
}

async function cloudflare(env, path, method = "GET", body) {
  const cfg = config(env);
  const response = await fetch(API_BASE + "/accounts/" + encodeURIComponent(cfg.accountId) +
    "/realtime/kit/" + encodeURIComponent(cfg.appId) + path, {
      method,
      headers: {
        "Authorization": "Bearer " + cfg.apiToken,
        "Content-Type": "application/json"
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    const detail = result.errors?.map(x => x.message).filter(Boolean).join("; ");
    throw new Error(detail || "Cloudflare RealtimeKit isteği başarısız oldu (" + response.status + ").");
  }
  return result.data;
}

async function ensure(DB) {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS lesson_live_meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id INTEGER NOT NULL UNIQUE,
    course TEXT NOT NULL,
    meeting_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready',
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
}

async function issueParticipant(env, meetingId, presetName, name, customId) {
  const expiresOn = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const data = await cloudflare(env, "/meetings/" + encodeURIComponent(meetingId) + "/participants", "POST", {
    custom_participant_id: customId,
    preset_name: presetName,
    name,
    token: { expires_on: expiresOn }
  });
  if (!data?.token) throw new Error("RealtimeKit katılım anahtarı oluşturulamadı.");
  return data.token;
}

async function authorize(context) {
  const result = await requireEditor(context);
  return result.response ? { response: result.response } : { admin: result.admin };
}

export async function onRequestGet(context) {
  const auth = await authorize(context);
  if (auth.response) return auth.response;
  try {
    await ensure(context.env.DB);
    const course = new URL(context.request.url).searchParams.get("course");
    if (course && !courses.includes(course)) return json({ success: false, message: "Eğitim alanı geçersiz." }, 400);
    const result = course
      ? await context.env.DB.prepare("SELECT lesson_id, course, meeting_id, title, status, created_at FROM lesson_live_meetings WHERE course = ? ORDER BY id DESC").bind(course).all()
      : await context.env.DB.prepare("SELECT lesson_id, course, meeting_id, title, status, created_at FROM lesson_live_meetings ORDER BY id DESC").all();
    return json({ success: true, meetings: result.results || [] });
  } catch (error) {
    return json({ success: false, message: error.message || "Canlı ders bilgileri alınamadı." }, 500);
  }
}

export async function onRequestPost(context) {
  if (!originOk(context.request)) return json({ success: false, message: "İstek kaynağı geçersiz." }, 403);
  const auth = await authorize(context);
  if (auth.response) return auth.response;

  try {
    await ensure(context.env.DB);
    const body = await context.request.json();
    const action = String(body.action || "");
    const lessonId = Number(body.lesson_id);
    if (!Number.isInteger(lessonId) || lessonId < 1) return json({ success: false, message: "Ders kaydı geçersiz." }, 400);

    const lesson = await context.env.DB.prepare("SELECT id, course, title FROM lesson_sessions WHERE id = ?").bind(lessonId).first();
    if (!lesson) return json({ success: false, message: "Ders bulunamadı." }, 404);
    if (!courses.includes(lesson.course)) return json({ success: false, message: "Eğitim alanı geçersiz." }, 400);

    let room = await context.env.DB.prepare("SELECT * FROM lesson_live_meetings WHERE lesson_id = ?").bind(lessonId).first();

    if (action === "create") {
      if (!room) {
        const created = await cloudflare(context.env, "/meetings", "POST", {
          title: "EDWISE | " + lesson.title,
          record_on_start: false
        });
        const meetingId = created?.id;
        if (!meetingId) throw new Error("Cloudflare toplantı kimliği döndürmedi.");
        await context.env.DB.prepare("INSERT INTO lesson_live_meetings(lesson_id,course,meeting_id,title,created_by) VALUES(?,?,?,?,?)")
          .bind(lessonId, lesson.course, meetingId, lesson.title, String(auth.admin?.email || auth.admin?.username || "Yönetici")).run();
        room = await context.env.DB.prepare("SELECT * FROM lesson_live_meetings WHERE lesson_id = ?").bind(lessonId).first();
      }
      const token = await issueParticipant(context.env, room.meeting_id, "group_call_host",
        String(auth.admin?.username || auth.admin?.email || "EDWISE Öğretmeni").slice(0, 80),
        "teacher-" + auth.admin.id + "-" + crypto.randomUUID());
      await logAudit(context.env.DB, context.request, auth.admin, {
        action: "live_classroom_host_token_created",
        entity_type: "lesson_live_meeting",
        entity_id: room.id,
        entity_title: room.title,
        details: { course: room.course }
      });
      return json({ success: true, meeting_id: room.meeting_id, token, classroom_url: "/classroom.html" });
    }

    if (action === "invite") {
      if (!room) return json({ success: false, message: "Önce canlı sınıfı oluşturmalısınız." }, 409);
      const participantName = String(body.name || "EDWISE Öğrencisi").trim().slice(0, 80) || "EDWISE Öğrencisi";
      const token = await issueParticipant(context.env, room.meeting_id, "group_call_participant",
        participantName, "student-" + crypto.randomUUID());
      await logAudit(context.env.DB, context.request, auth.admin, {
        action: "live_classroom_student_invite_created",
        entity_type: "lesson_live_meeting",
        entity_id: room.id,
        entity_title: room.title,
        details: { course: room.course }
      });
      return json({ success: true, meeting_id: room.meeting_id, token, classroom_url: "/classroom.html" });
    }

    return json({ success: false, message: "Geçersiz işlem." }, 400);
  } catch (error) {
    return json({ success: false, message: error.message || "Canlı sınıf işlemi tamamlanamadı." }, 500);
  }
}
