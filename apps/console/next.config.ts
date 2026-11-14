import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";

function gitValue(...args: string[]): string | undefined {
  try {
    const value = execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value;
  } catch {
    return undefined;
  }
}

const gitRevision = gitValue("rev-parse", "--verify", "HEAD") || undefined;

const sourceRevision = [
  process.env.CF_PAGES_COMMIT_SHA,
  process.env.GITHUB_SHA,
  process.env.NEXT_PUBLIC_BUILD_SHA,
].find((value) => value && /^[0-9a-f]{7,40}$/i.test(value))
  ?? gitRevision
  ?? "unknown";

const gitStatus = gitValue("status", "--porcelain", "--untracked-files=normal");
const workingTreeDirty = gitStatus === undefined ? "unknown" : String(gitStatus.length > 0);

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  transpilePackages: ["@lcp/sdk"],
  env: {
    NEXT_PUBLIC_BUILD_SHA: sourceRevision,
    NEXT_PUBLIC_BUILD_DIRTY: workingTreeDirty,
  },
};

export default nextConfig;
