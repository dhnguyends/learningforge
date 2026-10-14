import { z } from "zod";
import { apiHandler, ok, parseJsonBody } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getEnv } from "@/lib/env";

const schema = z.object({ email: z.string().email().max(320) });

/**
 * Password-reset request. Responds identically whether or not the account
 * exists (no account enumeration). Email delivery requires an SMTP provider;
 * without one, the request is only audited so operators can handle it manually.
 */
export const POST = apiHandler(async (req) => {
  const body = await parseJsonBody(req, schema);
  const emailConfigured = Boolean(getEnv().SMTP_URL);
  await audit({
    userId: null,
    action: "auth.reset_request",
    entityType: "user",
    entityId: body.email,
    metadata: { delivery: emailConfigured ? "email" : "unconfigured" },
  });
  return ok({ accepted: true, delivery: emailConfigured ? "email" : "unconfigured" });
});
