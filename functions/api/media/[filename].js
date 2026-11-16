const MIME_BY_EXTENSION = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif"
};

function response(message, status, headers = {}) {
  return new Response(message, { status, headers });
}

function detectImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 6) {
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  return null;
}

export async function onRequestGet({ params, env }) {
  const filename = String(params.filename || "");
  const match = filename.match(/^([a-f0-9-]{36})\.(jpg|png|webp|gif)$/i);
  if (!match) return response("Geçersiz görsel adresi.", 400);

  const token = env.GITHUB_TOKEN;
  const mediaBranch = env.MEDIA_GITHUB_BRANCH || "main";
  const repo = env.GITHUB_REPO;
  if (!token || !repo) return response("Görsel deposu yapılandırılmamış.", 500);

  try {
    const requestImage = async branch => fetch(
      "https://api.github.com/repos/" + repo + "/contents/media/" + filename + "?ref=" + encodeURIComponent(branch),
      {
        headers: {
          "Authorization": "Bearer " + token,
          "Accept": "application/vnd.github.raw",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "EDWISE-CMS"
        }
      }
    );

    // Eski medya dosyaları main dalında duruyorsa Preview'da da salt okunur sun.
    let upstream = await requestImage(mediaBranch);
    if (upstream.status === 404 && mediaBranch !== "main") {
      upstream = await requestImage("main");
    }

    if (!upstream.ok) {
      return response("Görsel deposundan dosya alınamadı.", upstream.status === 404 ? 404 : 502);
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const actualType = detectImageType(bytes);
    const expectedType = MIME_BY_EXTENSION[match[2].toLowerCase()];

    if (!actualType || actualType !== expectedType) {
      return response("Dosya içeriği geçerli bir görsel değil veya uzantısıyla eşleşmiyor.", 415);
    }

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": actualType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline; filename=\"" + filename + "\""
      }
    });
  } catch (error) {
    return response("Görsel sunulamadı.", 502);
  }
}