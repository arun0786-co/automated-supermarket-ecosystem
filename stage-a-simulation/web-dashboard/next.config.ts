import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // only for the docker image: "next start" doesn't work with standalone output
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
};

export default nextConfig;
