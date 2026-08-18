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
}

export default function Sidebar({
  chats,
  activeChatId,
  onNewChat,
  onOpenChat,
  onOpenPdfModal,
  onDeleteChat,
}: SidebarProps) {
  const router = useRouter();
  const supabase = createClient();

 async function handleLogout() {
    // 1. Brišemo sesiju iz Supabase-a
    await supabase.auth.signOut();
    
    // 2. Radimo "Hard Redirect" koji ubija sav Next.js keš 
    // i sigurno nas vodi na početnu stranu
    window.location.href = '/';
  }

  return (
    <aside className="w-64 shrink-0 bg-[#16263D] text-[#F7F3EC] flex flex-col p-4 z-10">
      <button
        onClick={onNewChat}
        className="mb-2 rounded-md border border-[#F7F3EC]/30 px-3 py-2 text-sm hover:bg-[#F7F3EC]/10 transition text-center"
      >
        + Novi razgovor
      </button>

      <button
        onClick={onOpenPdfModal}
        className="mb-2 rounded-md border border-dashed border-[#F7F3EC]/30 px-3 py-2 text-sm hover:bg-[#F7F3EC]/10 transition flex items-center justify-center gap-2"
      >
        📄 Dodaj PDF literaturu
      </button>

      <Link
        href="/documents"
        className="mb-4 rounded-md border border-dashed border-[#F7F3EC]/30 px-3 py-2 text-sm hover:bg-[#F7F3EC]/10 transition flex items-center justify-center gap-2 text-center"
      >
        📚 Pogledaj Vaše dokumente
      </Link>

      <div className="flex-1 overflow-y-auto space-y-1 border-t border-[#F7F3EC]/10 pt-4">
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`group flex items-center justify-between w-full rounded-md transition ${
              activeChatId === chat.id ? 'bg-[#F7F3EC]/15' : 'hover:bg-[#F7F3EC]/10'
            }`}
          >
            <button
              onClick={() => onOpenChat(chat.id)}
              className="flex-1 text-left px-3 py-2 text-sm truncate"
            >
              {chat.title}
            </button>
            <button
              onClick={() => onDeleteChat(chat.id)}
              className="px-2 py-2 text-[#F7F3EC]/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
              title="Obriši razgovor"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={handleLogout}
        className="mt-4 pt-4 border-t border-[#F7F3EC]/10 text-sm text-[#F7F3EC]/60 hover:text-[#F7F3EC] transition text-left"
      >
        Odjavi se
      </button>
    </aside>
  );
}