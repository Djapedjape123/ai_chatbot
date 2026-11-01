import Link from 'next/link';

export default function ClosingCta() {
  return (
    <section aria-labelledby="prijava" className="border-t border-rule">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 sm:py-24 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div>
          <h2 id="prijava" className="font-display text-3xl tracking-tight sm:text-4xl">
            Postavite prvo pitanje svojim spisima.
          </h2>
          <p className="mt-3 text-ink-soft">Nalog vam otvara administrator vaše kancelarije.</p>
        </div>
        <Link href="/login" className="btn-primary w-full shrink-0 sm:w-auto">
          Prijavite se
        </Link>
      </div>
    </section>
  );
}
