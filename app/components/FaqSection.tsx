// Odgovori o bezbednosti i o AI servisima pišu samo ono što je proverljivo. Pre izmene uskladiti sa
// pregledom tokova podataka iz Faze 4 (docs/onboarding.md).
const faqs = [
  {
    q: 'Da li moji dokumenti napuštaju sistem?',
    a: 'Za pretragu i odgovor, delovi vaših dokumenata i pitanje šalju se AI servisima koji ih obrađuju (Claude kompanije Anthropic i Voyage AI). Pregled tokova podataka i uslova čuvanja dobijate pre potpisivanja ugovora.',
  },
  {
    q: 'Može li asistent da izmisli zakon ili presudu?',
    a: 'Svaki AI model može da pogreši, zato uz odgovor navodimo dokument iz kog je preuzet, da biste ga proverili. Kada podatka nema u vašim dokumentima, asistent to izričito kaže pre nego što odgovori iz opšteg znanja. Odgovor je pomoć u radu, a ne zamena za proveru pravnika.',
  },
  {
    q: 'Ko može da otvori nalog?',
    a: 'Samo administrator vaše kancelarije. Javne registracije nema, pa niko van kancelarije ne može sam da napravi nalog.',
  },
  {
    q: 'U kom formatu dobijam ugovore i akte?',
    a: 'Odgovore i generisane ugovore preuzimate kao Word (.docx) dokument sa standardnim pravničkim formatiranjem: Times New Roman, 12 pt, obostrano poravnanje.',
  },
  {
    q: 'Koje fajlove mogu da ubacim?',
    a: 'Tekstualne PDF dokumente i Microsoft Word (.docx) fajlove. Skenirani papiri koji nemaju tekst za sada nisu podržani.',
  },
];

export default function FaqSection() {
  return (
    <section aria-labelledby="pitanja" className="border-t border-rule">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-12 lg:gap-16 lg:px-8">
        <h2 id="pitanja" className="font-display text-3xl tracking-tight sm:text-4xl lg:col-span-4">
          Često postavljana pitanja
        </h2>

        <div className="border-b border-rule lg:col-span-8">
          {faqs.map((faq) => (
            <details key={faq.q} className="group border-t border-rule">
              <summary className="link-focus -mx-3 flex cursor-pointer list-none items-center justify-between gap-6 px-3 py-5 text-lg font-medium [&::-webkit-details-marker]:hidden">
                {faq.q}
                <svg
                  aria-hidden
                  viewBox="0 0 16 16"
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M2 8h12" />
                  <path
                    d="M8 2v12"
                    className="origin-center transition-transform [transform-box:fill-box] group-open:scale-y-0"
                  />
                </svg>
              </summary>
              <p className="max-w-[65ch] pb-6 pr-10 leading-relaxed text-ink-soft">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
