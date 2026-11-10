
import { requireAdmin } from "./_auth.js";

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
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export async function onRequestPost(context) {
  try {
    const auth = await requireAdmin(context);

    if (auth instanceof Response) {
      return auth;
    }

    const token = context.env.GITHUB_TOKEN;
    const repo = context.env.GITHUB_REPO || "basarckmclgl/edwise-website";

    if (!token) {
      return json({
        error: "GITHUB_TOKEN bulunamadı. Cloudflare gizli değişkenini kontrol et."
      }, 500);
    }

    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      return json({
        error: "GITHUB_REPO ayarı hatalı."
      }, 500);
    }

    let form;

    try {
      form = await context.request.formData();
    } catch {
      return json({
        error: "Form verisi okunamadı. Sayfayı yenileyip tekrar dene."
      }, 400);
    }

    const file = form.get("file");

    if (!file || typeof file.arrayBuffer !== "function" || !file.size) {
      return json({
        error: "Lütfen önce bir görsel dosyası seç."
      }, 400);
    }

    if (!ALLOWED_TYPES[file.type]) {
      return json({
        error: "Desteklenmeyen dosya türü. JPG, PNG, WEBP veya GIF kullan."
      }, 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return json({
        error: "Dosya boyutu 5 MB sınırını aşıyor."
      }, 400);
    }

    const extension = ALLOWED_TYPES[file.type];
    const filename = `${crypto.randomUUID()}.${extension}`;
    const path = `media/${filename}`;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const content = toBase64(bytes);

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
          message: `EDWISE CMS görsel yükleme: ${filename}`,
          content,
          branch: "main"
        })
      }
    );

    const responseText = await githubResponse.text();

    let githubData = {};

    try {
      githubData = JSON.parse(responseText);
    } catch {
      githubData = {};
    }

    if (!githubResponse.ok) {
      return json({
        error: `GitHub yükleme hatası (${githubResponse.status}): ${
          githubData.message || "GitHub isteği başarısız oldu."
        }`
      }, 502);
    }

    return json({
      success: true,
      filename,
      url: `https://raw.githubusercontent.com/${repo}/main/${path}`,
      message: "Görsel başarıyla yüklendi."
    });

  } catch (error) {
    return json({
      error: `Sunucu hatası: ${error?.message || "Bilinmeyen hata"}`
    }, 500);
  }
}
