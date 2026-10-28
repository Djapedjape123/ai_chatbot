import Link from 'next/link';
import { requireAdminPage } from '@/lib/admin-page';
import AdminNav from './AdminNav';

// Namerno NEMA `export const metadata` (ni u stranicama panela): Next razrešava metadata i kad layout baci notFound(),
// pa bi naslov taba ("Admin panel") otkrio advokatu koji otvori /admin da panel postoji. Naslov je opšti naslov aplikacije.

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Prva linija odbrane pri ulasku u panel. Layout se ne izvršava ponovo pri navigaciji unutar panela,
  // pa isti poziv postoji i u svakoj stranici (lib/admin-page.ts).
  await requireAdminPage('/admin');

  return (
    <div className="min-h-screen bg-[#F7F3EC]">
      <header className="border-b border-[#16263D]/10 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-lg font-semibold text-[#16263D]">Admin panel</span>
            <AdminNav />
          </div>
          <Link
            href="/chat"
            className="shrink-0 text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded px-3 py-1.5 transition"
          >
            Nazad na Chat
          </Link>
        </div>
      </header>
      <main className="max-w-5xl mx-auto p-6 md:p-10">{children}</main>
    </div>
  );
}
