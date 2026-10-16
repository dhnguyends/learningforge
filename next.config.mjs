/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep native/optional-dependency packages out of the bundler.
    serverComponentsExternalPackages: [
      "ffmpeg-static",
      "ffprobe-static",
      "fluent-ffmpeg",
      "pdfjs-dist",
      "@napi-rs/canvas",
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
  poweredByHeader: false,
  // Baseline security headers on every response. No HSTS here: deployments
  // on a bare IP use a private CA (see deploy/packet), where HSTS would turn a
  // bypassable certificate warning into a hard failure. Add it at the TLS
  // front once the site has a publicly trusted certificate.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        // Uploaded sources (PDF) are shown inside the app's own pages, which
        // DENY forbids. Same-origin framing only; /api/files serves an
        // allow-list of types (no HTML or SVG), so nothing it returns can script
        // the app. Later rules override the same header above.
        source: "/api/files/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
