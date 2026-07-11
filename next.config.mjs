import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this project (a sibling portfolio project shares
  // the parent folder and its own lockfile, which otherwise confuses Next).
  outputFileTracingRoot: __dirname,
  // The app is fully client-side (offline-first). This lets it be exported as a
  // static bundle for GitHub Pages / any static host if desired.
  // output: "export",  // enable when deploying to a static host
};

export default nextConfig;
