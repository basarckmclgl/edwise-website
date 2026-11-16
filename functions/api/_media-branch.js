// Resolve media storage branch without allowing Preview writes to Production.
export function getMediaBranch(context) {
  const hostname = new URL(context.request.url).hostname.toLowerCase();
  const configured = String(context.env.MEDIA_GITHUB_BRANCH || "").trim();
  const isCloudflarePreview = hostname.endsWith(".pages.dev") && hostname !== "edwisedanismanlik.com";
  if (isCloudflarePreview) {
    if (!configured || configured === "main") {
      throw new Error("Preview medya deposu güvenli değil. MEDIA_GITHUB_BRANCH değeri yonetim-paneli olarak ayarlanmalı.");
    }
    return configured;
  }
  return configured || "main";
}
