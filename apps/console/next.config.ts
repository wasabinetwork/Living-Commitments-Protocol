import type { NextConfig } from "next";

const sourceRevision = [
  process.env.CF_PAGES_COMMIT_SHA,
  process.env.GITHUB_SHA,
  process.env.NEXT_PUBLIC_BUILD_SHA,
].find((value) => value && /^[0-9a-f]{7,40}$/i.test(value)) ?? "unknown";

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  transpilePackages: ["@lcp/sdk"],
  env: {
    NEXT_PUBLIC_BUILD_SHA: sourceRevision,
  },
};

export default nextConfig;
