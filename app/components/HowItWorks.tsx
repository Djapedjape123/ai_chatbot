export default function HowItWorks() {
  return (
    <section className="bg-white border-t border-[#16263D]/10 py-20 px-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-16">
          Kako funkcioniše?
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 text-center">
          {/* Korak 1 */}
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-[#F7F3EC] flex items-center justify-center text-3xl mb-6 border border-[#16263D]/10">
              📄
            </div>
            <h3 className="text-xl font-semibold mb-3">1. Ubacite literaturu</h3>
            <p className="text-[#16263D]/60 leading-relaxed">
              Otpremite vaše PDF fajlove sa zakonima, presudama ili ugovorima u bezbedno okruženje.
            </p>
          </div>

          {/* Korak 2 */}
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-[#F7F3EC] flex items-center justify-center text-3xl mb-6 border border-[#16263D]/10">
              💬
            </div>
            <h3 className="text-xl font-semibold mb-3">2. Postavite pitanje</h3>
            <p className="text-[#16263D]/60 leading-relaxed">
              Pitajte asistenta na prirodnom jeziku sve što vas zanima u vezi sa vašim slučajem.
            </p>
          </div>

          {/* Korak 3 */}
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-[#F7F3EC] flex items-center justify-center text-3xl mb-6 border border-[#16263D]/10">
              ⚡
            </div>
            <h3 className="text-xl font-semibold mb-3">3. Dobijte odgovor</h3>
            <p className="text-[#16263D]/60 leading-relaxed">
              Dobijte precizan odgovor generisan ISKLJUČIVO na osnovu literature koju ste vi ubacili.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}