// Svaka stavka odgovara funkciji koja postoji u aplikaciji (RLS u bazi, pozivi iz admin panela, MFA, audit log).
// Ne dodavati tvrdnje koje nisu proverene (npr. o čuvanju podataka kod AI servisa).
const items = [
  {
    title: 'Svako vidi samo svoje',
    text: 'Zaštita je u samoj bazi podataka, ne samo u aplikaciji: advokat može da pročita isključivo svoje dokumente, razgovore i poruke. Administrator kancelarije vidi nazive i datume, ne i sadržaj.',
  },
  {
    title: 'Nalozi samo po pozivu',
    text: 'Javne registracije nema. Naloge otvara administrator kancelarije, a blokiran nalog odmah gubi pristup.',
  },
  {
    title: 'Dvostepena prijava',
    text: 'Uz lozinku se unosi kod iz aplikacije na telefonu. Obavezna je za administratore, a svaki advokat može da je uključi.',
  },
  {
    title: 'Zapisnik aktivnosti bez sadržaja',
    text: 'Beleži se ko je i kada otpremio ili obrisao dokument, postavio pitanje i iz kojih dokumenata je odgovor stigao. Tekst pitanja i odgovora ne ulazi u zapisnik, a zapisi se brišu posle 90 dana.',
  },
];

export default function TrustSection() {
  return (
    <section aria-labelledby="poverljivost" className="border-t border-rule">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-12 lg:gap-16 lg:px-8">
        <div className="lg:col-span-4">
          <h2 id="poverljivost" className="font-display text-3xl tracking-tight sm:text-4xl">
            Poverljivost spisa
          </h2>
          <p className="mt-4 max-w-[26rem] leading-relaxed text-ink-soft">
            Šta sistem radi da dokumente jednog advokata ne vidi niko drugi.
          </p>
        </div>

        <dl className="lg:col-span-8">
          {items.map((item) => (
            <div
              key={item.title}
              className="grid gap-2 border-t border-rule py-6 first:border-t-0 first:pt-0 sm:grid-cols-5 sm:gap-8 lg:first:pt-1"
            >
              <dt className="text-lg font-medium sm:col-span-2">{item.title}</dt>
              <dd className="leading-relaxed text-ink-soft sm:col-span-3">{item.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
