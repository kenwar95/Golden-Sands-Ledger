export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      try {
        const result = await env.DB.prepare("SELECT 1 AS ok").first();

        return Response.json({
          worker: true,
          database: result?.ok === 1
        });
      } catch (error) {
        return Response.json(
          {
            worker: true,
            database: false,
            error: error?.message || "D1 query failed"
          },
          { status: 500 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
