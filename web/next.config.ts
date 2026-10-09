import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The site reads ../contracts and ../data at runtime; tell Next the repo root so file tracing finds them.
  outputFileTracingRoot: path.join(__dirname, ".."),
  poweredByHeader: false,
};

export default nextConfig;
