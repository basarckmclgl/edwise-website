export async function onRequestGet({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ success: false }, { status: 403 });
  }

  return Response.json(
    {
      success: true,
      tokenConfigured: typeof env.ADMIN_BOOTSTRAP_TOKEN === "string" && env.ADMIN_BOOTSTRAP_TOKEN.length > 0,
      databaseConfigured: Boolean(env.DB),
      runtime: "pages-functions"
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json"
      }
    }
  );
}
