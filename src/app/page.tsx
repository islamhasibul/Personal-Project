import { AppShell } from "@/components/app-shell";

/**
 * Landing route for Phase 1.
 *
 * Once authentication lands (Phase 3) this page becomes a redirect:
 * signed-in users go to /dashboard, everyone else to /login.
 */
export default function Home() {
  return (
    <AppShell>
      <div className="flex flex-col items-start gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          DevDesk
        </h1>
        <p className="text-sm text-muted">
          A clean issue tracker for individual developers.
        </p>
      </div>
    </AppShell>
  );
}
