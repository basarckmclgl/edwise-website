
import { requireEditor } from "./_auth.js";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 8192;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, i + chunkSize)
    );
  }

  return btoa(binary);
}

export async function onRequestPost(context) {
  try {
    const auth = await requireEditor(context);

    if (auth.response) return auth.response;

    const token = context.env.GITHUB_TOKEN;
    const repo = context.env.GITHUB_REPO;
    const db = context.env.DB;

    if (!token || !repo || !db) {
      return json({
        error: "GitHub veya veritabanı bağlantısı bulunamadı."
      }, 500);
    }

    const form = await context.request.formData();
    const file = form.get("file");

    if (!file || typeof file.arrayBuffer !== "function" || !file.size) {
      return json({ error: "Lütfen bir görsel seç." }, 400);
    }

    if (!ALLOWED_TYPES[file.type]) {
      return json({
        error: "JPG, PNG, WEBP veya GIF dosyası seçmelisin."
      }, 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return json({
        error: "Dosya boyutu en fazla 5 MB olabilir."
      }, 400);
    }

    const extension = ALLOWED_TYPES[file.type];
    const filename = `${crypto.randomUUID()}.${extension}`;
    const path = `media/${filename}`;
    const url = `https://raw.githubusercontent.com/${repo}/main/${path}`;

    const bytes = new Uint8Array(await file.arrayBuffer());

    const githubResponse = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "EDWISE-CMS"
        },
        body: JSON.stringify({
          message: `EDWISE CMS görseli: ${filename}`,
          content: toBase64(bytes),
          branch: "main"
        })
      }
    );

    const githubData = await githubResponse.json();

    if (!githubResponse.ok) {
      return json({
        error: githubData.message || "GitHub yüklemesi başarısız."
      }, 502);
    }

    try {
      await db.prepare(`
        INSERT INTO media
          (file_name, file_url, file_type, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).bind(filename, url, file.type).run();

    } catch (dbError) {
      return json({
        success: true,
        warning: "Görsel GitHub'a yüklendi ancak veritabanı kaydı başarısız.",
        filename,
        url
      }, 207);
    }

    return json({
      success: true,
      filename,
      url,
      message: "Görsel yüklendi ve medya kütüphanesine kaydedildi."
    });

  } catch (error) {
    return json({
      error: `Sunucu hatası: ${error?.message || "Bilinmeyen hata"}`
    }, 500);
  }
}
