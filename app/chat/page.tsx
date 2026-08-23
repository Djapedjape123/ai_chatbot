'use client';

import { useEffect, useRef, useState } from 'react';
import PdfUploader from '@/app/components/PdfUploader';
import Sidebar from '@/app/components/Sidebar';
import { exportSingleMessageToWord, exportFullChatToWord } from '@/lib/exportWord';
import * as mammoth from 'mammoth';

type Message = { id?: string; role: 'user' | 'assistant'; content: string };
type Chat = { id: string; title: string; created_at: string };

// 1. Definisani šabloni za brzi unos
const defaultTemplates = [
  { icon: '📝', text: 'Napiši primer ugovora o zajmu' },
  { icon: '⚖️', text: 'Objasni mi razliku između...' },
  { icon: '🔎', text: 'Koji zakon reguliše...' }
];

const fileTemplates = [
  { icon: '⚠️', text: 'Analiziraj pravne rizike u ovom tekstu' },
  { icon: '📌', text: 'Izvuci ključne obaveze ugovornih strana' },
  { icon: '📖', text: 'Napravi kratak sažetak za klijenta' }
];

export default function Home() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  
  const [attachedFileName, setAttachedFileName] = useState<string | null>(null);
  const [attachedFileText, setAttachedFileText] = useState<string | null>(null);
  
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 2. Referenca za polje za unos (kako bismo ga automatski fokusirali)
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    removeAttachment(); 
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

  async function handleFileAttachment(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.docx')) {
      showToast('Za sada je moguća direktna prepravka samo .docx fajlova.');
      return;
    }

    // Dodat bezbednosni korak za prazne fajlove
    if (file.size === 0) {
      showToast('Ovaj fajl je prazan (0 bajtova). Ubaci pravi dokument.');
      return;
    }

    setAttachedFileName(file.name);
    showToast('Učitavam fajl...');
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        if (arrayBuffer) {
          const result = await mammoth.extractRawText({ arrayBuffer });
          setAttachedFileText(result.value);
          showToast('Fajl je uspešno učitan i spreman!');
        }
      } catch (error) {
        showToast('Fajl je oštećen ili nije validan Word dokument.');
        removeAttachment();
      }
    };

    reader.onerror = () => {
      showToast('Greška pri čitanju fajla sa računara.');
      removeAttachment();
    };

    reader.readAsArrayBuffer(file);
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeAttachment() {
    setAttachedFileName(null);
    setAttachedFileText(null);
  }

  // 3. Funkcija za okidanje šablona
  function handleTemplateClick(templateText: string) {
    setInput(templateText);
    textareaRef.current?.focus(); // Automatski stavlja kursor u textarea
  }

  async function sendMessage(autoQuery?: string) {
    const baseQuery = autoQuery || input.trim();
    if ((!baseQuery && !attachedFileText) || loading) return;

    let finalQueryForAI = baseQuery;
    let queryForDisplay = baseQuery;

    if (attachedFileText) {
      const defaultReq = 'Molim te detaljno pročitaj i analiziraj ovaj dokument.';
      const userReq = baseQuery ? baseQuery : defaultReq;
      
      finalQueryForAI = `[Sadržaj prikačenog dokumenta: ${attachedFileName}]\n${attachedFileText}\n\nKorisnikov zahtev u vezi dokumenta: ${userReq}`;
      queryForDisplay = `📎 [${attachedFileName}]\n\n${userReq}`;
    }

    if (!autoQuery) {
      setInput('');
      setMessages((prev) => [...prev, { role: 'user', content: queryForDisplay }]);
      removeAttachment(); 
    }

    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: finalQueryForAI, chatId: activeChatId }),
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

  const activeChatTitle = chats.find(c => c.id === activeChatId)?.title || 'Pravni_Razgovor';

  // 4. Odlučujemo koje šablone prikazujemo na osnovu toga da li je fajl zakačen
  const activeTemplates = attachedFileText ? fileTemplates : defaultTemplates;

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

      <main className="flex-1 flex flex-col z-0 bg-[#F7F3EC]">
        <div className="flex-1 overflow-y-auto px-6 py-8 max-w-3xl mx-auto w-full">
          
          {messages.length > 0 && (
            <div className="flex justify-end mb-6">
              <button
                onClick={() => exportFullChatToWord(messages, activeChatTitle)}
                className="flex items-center gap-2 text-sm bg-white border border-[#16263D]/20 px-4 py-2 rounded-md hover:bg-gray-50 transition text-[#16263D] font-medium shadow-sm"
                title="Preuzmi celu istoriju ovog razgovora kao Word dokument"
              >
                📝 Preuzmi ceo zapisnik (.docx)
              </button>
            </div>
          )}

          {messages.length === 0 && (
            <p className="text-[#16263D]/50 text-center mt-20">
              Postavi pravno pitanje ili prikači radnu verziju dokumenta da započneš razgovor.
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
                <div className="mt-2 text-left flex items-center justify-between max-w-[85%]">
                  <button
                    onClick={() => copyText(m.content)}
                    className="text-xs text-[#16263D]/50 hover:text-[#16263D] transition"
                  >
                    Kopiraj tekst
                  </button>
                  
                  <button
                    onClick={() => exportSingleMessageToWord(m.content, 'Pravni_Akt')}
                    className="text-xs text-[#16263D]/60 hover:text-[#16263D] flex items-center gap-1.5 border border-[#16263D]/15 bg-white/60 px-2.5 py-1.5 rounded-md hover:bg-white transition"
                    title="Preuzmi samo ovaj odgovor kao Word dokument"
                  >
                    📄 Izvezi u Word
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

        <div className="border-t border-[#16263D]/10 px-6 py-4 max-w-3xl mx-auto w-full bg-[#F7F3EC]">
          
          {attachedFileName && (
            <div className="mb-3 flex items-center gap-2 bg-white border border-[#16263D]/20 px-3 py-1.5 rounded-md shadow-sm w-fit">
               <span className="text-xs text-[#16263D] font-medium">📄 {attachedFileName}</span>
               <button 
                 onClick={removeAttachment} 
                 className="text-[#16263D]/50 hover:text-red-500 text-xs ml-2 font-bold transition"
                 title="Ukloni fajl"
               >
                 ✕
               </button>
            </div>
          )}

          {/* 5. Pametni Šabloni - Prikazuju se samo kada je polje prazno */}
          {!input.trim() && (
            <div className="flex flex-wrap gap-2 mb-3">
              {activeTemplates.map((tpl, idx) => (
                <button
                  key={idx}
                  onClick={() => handleTemplateClick(tpl.text)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/60 border border-[#16263D]/10 text-xs text-[#16263D] hover:bg-white hover:border-[#16263D]/30 hover:shadow-sm transition-all duration-200"
                >
                  <span>{tpl.icon}</span>
                  <span className="font-medium">{tpl.text}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2 items-end">
            <input 
               type="file" 
               accept=".docx" 
               ref={fileInputRef} 
               onChange={handleFileAttachment} 
               className="hidden" 
            />
            
            <button
               onClick={() => fileInputRef.current?.click()}
               className="rounded-md border border-[#16263D]/20 bg-white text-[#16263D]/60 px-3 py-2 hover:bg-gray-50 hover:text-[#16263D] transition h-[42px] flex items-center justify-center shadow-sm"
               title="Prikači Word (.docx) dokument sa računara"
            >
               📎
            </button>

            <textarea
              ref={textareaRef} // Povezana referenca za automatski fokus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder={attachedFileName ? "Napiši šta želiš da AI uradi sa ovim fajlom..." : "Postavi pitanje…"}
              className="flex-1 resize-none rounded-md border border-[#16263D]/20 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#16263D]/30 bg-white shadow-sm text-sm"
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || (!input.trim() && !attachedFileText)}
              className="rounded-md bg-[#16263D] text-[#F7F3EC] px-4 py-2 hover:bg-[#16263D]/90 disabled:opacity-50 transition h-[42px] text-sm"
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