/**
 * Supabase connection settings, read from the environment.
 *
 * Only the project URL and the anon / publishable key live here. There is
 * deliberately no service-role key in this project: every query runs as the
 * signed-in user, and Row Level Security is the enforcement point.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * True when both required variables are present and non-empty.
 *
 * The app shell renders fine without them; only the auth and data features
 * need real values, so the UI can degrade to a clear "not configured" screen
 * instead of throwing during render.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

/**
 * The project URL and anon key, or null when they are not configured.
 *
 * `createServerClient` and `createBrowserClient` both throw a helpful error
 * when handed an empty URL or key, so callers check this first and render a
 * configuration notice instead of crashing.
 */
export function getSupabaseConfig(): { url: string; anonKey: string } | null {
  if (!url || !anonKey) return null;
  return { url, anonKey };
}
