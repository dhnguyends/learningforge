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
    ];
  },
};

export default nextConfig;
