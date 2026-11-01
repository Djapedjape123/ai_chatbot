import Link from 'next/link';

export default function Navbar() {
  return (
    <header className="border-b border-rule">
      <nav
        aria-label="Glavni meni"
        className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8"
      >
        <Link href="/" className="link-focus font-display text-xl tracking-tight">
          Pravni Asistent<span className="text-ink-soft">.ai</span>
        </Link>
        <Link
          href="/login"
          className="link-focus rounded-md border border-ink px-4 py-2 text-sm font-medium transition-colors hover:bg-ink hover:text-paper"
        >
          Prijavi se
        </Link>
      </nav>
    </header>
  );
}
