import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="w-full bg-[#16263D] text-[#F7F3EC] py-12 px-6 mt-auto">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-center md:items-start gap-8">
        
        {/* Levi deo: O tebi */}
        <div className="text-center md:text-left max-w-sm">
          <h3 className="text-xl font-bold tracking-tight mb-2">Predrag Radić</h3>
          <p className="text-sm text-[#F7F3EC]/70 leading-relaxed">
            Freelance full-stack web developer. Posvećen kreiranju brzih, modernih i skalabilnih web aplikacija koje rešavaju stvarne probleme.
          </p>
        </div>

        {/* Desni deo: Linkovi i mreže */}
        <div className="flex flex-col items-center md:items-end gap-4">
          <p className="text-xs text-[#F7F3EC]/50 uppercase tracking-widest font-semibold">
            Povežimo se
          </p>
          <div className="flex items-center gap-5">
            {/* Portfolio */}
            <Link 
              href="https://pedjadev.com" 
              target="_blank"
              className="text-[#F7F3EC]/80 hover:text-white hover:-translate-y-0.5 transition-all duration-200"
              title="Moj Portfolio"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
            </Link>

            {/* LinkedIn */}
            <Link 
              href="https://www.linkedin.com/in/predrag-radic-dev/" // <-- UBACI SVOJ LINKEDIN LINK OVDE
              target="_blank"
              className="text-[#F7F3EC]/80 hover:text-white hover:-translate-y-0.5 transition-all duration-200"
              title="LinkedIn"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
            </Link>

            {/* Instagram */}
            <Link 
              href="https://www.instagram.com/prweb_/?next=%2F" // <-- UBACI SVOJ INSTAGRAM LINK OVDE
              target="_blank"
              className="text-[#F7F3EC]/80 hover:text-white hover:-translate-y-0.5 transition-all duration-200"
              title="Instagram"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5" strokeWidth={1.5}></rect>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"></path>
                <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" strokeWidth={2} strokeLinecap="round"></line>
              </svg>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto mt-12 pt-6 border-t border-[#F7F3EC]/10 text-center text-xs text-[#F7F3EC]/40">
        &copy; {new Date().getFullYear()} Pravni Asistent. Developed by Predrag Radić.
      </div>
    </footer>
  );
}