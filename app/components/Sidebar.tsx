'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

type Chat = { id: string; title: string; created_at: string };

interface SidebarProps {
  chats: Chat[];
  activeChatId: string | null;
  onNewChat: () => void;
  onOpenChat: (id: string) => void;
  onOpenPdfModal: () => void;
  onDeleteChat: (id: string) => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({
  chats,
  activeChatId,
  onNewChat,
  onOpenChat,
  onOpenPdfModal,
  onDeleteChat,
  isOpen = false,
  onClose
}: SidebarProps) {
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  return (
    <aside 
      className={`
        fixed inset-y-0 left-0 z-40 w-72 md:w-64 bg-[#16263D] text-[#F7F3EC] flex flex-col p-4
        transform transition-transform duration-300 ease-in-out
        md:relative md:translate-x-0
        ${isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}
      `}
    >
      {/* HEADER SIDEBARA ZA MOBILNI (Dugme Zatvori) */}
      <div className="md:hidden flex justify-between items-center mb-6 px-1">
        <span className="font-semibold text-lg">Meni</span>
        <button 
          onClick={onClose} 
          className="p-1.5 text-[#F7F3EC]/60 hover:text-white hover:bg-white/10 rounded-md transition"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <button
        onClick={onNewChat}
        className="mb-3 rounded-md border border-[#F7F3EC]/30 px-3 py-2.5 text-sm hover:bg-[#F7F3EC]/10 transition text-center font-medium"
      >
        + Novi razgovor
      </button>

      <button
        onClick={onOpenPdfModal}
        className="mb-3 rounded-md border border-dashed border-[#F7F3EC]/30 px-3 py-2.5 text-sm hover:bg-[#F7F3EC]/10 transition flex items-center justify-center gap-2"
      >
        📄 Dodaj PDF literaturu
      </button>

      <Link
        href="/documents"
        onClick={onClose}
        className="mb-6 rounded-md border border-dashed border-[#F7F3EC]/30 px-3 py-2.5 text-sm hover:bg-[#F7F3EC]/10 transition flex items-center justify-center gap-2 text-center"
      >
        📚 Vaši dokumenti
      </Link>

      <div className="text-xs text-[#F7F3EC]/50 uppercase tracking-wider mb-2 px-1">Istorija</div>
      
      <div className="flex-1 overflow-y-auto space-y-1.5 -mx-2 px-2">
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`group flex items-center justify-between w-full rounded-md transition ${
              activeChatId === chat.id ? 'bg-[#F7F3EC]/15' : 'hover:bg-[#F7F3EC]/10'
            }`}
          >
            <button
              onClick={() => onOpenChat(chat.id)}
              className="flex-1 text-left px-3 py-2.5 text-sm truncate"
            >
              {chat.title}
            </button>
            <button
              onClick={() => onDeleteChat(chat.id)}
              className="px-3 py-2.5 text-[#F7F3EC]/40 hover:text-red-400 opacity-100 md:opacity-0 group-hover:opacity-100 transition"
              title="Obriši razgovor"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-[#F7F3EC]/10">
        <button
          onClick={handleLogout}
          className="w-full text-sm text-[#F7F3EC]/60 hover:text-[#F7F3EC] hover:bg-[#F7F3EC]/10 px-3 py-2.5 rounded-md transition text-left flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Odjavi se
        </button>
      </div>
    </aside>
  );
}