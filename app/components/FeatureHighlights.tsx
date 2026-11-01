const features = [
  {
    title: 'Pretraga po smislu',
    text: 'Asistent ne traži samo ključne reči. Razume o čemu pitate i pronalazi relevantne delove vaših dokumenata.',
  },
  {
    title: 'Prepravka Word dokumenata',
    text: 'Prikačite radnu verziju ugovora (.docx), zatražite izmene i dobijate prepravljen tekst spreman za rad.',
  },
  {
    title: 'Izvoz u Word',
    text: 'Jednim klikom preuzmite odgovor kao .docx sa pravničkim formatiranjem: definisane margine, Times New Roman, obostrano poravnanje.',
  },
  {
    title: 'Gotovi zadaci',
    text: 'Analiza rizika, izrada ugovora ili sažetak za klijenta pokreću se jednim klikom, bez kucanja uputstva.',
  },
];

export default function FeatureHighlights() {
  return (
    <section aria-labelledby="mogucnosti" className="border-t border-rule">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <h2 id="mogucnosti" className="font-display text-3xl tracking-tight sm:text-4xl">
          Rutinski poslovi, brže
        </h2>
        <p className="mt-4 max-w-[34rem] leading-relaxed text-ink-soft">
          Pretraga, prepravka i priprema akata na jednom mestu, da vreme ostane za klijente.
        </p>

        <ul className="mt-12 grid gap-x-16 gap-y-10 sm:grid-cols-2">
          {features.map((f) => (
            <li key={f.title} className="border-t border-ink pt-5">
              <h3 className="font-display text-2xl tracking-tight">{f.title}</h3>
              <p className="mt-2 max-w-[30rem] leading-relaxed text-ink-soft">{f.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
