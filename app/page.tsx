import Navbar from '@/app/components/Navbar';
import Hero from '@/app/components/Hero';
import HowItWorks from '@/app/components/HowItWorks';
import FeatureHighlights from '@/app/components/FeatureHighlights';
import FaqSection from '@/app/components/FaqSection';


export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#F7F3EC] text-[#16263D] flex flex-col font-sans selection:bg-[#16263D] selection:text-[#F7F3EC]">
      <Navbar />
      <main className="flex-1 flex flex-col">
        <Hero />
        <HowItWorks />
        <FeatureHighlights />
        <FaqSection />
        
      </main>

      <footer className="w-full text-center py-8 text-sm text-[#16263D]/40 border-t border-[#16263D]/10 bg-white">
        &copy; {new Date().getFullYear()} Pravni Asistent. Sva prava zadržana.
      </footer>
    </div>
  );
}