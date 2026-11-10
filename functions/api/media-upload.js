
import { requireAdmin } from "./_auth.js";

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (auth instanceof Response) return auth;

  const token = context.env.GITHUB_TOKEN;
  const repo = context.env.GITHUB_REPO || "basarckmclgl/edwise-website";

  if (!token) {
    return Response.json(
      { error: "GitHub bağlantısı henüz yapılandırılmadı." },
      { status: 500 }
    );
  }

  try {
    const form = await context.request.formData();
    const file = form.get("file");

    if (!(file instanceof File) || !file.size) {
      return Response.json(
        { error: "Yüklenecek dosya bulunamadı." },
        { status: 400 }
      );
    }

    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif"
    ];

    if (!allowed.includes(file.type)) {
      return Response.json(
        { error: "Sadece JPG, PNG, WEBP ve GIF yüklenebilir." },
        { status: 400 }
      );
    }

    if (file.size > 5 * 1024 * 1024) {
      return Response.json(
        { error: "Dosya boyutu en fazla 5 MB olabilir." },
        { status: 400 }
      );
    }

    const extension = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif"
    }[file.type];

    const filename = `${crypto.randomUUID()}.${extension}`;
    const path = `media/${filename}`;

    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    const response = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: `CMS görseli eklendi: ${filename}`,
          content: btoa(binary),
          branch: "main"
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return Response.json(
        { error: result.message || "GitHub yükleme işlemi başarısız." },
        { status: response.status }
      );
    }

    return Response.json({
      success: true,
      filename,
      url: `https://raw.githubusercontent.com/${repo}/main/${path}`
    });

  } catch (error) {
    return Response.json(
      { error: "Yükleme sırasında bir hata oluştu." },
      { status: 500 }
    );
  }
}
