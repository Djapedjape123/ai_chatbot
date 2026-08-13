'use client';

import { useEffect, useRef, useState } from 'react';
import PdfUploader from '@/app/components/PdfUploader';
import Sidebar from '@/app/components/Sidebar';

type Message = { id?: string; role: 'user' | 'assistant'; content: string };
type Chat = { id: string; title: string; created_at: string };

export default function Home() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadChats();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadChats() {
    try {
      const res = await fetch('/api/chats');
      const data = await res.json();
      setChats(data.chats || []);
    } catch {
      showToast('Greška pri učitavanju razgovora.');
    }
  }

  async function openChat(chatId: string) {
    setActiveChatId(chatId);
    try {
      const res = await fetch(`/api/chats/${chatId}/messages`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {
      showToast('Greška pri učitavanju poruka.');
    }
  }

  function newChat() {
    setActiveChatId(null);
    setMessages([]);
  }

  async function deleteChat(chatId: string) {
    if (!confirm('Da li ste sigurni da želite da obrišete ovaj razgovor?')) return;

    try {
      const res = await fetch(`/api/chats/${chatId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Greška');

      if (activeChatId === chatId) {
        setActiveChatId(null);
        setMessages([]);
      }
      
      loadChats();
      showToast('Razgovor obrisan.');
    } catch {
      showToast('Greška pri brisanju razgovora.');
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  async function sendMessage(autoQuery?: string) {
    const query = autoQuery || input.trim();
    if (!query || loading) return;

    if (!autoQuery) {
      setInput('');
      setMessages((prev) => [...prev, { role: 'user', content: query }]);
    }

    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, chatId: activeChatId }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'Došlo je do greške.');
        return;
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: data.response }]);

      if (!activeChatId) {
        setActiveChatId(data.chatId);
        loadChats();
      }
    } catch {
      showToast('Greška pri povezivanju. Pokušajte ponovo.');
    } finally {
      setLoading(false);
    }
  }

  function handleUploadSuccess(fileName: string) {
    setIsPdfModalOpen(false); 
    newChat(); 
    
    const autoPrompt = `Upravo sam dodao pravni dokument pod nazivom "${fileName}". Molim te, pronađi ga i napravi mi kratak pregled onoga što on sadrži, koje su mu glavne teme i izvuci par najvažnijih teza, kako bismo mogli da započnemo rad na njemu.`;
    
    setTimeout(() => {
      sendMessage(autoPrompt);
    }, 200);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    showToast('Kopirano.');
  }

  return (
    <div className="flex h-screen relative">
      <Sidebar 
        chats={chats}
        activeChatId={activeChatId}
        onNewChat={newChat}
        onOpenChat={openChat}
        onOpenPdfModal={() => setIsPdfModalOpen(true)}
        onDeleteChat={deleteChat}
      />

      <main className="flex-1 flex flex-col z-0">
        <div className="flex-1 overflow-y-auto px-6 py-8 max-w-3xl mx-auto w-full">
          {messages.length === 0 && (
            <p className="text-[#16263D]/50 text-center mt-20">
              Postavi pravno pitanje da započneš razgovor.
            </p>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`mb-6 ${m.role === 'user' ? 'text-right' : ''}`}>
              <div
                className={`inline-block max-w-[85%] rounded-lg px-4 py-3 text-left leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[#16263D] text-[#F7F3EC]'
                    : 'bg-white border border-[#16263D]/10 shadow-sm'
                }`}
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
              {m.role === 'assistant' && (
                <div className="mt-1 text-left">
                  <button
                    onClick={() => copyText(m.content)}
                    className="text-xs text-[#16263D]/50 hover:text-[#16263D] transition"
                  >
                    Kopiraj tekst
                  </button>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="mb-6">
              <div className="inline-block rounded-lg px-4 py-3 bg-white border border-[#16263D]/10 shadow-sm">
                <span className="animate-pulse text-[#16263D]/50 text-sm">Pretražujem bazu i razmišljam…</span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="border-t border-[#16263D]/10 px-6 py-4 max-w-3xl mx-auto w-full">
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder="Postavi pitanje…"
              className="flex-1 resize-none rounded-md border border-[#16263D]/20 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#16263D]/30 bg-white shadow-sm"
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="rounded-md bg-[#16263D] text-[#F7F3EC] px-4 py-2 hover:bg-[#16263D]/90 disabled:opacity-50 transition h-[42px]"
            >
              Pošalji
            </button>
          </div>

          <p className="text-xs text-[#16263D]/40 text-center mt-2">
            AI može da pogreši — uvek proveri odgovor u originalnom izvoru.
          </p>
        </div>
      </main>

      {isPdfModalOpen && (
        <PdfUploader 
          onClose={() => setIsPdfModalOpen(false)} 
          onUploadSuccess={handleUploadSuccess} 
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-[#16263D] text-[#F7F3EC] px-4 py-3 rounded-md shadow-xl text-sm z-50">
          {toast}
        </div>
      )}
    </div>
  );
}