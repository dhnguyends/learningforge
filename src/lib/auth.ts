import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

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
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const user = await prisma.user.findUnique({ where: { email: credentials.email.toLowerCase() } });
        if (!user?.passwordHash) return null;
        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
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
