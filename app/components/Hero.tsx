import Link from 'next/link';
import HeroExample from '@/app/components/HeroExample';

export default function Hero() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8 lg:py-28">
      <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-6">
          <h1 className="font-display text-[2.75rem] leading-[1.05] tracking-[-0.02em] sm:text-6xl lg:text-[4rem]">
            <span className="block">Pitajte svoje spise.</span>
            <span className="block text-balance">Odgovor stiže sa izvorom.</span>
          </h1>

          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-ink-soft">
            Ubacite PDF sa zakonima, presudama ili ugovorima i postavite pitanje običnim jezikom. Asistent uz
            odgovor navodi dokument iz kog je preuzeo podatak, pa izvor možete da proverite.
          </p>

          <div className="mt-9 flex flex-col items-start gap-3">
            <Link href="/login" className="btn-primary w-full sm:w-auto">
              Prijavite se
            </Link>
            <p className="text-sm text-ink-soft">Nalog vam otvara administrator vaše kancelarije.</p>
          </div>
        </div>

        <div className="lg:col-span-6">
          <HeroExample />
        </div>
      </div>
    </section>
  );
}
