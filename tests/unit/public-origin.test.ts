import { describe, it, expect } from "vitest";
import { publicOrigin } from "@/lib/api";

/**
 * Regression: under `next start`, req.url carries the server's bind address
 * (http://localhost:3000/...), not the address the browser used. Behind
 * packet.ai's port mapping (public :20002 → pod :3000) upload tickets pointed
 * at :3000 and every upload hung.
 */
const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe("publicOrigin", () => {
  it("uses APP_URL in production, ignoring req.url's bind address", () => {
    const r = req("http://localhost:3000/api/study-sets", { host: "50.35.188.68:20002" });
    expect(publicOrigin(r, { NODE_ENV: "production", APP_URL: "http://50.35.188.68:20002/" })).toBe("http://50.35.188.68:20002");
  });

  it("does not let a forged Host header redirect production uploads", () => {
    const r = req("http://localhost:3000/api/study-sets", { host: "attacker.example" });
    expect(publicOrigin(r, { NODE_ENV: "production", APP_URL: "https://lectureforge.example" })).toBe("https://lectureforge.example");
  });

  it("uses the browser's Host header in development", () => {
    const r = req("http://localhost:3000/api/study-sets", { host: "localhost:3001" });
    expect(publicOrigin(r, { NODE_ENV: "development", APP_URL: "http://localhost:3000" })).toBe("http://localhost:3001");
  });

  it("honours X-Forwarded-Host / -Proto from a proxy", () => {
    const r = req("http://localhost:3000/x", { host: "internal:3000", "x-forwarded-host": "app.example", "x-forwarded-proto": "https" });
    expect(publicOrigin(r, { NODE_ENV: "development", APP_URL: undefined })).toBe("https://app.example");
  });

  it("falls back to req.url when there is no Host header and no production APP_URL", () => {
    expect(publicOrigin(req("http://localhost:3001/x"), { NODE_ENV: "test", APP_URL: undefined })).toBe("http://localhost:3001");
  });
});
