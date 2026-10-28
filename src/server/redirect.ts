/**
 * Redirect target validation.
 *
 * A server action that redirects to a path supplied by the browser must
 * check where that path points. `//evil.example` and `https://evil.example`
 * are both "absolute" from the browser's point of view, so a naive
 * `startsWith("/")` check would let an attacker turn the app into an open
 * redirect.
 *
 * The rules below are deliberately strict: the target has to be a path that
 * starts with a single slash and is not followed by a second slash or a
 * backslash (Windows-style `/\` is treated as `//` by some browsers).
 */

/**
 * Returns `value` when it is a safe same-origin relative path, or `null`
 * when it is not.
 *
 * Safe means: it starts with exactly one "/" and the character after it is
 * neither another "/" nor a "\".
 */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.startsWith("/\\")) return null;
  return value;
}

/**
 * Picks the redirect target for a form submission.
 *
 * `candidate` is the path the form asked to return to; `fallback` is where
 * to go when it is missing or unsafe. The fallback is always used for an
 * unsafe value, so a bad `returnTo` can never send the user off-site.
 */
export function resolveRedirectTarget(
  candidate: string | null | undefined,
  fallback: string,
): string {
  return safeInternalPath(candidate) ?? fallback;
}
