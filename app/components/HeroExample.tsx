// Prikaz izgleda odgovora. Sadržaj je izmišljen i tako je označen. Format (naziv izvora u zagradi na kraju
// citiranog pasusa) je onaj koji lib/prompts.ts traži od modela.
export default function HeroExample() {
  return (
    <figure className="m-0 border border-rule bg-sheet" aria-label="Primer pitanja i odgovora">
      <figcaption className="flex items-baseline justify-between gap-4 border-b border-rule px-5 py-3 text-sm text-ink-soft">
        <span>Primer upita</span>
        <span>Izmišljen dokument</span>
      </figcaption>

      <div className="space-y-6 px-5 py-6 sm:px-7 sm:py-8">
        <p className="ml-auto w-fit max-w-[88%] rounded-lg bg-ink px-4 py-3 text-base leading-relaxed text-paper">
          Koji je otkazni rok u ugovoru o zakupu?
        </p>

        <p className="font-display text-xl leading-relaxed sm:text-[1.375rem] sm:leading-[1.6]">
          Zakupac može da raskine ugovor pisanim otkazom, uz{' '}
          <mark className="marker">otkazni rok od 60 dana</mark> od dana prijema.{' '}
          <span className="whitespace-nowrap text-ink-soft">(Ugovor_o_zakupu.pdf)</span>
        </p>
      </div>
    </figure>
  );
}
