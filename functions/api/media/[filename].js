const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function response(message, status, headers = {}) {
  return new Response(message, { status, headers });
}

export async function onRequestGet({ params, env }) {
  const filename = String(params.filename || "");
  if (!/^[a-f0-9-]{36}\.(jpg|png|webp|gif)$/i.test(filename)) {
    return response("Geçersiz görsel adresi.", 400);
  }

  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPO;
  if (!token || !repo) return response("Görsel deposu yapılandırılmamış.", 500);

  try {
    const upstream = await fetch(
      "https://api.github.com/repos/" + repo + "/contents/media/" + filename + "?ref=main",
      {
        headers: {
          "Authorization": "Bearer " + token,
          "Accept": "application/vnd.github.raw",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "EDWISE-CMS"
        }
      }
    );

    if (!upstream.ok) {
      return response("Görsel bulunamadı.", upstream.status === 404 ? 404 : 502);
    }

    const type = upstream.headers.get("Content-Type") || "";
    const allowed = [...IMAGE_TYPES].some(t => type.toLowerCase().includes(t));
    if (!allowed) return response("Geçersiz görsel türü.", 415);

    return new Response(await upstream.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline; filename=\"" + filename + "\""
      }
    });
  } catch (error) {
    return response("Görsel sunulamadı.", 502);
  }
}