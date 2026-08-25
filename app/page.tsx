import Navbar from '@/app/components/Navbar';
import Hero from '@/app/components/Hero';
import HowItWorks from '@/app/components/HowItWorks';
import FeatureHighlights from '@/app/components/FeatureHighlights';
import FaqSection from '@/app/components/FaqSection';
import Footer from './components/Footer';


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

      <Footer/>
    </div>
  );
}