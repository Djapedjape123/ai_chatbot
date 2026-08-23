import Link from 'next/link';

export default function Hero() {
  return (
    <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20 md:py-32 max-w-5xl mx-auto">
      {/* Značka / Bedž */}
      <div className="mb-6 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#16263D]/20 bg-white text-xs font-semibold text-[#16263D]">
        <span className="flex h-2 w-2 rounded-full bg-green-500"></span>
        Dizajnirano isključivo za pravnike
      </div>

      <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight mb-6">
        Pretražujte i analizirajte <br className="hidden md:block"/> vašu dokumentaciju brže.
      </h1>
      
      <p className="text-lg md:text-xl text-[#16263D]/70 max-w-2xl mb-10 leading-relaxed">
        Zaboravite na sate provedene u pretraživanju zakona i predmeta. 
        Ubacite PDF, postavite pitanje i dobijte tačan odgovor zasnovan isključivo na vašim dokumentima.
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-4 w-full justify-center">
        <Link 
          href="/register" 
          className="w-full sm:w-auto px-8 py-4 rounded-md bg-[#16263D] text-[#F7F3EC] text-lg font-medium hover:bg-[#16263D]/90 transition shadow-lg shadow-[#16263D]/10"
        >
          Isprobaj odmah
        </Link>
        <Link 
          href="/login" 
          className="w-full sm:w-auto px-8 py-4 rounded-md bg-white border border-[#16263D]/20 text-lg font-medium hover:bg-gray-50 transition"
        >
          Imam nalog
        </Link>
      </div>
    </section>
  );
}