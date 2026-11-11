
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
        description,
        image_url,
        content,
        sort_order
      FROM services
      WHERE status = ?
      ORDER BY sort_order ASC, created_at DESC`
    )
      .bind("published")
      .all();

    return json({
      success: true,
      services: results || []
    });

  } catch (error) {
    console.error("Public services API error:", error);

    return json({
      success: false,
      message: "Hizmetler şu anda alınamıyor."
    }, 500);
  }
}
