import Navbar from '@/app/components/Navbar';
import Hero from '@/app/components/Hero';
import HowItWorks from '@/app/components/HowItWorks';
import TrustSection from '@/app/components/TrustSection';
import FeatureHighlights from '@/app/components/FeatureHighlights';
import FaqSection from '@/app/components/FaqSection';
import ClosingCta from '@/app/components/ClosingCta';
import Footer from '@/app/components/Footer';
import { body, display } from '@/app/landing-fonts';

export default function LandingPage() {
  return (
    <div
      className={`${display.variable} ${body.variable} flex min-h-screen flex-col bg-paper font-body text-ink selection:bg-ink selection:text-paper`}
    >
      <a
        href="#sadrzaj"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Preskoči na sadržaj
      </a>
      <Navbar />
      <main id="sadrzaj" className="flex flex-1 flex-col">
        <Hero />
        <HowItWorks />
        <TrustSection />
        <FeatureHighlights />
        <FaqSection />
        <ClosingCta />
      </main>
      <Footer />
    </div>
  );
}
