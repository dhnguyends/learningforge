import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell, SignInForm } from "@/components/shared/auth-form";

export const metadata: Metadata = { title: "Sign in — LearningForge" };

export default function SignInPage() {
  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Your study sets are waiting."
      footer={
        <>
          New here?{" "}
          <Link href="/auth/sign-up" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <SignInForm />
    </AuthShell>
  );
}
