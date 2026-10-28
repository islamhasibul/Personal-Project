import type { Metadata } from "next";

import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = {
  title: "Sign in · DevDesk",
};

/**
 * Login page.
 *
 * The `next` parameter carries the page the user was trying to reach before
 * the proxy redirected them here.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <AuthForm mode="login" next={next} />
    </main>
  );
}
