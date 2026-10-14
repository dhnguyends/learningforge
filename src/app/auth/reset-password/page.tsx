import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell, ResetRequestForm } from "@/components/shared/auth-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll send a reset link if an account exists for that email."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/auth/sign-in" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </>
      }
    >
      <ResetRequestForm />
    </AuthShell>
  );
}
