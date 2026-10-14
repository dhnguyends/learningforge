/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep native/optional-dependency packages out of the bundler.
    serverComponentsExternalPackages: [
      "ffmpeg-static",
      "ffprobe-static",
      "fluent-ffmpeg",
      "pdfjs-dist",
      "tesseract.js",
      "bullmq",
      "ioredis",
      "mammoth",
      "jszip",
      "@prisma/client",
    ],
  },
  eslint: {
    // ESLint runs via `npm run lint`; keep production builds fast.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
