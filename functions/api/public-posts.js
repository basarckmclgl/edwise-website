
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestGet(context) {
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT
        id,
        title,
        slug,
        excerpt,
        content,
        image_url,
        published_at
      FROM posts
      WHERE status = ?
      ORDER BY published_at DESC, created_at DESC`
    )
      .bind("published")
      .all();

    return json({
      success: true,
      posts: results || []
    });

  } catch (error) {
    console.error("Public posts API error:", error);

    return json({
      success: false,
      message: "Blog yazıları şu anda alınamıyor."
    }, 500);
  }
}
