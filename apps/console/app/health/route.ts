export const dynamic = "force-static";

export function GET() {
  return Response.json(
    {
      status: "ok",
      service: "lcp-console",
      scope: "static-edge",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
