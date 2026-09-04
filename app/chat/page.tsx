'use client';

import { useEffect, useRef, useState } from 'react';
import PdfUploader from '@/app/components/PdfUploader';
import Sidebar from '@/app/components/Sidebar';
import { exportSingleMessageToWord, exportFullChatToWord } from '@/lib/exportWord';
import * as mammoth from 'mammoth';

type Message = { id?: string; role: 'user' | 'assistant'; content: string };
type Chat = { id: string; title: string; created_at: string };

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
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const [attachedFileName, setAttachedFileName] = useState<string | null>(null);
  const [attachedFileText, setAttachedFileText] = useState<string | null>(null);
  
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  function handleTemplateClick(templateText: string) {
    setInput(templateText);
    textareaRef.current?.focus(); 
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
    setTimeout(() => { sendMessage(autoPrompt); }, 200);
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
  const activeTemplates = attachedFileText ? fileTemplates : defaultTemplates;

  return (
    <div className="flex h-screen relative overflow-hidden bg-[#F7F3EC]">
      
      {/* LEBDEĆE DUGME ZA MENI NA MOBILNOM (Gore Levo) */}
      <button 
        onClick={() => setIsSidebarOpen(true)}
        className="md:hidden absolute top-4 left-4 z-20 p-2.5 bg-white border border-[#16263D]/10 text-[#16263D] rounded-lg shadow-md hover:bg-gray-50 transition"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* OVERLAY ZA ZATVARANJE MENIJA NA MOBILNOM */}
      {isSidebarOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/50 z-30 transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR KOMPONENTA */}
      <Sidebar 
        chats={chats}
        activeChatId={activeChatId}
        onNewChat={() => { newChat(); setIsSidebarOpen(false); }}
        onOpenChat={(id) => { openChat(id); setIsSidebarOpen(false); }}
        onOpenPdfModal={() => { setIsPdfModalOpen(true); setIsSidebarOpen(false); }}
        onDeleteChat={deleteChat}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {/* GLAVNI CHAT DEO */}
      <main className="flex-1 flex flex-col z-0 bg-[#F7F3EC] w-full">
        {/* Na mobilnom dodajemo malo veći pt (pt-16) da poruke ne idu ispod lebdećeg dugmeta */}
        <div className="flex-1 overflow-y-auto px-4 md:px-6 pt-16 md:pt-8 pb-6 md:pb-8 max-w-3xl mx-auto w-full relative">
          
          {messages.length > 0 && (
            <div className="flex justify-end mb-6">
              <button
                onClick={() => exportFullChatToWord(messages, activeChatTitle)}
                className="flex items-center gap-2 text-xs md:text-sm bg-white border border-[#16263D]/20 px-3 md:px-4 py-2 rounded-md hover:bg-gray-50 transition text-[#16263D] font-medium shadow-sm"
              >
                📝 Preuzmi zapisnik (.docx)
              </button>
            </div>
          )}

          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-[#16263D]/50 text-center px-4">
                Postavi pravno pitanje ili prikači radnu verziju dokumenta da započneš razgovor.
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`mb-6 ${m.role === 'user' ? 'text-right' : ''}`}>
              <div
                className={`inline-block max-w-[90%] md:max-w-[85%] rounded-lg px-4 py-3 text-left leading-relaxed text-sm md:text-base ${
                  m.role === 'user'
                    ? 'bg-[#16263D] text-[#F7F3EC]'
                    : 'bg-white border border-[#16263D]/10 shadow-sm'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
              </div>
              
              {m.role === 'assistant' && (
                <div className="mt-2 text-left flex items-center justify-between max-w-[90%] md:max-w-[85%] flex-wrap gap-2">
                  <button
                    onClick={() => copyText(m.content)}
                    className="text-xs text-[#16263D]/50 hover:text-[#16263D] transition"
                  >
                    Kopiraj tekst
                  </button>
                  
                  <button
                    onClick={() => exportSingleMessageToWord(m.content, 'Pravni_Akt')}
                    className="text-xs text-[#16263D]/60 hover:text-[#16263D] flex items-center gap-1.5 border border-[#16263D]/15 bg-white/60 px-2.5 py-1.5 rounded-md hover:bg-white transition"
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

        {/* DONJE POLJE ZA KUCANJE */}
        <div className="border-t border-[#16263D]/10 px-4 md:px-6 py-3 md:py-4 max-w-3xl mx-auto w-full bg-[#F7F3EC] pb-safe">
          
          {attachedFileName && (
            <div className="mb-3 flex items-center gap-2 bg-white border border-[#16263D]/20 px-3 py-1.5 rounded-md shadow-sm w-fit max-w-full">
               <span className="text-xs text-[#16263D] font-medium truncate">📄 {attachedFileName}</span>
               <button 
                 onClick={removeAttachment} 
                 className="text-[#16263D]/50 hover:text-red-500 text-xs ml-2 font-bold transition shrink-0"
               >
                 ✕
               </button>
            </div>
          )}

          {!input.trim() && (
            <div className="flex flex-wrap gap-2 mb-3">
              {activeTemplates.map((tpl, idx) => (
                <button
                  key={idx}
                  onClick={() => handleTemplateClick(tpl.text)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/60 border border-[#16263D]/10 text-[11px] md:text-xs text-[#16263D] hover:bg-white hover:border-[#16263D]/30 shadow-sm transition-all"
                >
                  <span>{tpl.icon}</span>
                  <span className="font-medium truncate max-w-[200px]">{tpl.text}</span>
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
               className="rounded-md border border-[#16263D]/20 bg-white text-[#16263D]/60 px-3 py-2 hover:bg-gray-50 transition h-[42px] flex items-center justify-center shadow-sm shrink-0"
            >
               📎
            </button>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={attachedFileName ? "Zadatak za fajl..." : "Pitaj..."}
              className="flex-1 resize-none rounded-md border border-[#16263D]/20 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#16263D]/30 bg-white shadow-sm text-sm min-h-[42px] max-h-[120px]"
            />
            
            <button
              onClick={() => sendMessage()}
              disabled={loading || (!input.trim() && !attachedFileText)}
              className="rounded-md bg-[#16263D] text-[#F7F3EC] px-4 py-2 hover:bg-[#16263D]/90 disabled:opacity-50 transition h-[42px] text-sm font-medium shrink-0"
            >
              Pošalji
            </button>
          </div>
          <p className="text-[10px] md:text-xs text-[#16263D]/40 text-center mt-2">
            AI može da pogreši — proveri odgovor.
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
        <div className="fixed top-20 md:top-auto md:bottom-6 left-1/2 -translate-x-1/2 md:translate-x-0 md:left-auto md:right-6 bg-[#16263D] text-[#F7F3EC] px-4 py-3 rounded-md shadow-xl text-sm z-50 whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}