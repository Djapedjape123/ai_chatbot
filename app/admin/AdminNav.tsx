'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Stranice panela. Nove (Aktivnost, Podešavanja) se dodaju ovde kad budu napravljene (2.5.7 i 2.5.8),
// da navigacija nikad ne vodi na stranicu koja ne postoji.
const ITEMS = [
  { href: '/admin', label: 'Pregled' },
  { href: '/admin/users', label: 'Advokati' },
];

// Klijentska komponenta jer layout ne vidi trenutnu putanju (ne izvršava se ponovo pri navigaciji).
export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin panel" className="flex flex-wrap items-center gap-2">
      {ITEMS.map((item) => {
        const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`text-sm rounded-full border px-3 py-1 transition ${
              active
                ? 'bg-[#16263D] text-[#F7F3EC] border-[#16263D]'
                : 'bg-white text-[#16263D]/70 border-[#16263D]/15 hover:bg-[#16263D]/5'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
