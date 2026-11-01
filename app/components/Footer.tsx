export default function Footer() {
  return (
    <footer className="mt-auto bg-ink text-paper">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p>&copy; {new Date().getFullYear()} Pravni Asistent</p>
        <p className="text-paper/70">
          Razvio{' '}
          <a
            href="https://pedjadev.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-paper"
          >
            Predrag Radić
          </a>
        </p>
      </div>
    </footer>
  );
}
