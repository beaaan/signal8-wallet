import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The site reads ../contracts and ../data at runtime; tell Next the repo root so file tracing finds them.
  outputFileTracingRoot: path.join(__dirname, ".."),
  // Those reads use paths built at runtime, which tracing cannot follow. List the files so hosts that ship only the
  // traced files (Vercel) still have them. Paths are relative to web/.
  outputFileTracingIncludes: {
    "/**": ["../contracts/deployments/*.json", "../data/fixtures/plans/*.json"],
  },
  poweredByHeader: false,
  devIndicators: false,
};

export default nextConfig;
