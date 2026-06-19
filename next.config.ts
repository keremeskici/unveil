import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  experimental: {
    viewTransition: true,
  },
  // Pin the workspace root so a stray lockfile in a parent dir isn't picked up.
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  // Native/binary packages used by the auto-blur server code must NOT be bundled
  // (the ffmpeg/ffprobe installers ship platform binaries + non-JS files the
  // bundler can't trace). Load them from node_modules at runtime instead.
  serverExternalPackages: [
    "sharp",
    "@ffmpeg-installer/ffmpeg",
    "@ffprobe-installer/ffprobe",
    "fluent-ffmpeg",
    "replicate",
    // Server-only data/storage clients — node-postgres ("pg") is node-only and
    // must never enter the client/browser graph; keeping both external stops
    // Turbopack from intermittently failing to resolve them into the page build.
    "pg",
    "@supabase/supabase-js",
  ],
  // sharp (libvips) and the ffmpeg/ffprobe installers load their native binaries
  // via dynamic requires the file tracer can't follow — force them into the
  // functions that composite (blur routes) and extract keyframes (posts upload).
  outputFileTracingIncludes: {
    "/api/blur/**": [
      "./node_modules/@img/**",
      "./node_modules/sharp/**",
      "./node_modules/@ffmpeg-installer/**",
      "./node_modules/@ffprobe-installer/**",
    ],
    "/api/posts": [
      "./node_modules/@ffmpeg-installer/**",
      "./node_modules/@ffprobe-installer/**",
    ],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
    ],
  },
};

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Disable the service worker in dev so Turbopack HMR isn't interfered with.
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist(nextConfig);
