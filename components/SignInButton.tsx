/**
 * The sign-in entry point. A plain link, not a button: signing in is a
 * navigation to /api/auth/google, which redirects to Google's consent page.
 *
 * Deliberately both server-safe and client-safe (no hooks, no "use client",
 * nothing above React's primitives), so it can render inside server
 * components and client components alike, including layouts.
 */
export default function SignInButton({
  label = "Sign in with Google",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <a href="/api/auth/google" className={className}>
      {label}
    </a>
  );
}
