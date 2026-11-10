
import { requireAdmin } from "./_auth.js";

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (auth instanceof Response) return auth;

  const { request, env } = context;

  try {
    if (!env.DB || !env.GITHUB_TOKEN || !env.GITHUB_REPO) {
      return Response.json({
        success: false,
        error: "Sunucu ayarları eksik."
      }, { status: 500 });
    }

    const body = await request.json();
    const fileUrl = body.file_url;

    if (!fileUrl || typeof fileUrl !== "string") {
      return Response.json({
        success: false,
        error: "Görsel adresi belirtilmedi."
      }, { status: 400 });
    }

    const expectedPrefix =
      `https://raw.githubusercontent.com/${env.GITHUB_REPO}/main/media/`;

    if (!fileUrl.startsWith(expectedPrefix)) {
      return Response.json({
        success: false,
        error: "Geçersiz görsel adresi."
      }, { status: 400 });
    }

    const fileName = decodeURIComponent(
      fileUrl.substring(expectedPrefix.length)
    );

    if (!fileName || fileName.includes("/") || fileName.includes("..")) {
      return Response.json({
        success: false,
        error: "Geçersiz dosya adı."
      }, { status: 400 });
    }

    const apiUrl =
      `https://api.github.com/repos/${env.GITHUB_REPO}/contents/media/${encodeURIComponent(fileName)}?ref=main`;

    const headers = {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "EDWISE-CMS"
    };

    const fileResponse = await fetch(apiUrl, { headers });

    if (!fileResponse.ok) {
      return Response.json({
        success: false,
        error: "Görsel GitHub üzerinde bulunamadı."
      }, { status: 404 });
    }

    const fileData = await fileResponse.json();

    const deleteResponse = await fetch(apiUrl, {
      method: "DELETE",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `EDWISE CMS: ${fileName} silindi`,
        sha: fileData.sha,
        branch: "main"
      })
    });

    if (!deleteResponse.ok) {
      return Response.json({
        success: false,
        error: "Görsel GitHub üzerinden silinemedi."
      }, { status: 502 });
    }

    try {
      await env.DB.prepare(
        "DELETE FROM media WHERE file_url = ?"
      ).bind(fileUrl).run();
    } catch (dbError) {
      return Response.json({
        success: true,
        warning: "Görsel silindi ancak medya kaydı veritabanından silinemedi."
      }, { status: 207 });
    }

    return Response.json({
      success: true,
      message: "Görsel başarıyla silindi."
    });

  } catch (error) {
    return Response.json({
      success: false,
      error: error.message || "Silme işlemi başarısız."
    }, { status: 500 });
  }
}
