import Link from "next/link";

/** The header reads the visitor's session, so this route blocks rather than prerenders. */
export const instant = false;

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent">
        Not found
      </p>
      <h1 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight">
        That page isn&rsquo;t here.
      </h1>
      <p className="mx-auto mt-3 max-w-sm text-[13.5px] leading-relaxed text-muted">
        It may have moved, or the link was mistyped. Your plan is still where you
        left it.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-[44px] items-center rounded-xl bg-accent px-5 text-[14px] font-semibold text-black"
      >
        Back to my plan
      </Link>
    </div>
  );
}
