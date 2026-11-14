export const dynamic = "force-static";

export function GET() {
  return Response.json({
    application: "lcp-console",
    source_revision: process.env.NEXT_PUBLIC_BUILD_SHA ?? "unknown",
    working_tree_dirty: process.env.NEXT_PUBLIC_BUILD_DIRTY === "true"
      ? true
      : process.env.NEXT_PUBLIC_BUILD_DIRTY === "false"
        ? false
        : null,
  });
}
