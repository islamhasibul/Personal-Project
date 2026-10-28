import type { Metadata } from "next";

import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = {
  title: "Create account · DevDesk",
};

export default function SignupPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <AuthForm mode="signup" />
    </main>
  );
}
