'use client';

import { useState, useRef } from 'react';

// Dodali smo onUploadSuccess kako bi prosledili ime fajla glavnom ekranu
interface PdfUploaderProps {
  onClose: () => void;
  onUploadSuccess: (fileName: string) => void;
}

export default function PdfUploader({ onClose, onUploadSuccess }: PdfUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null; text: string }>({ type: null, text: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setStatus({ type: null, text: '' });
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setStatus({ type: 'error', text: 'Molimo vas da prvo izaberete PDF fajl.' });
      return;
    }

    setLoading(true);
    setStatus({ type: null, text: '' });

    const formData = new FormData();
    formData.append('file', file);
    const uploadedFileName = file.name; // Pamtimo ime fajla

    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({ type: 'error', text: data.error || 'Došlo je do greške pri indeksiranju.' });
      } else {
        setStatus({ type: 'success', text: data.message || 'Dokument je uspešno sačuvan i indeksiran!' });
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = ''; // Resetovanje inputa
        
        // Magija: Čekamo 1.5 sekundu da korisnik vidi zelenu poruku, 
        // a zatim zatvaramo modal i šaljemo ime fajla glavnom interfejsu
        setTimeout(() => {
          onUploadSuccess(uploadedFileName);
        }, 1500);
      }
    } catch (error) {
      setStatus({ type: 'error', text: 'Greška pri povezivanju sa serverom.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#16263D]/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-[#F7F3EC] p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-[#16263D]">Dodaj pravnu literaturu</h2>
          <button 
            onClick={onClose} 
            className="text-[#16263D]/50 hover:text-[#16263D] transition text-2xl leading-none"
            disabled={loading} // Ne damo da se zatvori dok se učitava
          >
            &times;
          </button>
        </div>
        
        <div className="mb-6">
          <input
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            ref={fileInputRef}
            disabled={loading} // Zaključavamo input dok se učitava
            className="w-full text-sm text-[#16263D] file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-[#16263D]/10 file:text-[#16263D] hover:file:bg-[#16263D]/20 cursor-pointer transition"
          />
        </div>

        {status.text && (
          <div className={`mb-6 p-3 rounded-md text-sm border ${status.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
            {status.text}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-[#16263D] hover:bg-[#16263D]/10 rounded-md transition disabled:opacity-50"
          >
            Zatvori
          </button>
          <button
            onClick={handleUpload}
            disabled={loading || !file || status.type === 'success'}
            className="px-4 py-2 text-sm bg-[#16263D] text-[#F7F3EC] rounded-md hover:bg-[#16263D]/90 disabled:opacity-50 transition flex items-center gap-2 shadow-sm"
          >
            {loading ? <span className="animate-pulse">Indeksiranje...</span> : 'Sačuvaj PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}