/**
 * Create the first administrator (self-registration is disabled), or promote
 * an existing account.
 *
 *   ADMIN_PASSWORD='…' npx tsx scripts/create-admin.ts admin@example.com "Ada Admin"
 *       creates the account as ADMIN (or promotes it and resets its password)
 *   npx tsx scripts/create-admin.ts existing@example.com
 *       promotes an existing account to ADMIN, password unchanged
 *
 * The password is read from ADMIN_PASSWORD (not argv) so it stays out of
 * shell history and process listings. Everything else is managed at /admin.
 */
import { prisma } from "@/lib/db";
import { hashPassword, ensureUserWorkspace } from "@/lib/auth";
import { audit } from "@/lib/audit";

async function main() {
  const [rawEmail, ...nameParts] = process.argv.slice(2);
  if (!rawEmail || !rawEmail.includes("@")) {
    throw new Error('usage: ADMIN_PASSWORD=… npx tsx scripts/create-admin.ts <email> ["Full name"]');
  }
  const email = rawEmail.trim().toLowerCase();
  const name = nameParts.join(" ").trim() || null;
  const password = process.env.ADMIN_PASSWORD;
  if (password !== undefined && (password.length < 10 || password.length > 256)) {
    throw new Error("ADMIN_PASSWORD must be 10–256 characters");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Only Human accounts can be Admin; a Bot is never promoted silently.
    if (existing.nature !== "HUMAN") {
      throw new Error(`${email} is a Bot account — change its nature to Human at /admin first, then promote it.`);
    }
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: "ADMIN", ...(name ? { name } : {}), ...(password ? { passwordHash: await hashPassword(password) } : {}) },
    });
    await audit({ userId: existing.id, action: "admin.bootstrap_promote", entityType: "user", entityId: existing.id });
    console.log(`Promoted ${email} to ADMIN${password ? " and reset its password" : ""}.`);
    return;
  }

  if (!password) throw new Error(`No account ${email} exists — set ADMIN_PASSWORD to create it.`);
  // The administrator this script bootstraps is the person running it — and only Humans can be Admin.
  const user = await prisma.user.create({ data: { email, name, role: "ADMIN", nature: "HUMAN", passwordHash: await hashPassword(password) } });
  await ensureUserWorkspace(user.id, user.name);
  await audit({ userId: user.id, action: "admin.bootstrap_create", entityType: "user", entityId: user.id });
  console.log(`Created administrator ${email}.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
