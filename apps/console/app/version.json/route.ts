export const dynamic = "force-static";

export function GET() {
  return Response.json({
    application: "lcp-console",
    source_revision: process.env.NEXT_PUBLIC_BUILD_SHA ?? "unknown",
  });
}
