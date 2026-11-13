// Apply baseline browser security headers to static pages and API responses.
export async function onRequest(context) {
  const response = await context.next();
  const headers = new Headers(response.headers);

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");

  if (new URL(context.request.url).pathname.startsWith("/api/")) {
    headers.set("Cache-Control", "no-store, max-age=0");
    headers.set("Pragma", "no-cache");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
