import Link from 'next/link';

export default function Navbar() {
  return (
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
  );
}