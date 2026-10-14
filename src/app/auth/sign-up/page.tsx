import { redirect } from "next/navigation";

/** Self-registration is disabled — accounts are created by an administrator. */
export default function SignUpPage() {
  redirect("/auth/sign-in");
}
