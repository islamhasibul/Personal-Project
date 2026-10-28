"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that asks for confirmation before the form is submitted.
 *
 * The confirmation uses the native `window.confirm`, so it works without
 * any client-side dialog plumbing. `message` should name the thing being
 * deleted so the prompt is unambiguous.
 */
export function ConfirmSubmitButton({
  message,
  pendingLabel,
  className,
  children,
}: {
  message: string;
  pendingLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      onClick={(event) => {
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
    >
      {pending ? (pendingLabel ?? "Working...") : children}
    </button>
  );
}
