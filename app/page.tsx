import Link from 'next/link';
import Image from 'next/image';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#F7F3EC] text-[#16263D] flex flex-col font-sans selection:bg-[#16263D] selection:text-[#F7F3EC]">
      
      {/* --- NAVBAR --- */}
      <nav className="w-full flex items-center justify-between px-6 py-5 md:px-12 border-b border-[#16263D]/10">
        <div className="text-xl font-bold tracking-tight">
          Pravni Asistent<span className="text-[#16263D]/50">.ai</span>
        </div>
        <div className="flex items-center gap-4">
          <Link 
            href="/login" 
            className="text-sm font-medium hover:opacity-70 transition hidden sm:block"
          >
            Prijavi se
          </Link>
          <Link 
            href="/register" 
            className="text-sm font-medium bg-[#16263D] text-[#F7F3EC] px-4 py-2 rounded-md hover:bg-[#16263D]/90 transition"
          >
            Započni besplatno
          </Link>
        </div>
      </nav>

      {/* --- HERO SECTIONS --- */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20 md:py-32 max-w-5xl mx-auto">
        
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
      </main>

      {/* --- HOW IT WORKS (Features) --- */}
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

      {/* --- FOOTER --- */}
      <footer className="w-full text-center py-8 text-sm text-[#16263D]/40">
        &copy; {new Date().getFullYear()} Pravni Asistent. Sva prava zadržana.
      </footer>
    </div>
  );
}