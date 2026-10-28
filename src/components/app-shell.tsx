import Link from "next/link";

import { LogoutButton } from "@/components/logout-button";

/**
 * Top navigation shell for the signed-in area of the app.
 *
 * `userEmail` is rendered only when the caller has an authenticated user.
 * The Logout control is a real form posting to a server action, so signing
 * out clears the Supabase session cookies server-side.
 */
export function AppShell({
  children,
  userEmail,
}: {
  children: React.ReactNode;
  userEmail?: string;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border bg-surface">
        <nav className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-4">
          <Link
            href="/projects"
            className="text-base font-semibold tracking-tight text-foreground"
          >
            DevDesk
          </Link>
          <div className="flex items-center gap-4 text-sm text-muted">
            <Link href="/projects" className="hover:text-foreground">
              Projects
            </Link>
            <Link href="/issues" className="hover:text-foreground">
              Issues
            </Link>
          </div>
          <div className="ml-auto flex items-center gap-4 text-sm">
            {userEmail ? (
              <span className="hidden text-muted sm:inline">{userEmail}</span>
            ) : null}
            <LogoutButton />
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
