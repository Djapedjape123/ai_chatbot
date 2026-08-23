'use client';

import { useState } from 'react';

export default function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const faqs = [
    {
      q: 'Da li su moji dokumenti i ugovori bezbedni?',
      a: 'Apsolutno. Svi vaši dokumenti se enkriptuju i čuvaju u izolovanom okruženju. Vaši podaci se nikada ne koriste za treniranje javnih AI modela.'
    },
    {
      q: 'Da li AI može da izmisli nepostojeće zakone (halucinira)?',
      a: 'Naš sistem koristi RAG (Retrieval-Augmented Generation) tehnologiju. To znači da AI odgovara ISKLJUČIVO na osnovu dokumenata i zakona koje vi ubacite u vašu bazu.'
    },
    {
      q: 'U kom formatu dobijam generisane ugovore i akte?',
      a: 'Sve odgovore i generisane ugovore možete preuzeti u izvornom Word (.docx) formatu sa standardnim pravničkim formatiranjem (Times New Roman, 12pt, obostrano poravnanje).'
    },
    {
      q: 'Da li mogu da učitam skenirane papire ili samo PDF/Word?',
      a: 'Trenutno je podržan direktan rad sa tekstualnim PDF dokumentima i Microsoft Word (.docx) fajlovima.'
    }
  ];

  return (
    <section className="py-20 px-6 bg-white border-t border-[#16263D]/10">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
          Često postavljana pitanja
        </h2>

        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div key={i} className="border border-[#16263D]/10 rounded-lg overflow-hidden bg-[#F7F3EC]/30">
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full text-left p-5 flex justify-between items-center font-medium text-[#16263D]"
              >
                <span>{faq.q}</span>
                <span className="text-lg ml-2">{openIndex === i ? '−' : '+'}</span>
              </button>
              {openIndex === i && (
                <div className="p-5 pt-0 text-sm text-[#16263D]/70 leading-relaxed border-t border-[#16263D]/5 bg-white">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}