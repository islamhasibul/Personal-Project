import Link from "next/link";

/**
 * Top navigation shell for the signed-in area of the app.
 *
 * Phase 1 placeholder: the Logout control is a real-looking button but is
 * not wired to Supabase Auth yet. Phase 3 replaces it with a server action.
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
            href="/"
            className="text-base font-semibold tracking-tight text-foreground"
          >
            DevDesk
          </Link>
          <div className="flex items-center gap-4 text-sm text-muted">
            <Link href="/" className="hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/projects" className="hover:text-foreground">
              Projects
            </Link>
          </div>
          <div className="ml-auto flex items-center gap-4 text-sm">
            {userEmail ? (
              <span className="text-muted">{userEmail}</span>
            ) : null}
            <span className="rounded-md border border-border px-3 py-1.5 text-muted">
              Log out
            </span>
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
