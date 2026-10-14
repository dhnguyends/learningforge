import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell, SignUpForm } from "@/components/shared/auth-form";

export const metadata: Metadata = { title: "Create account — LearningForge" };

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Turn your own course material into study resources you can trust."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/auth/sign-in" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
