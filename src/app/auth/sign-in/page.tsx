import type { Metadata } from "next";
import { AuthShell, SignInForm } from "@/components/shared/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Your study sets are waiting."
      footer={<>Accounts are created by an administrator — ask yours if you need one.</>}
    >
      <SignInForm />
    </AuthShell>
  );
}
