export default function FeatureHighlights() {
  const features = [
    {
      icon: '🔍',
      title: 'Vektorska Pretraga Baze',
      description: 'AI ne pretrazuje samo ključne reči, već razume duboki pravni smisao vaših PDF dokumenata i zakona.'
    },
    {
      icon: '📄',
      title: 'Čitanje i Prepravka Worda',
      description: 'Prikačite radnu verziju ugovora (.docx), zatražite izmene i dobićete prepravljen tekst spreman za rad.'
    },
    {
      icon: '📝',
      title: 'Izvoz u Formatiran .docx',
      description: 'Jednim klikom preuzmite gotov zapisnik ili pravni akt sa definisanim marginama i Times New Roman fontom.'
    },
    {
      icon: '⚡',
      title: 'Brzi Pravni Šabloni',
      description: 'Nemate vremena za kucanje? Jednim klikom pokrenite analizu rizika, izradu ugovora ili sažetak za klijenta.'
    }
  ];

  return (
    <section className="py-20 px-6 bg-[#F7F3EC] border-t border-[#16263D]/10">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-4">
          Sve što je potrebno jednoj kancelariji
        </h2>
        <p className="text-center text-[#16263D]/60 mb-16 max-w-xl mx-auto">
          Automatizujte rutinske zadatke i posvetite vreme onome što je zaista važno — vašim klijentima.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((f, i) => (
            <div key={i} className="p-6 bg-white rounded-xl border border-[#16263D]/10 shadow-sm hover:shadow-md transition">
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="text-xl font-semibold mb-2">{f.title}</h3>
              <p className="text-[#16263D]/70 text-sm leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}