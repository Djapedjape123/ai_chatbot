const steps = [
  {
    title: 'Ubacite dokumente',
    text: 'Otpremite PDF sa zakonima, presudama ili ugovorima. Svaki advokat vidi samo dokumente koje je sam ubacio.',
  },
  {
    title: 'Postavite pitanje',
    text: 'Pitajte običnim jezikom, kao kolegu. Asistent pretražuje vaše dokumente i odgovara na srpskom.',
  },
  {
    title: 'Proverite izvor',
    text: 'Odgovor navodi iz kog je dokumenta preuzet. Ako podatka nema u vašim dokumentima, asistent to izričito kaže.',
  },
];

export default function HowItWorks() {
  return (
    <section aria-labelledby="kako-funkcionise" className="border-t border-rule">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <h2 id="kako-funkcionise" className="font-display text-3xl tracking-tight sm:text-4xl">
          Kako funkcioniše
        </h2>

        <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-0">
          {steps.map((step, i) => (
            <li key={step.title} className="md:border-l md:border-rule md:px-8 md:first:border-l-0 md:first:pl-0">
              <span aria-hidden className="font-display text-5xl font-light text-ink-soft">
                {i + 1}
              </span>
              <h3 className="mt-3 text-lg font-medium">{step.title}</h3>
              <p className="mt-2 max-w-[28rem] leading-relaxed text-ink-soft">{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
