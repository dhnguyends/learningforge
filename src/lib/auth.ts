import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { clientIp, rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { effectiveRole } from "@/lib/admin";

/** Sign-in throttling: per account (primary) and per client IP (secondary). */
export const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
export const SIGN_IN_MAX_PER_ACCOUNT = 10;
export const SIGN_IN_MAX_PER_IP = 50;

export const authOptions: AuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: { signIn: "/auth/sign-in" },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials.password) return null;
        if (credentials.password.length > 1024) return null; // bcrypt reads 72 bytes; refuse huge bodies cheaply
        const email = credentials.email.toLowerCase();

        // Every attempt counts; a success clears the account bucket. Throwing
        // surfaces the message to the client as `error` (signIn redirect:false).
        const perAccount = rateLimit(`signin:account:${email}`, SIGN_IN_MAX_PER_ACCOUNT, SIGN_IN_WINDOW_MS);
        const perIp = rateLimit(`signin:ip:${clientIp(req?.headers)}`, SIGN_IN_MAX_PER_IP, SIGN_IN_WINDOW_MS);
        if (!perAccount.allowed || !perIp.allowed) {
          const wait = Math.ceil(Math.max(perAccount.retryAfterSec, perIp.retryAfterSec) / 60);
          throw new Error(`Too many sign-in attempts. Try again in ${wait} minute${wait === 1 ? "" : "s"}.`);
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;
        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;
        resetRateLimit(`signin:account:${email}`);
        await prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });
        return { id: user.id, email: user.email, name: user.name, image: user.image, role: effectiveRole(user.role, user.nature) };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role ?? "USER";
      } else if (token.sub) {
        // Re-read the role whenever the session is refreshed, so a promotion or
        // demotion at /admin takes effect without signing out and in again
        // (the middleware guards /admin with this token).
        const current = await prisma.user.findUnique({ where: { id: token.sub }, select: { role: true, nature: true } });
        token.role = current ? effectiveRole(current.role, current.nature) : "USER";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      // UI hint only (menu, page guard) — admin APIs re-check the role in the database.
      if (session.user) session.user.role = token.role ?? "USER";
      return session;
    },
  },
  secret: getEnv().NEXTAUTH_SECRET,
};

/** Every user gets a personal workspace on first use. */
export async function ensureUserWorkspace(userId: string, name?: string | null): Promise<string> {
  const existing = await prisma.workspaceMember.findFirst({
    where: { userId, role: "OWNER" },
    include: { workspace: true },
  });
  if (existing) return existing.workspaceId;
  const displayName = name?.split(" ")[0] || "My";
  const workspace = await prisma.workspace.create({
    data: {
      name: `${displayName} workspace`,
      ownerId: userId,
      members: { create: { userId, role: "OWNER" } },
    },
  });
  return workspace.id;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
