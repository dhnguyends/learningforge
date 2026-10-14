import type { DefaultSession } from "next-auth";

export type AppUserRole = "USER" | "ADMIN";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AppUserRole;
    } & DefaultSession["user"];
  }
  interface User {
    role?: AppUserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppUserRole;
  }
}
