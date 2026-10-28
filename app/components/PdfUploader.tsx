'use client';

import { useState, useRef } from 'react';
import { MAX_FILE_SIZE } from '@/lib/ingest';

// Dodali smo onUploadSuccess kako bi prosledili ime fajla glavnom ekranu
interface PdfUploaderProps {
  onClose: () => void;
  onUploadSuccess: (fileName: string) => void;
}

const FILE_TOO_LARGE = `Fajl je prevelik. Maksimalna dozvoljena veličina je ${MAX_FILE_SIZE / (1024 * 1024)}MB.`;

export default function PdfUploader({ onClose, onUploadSuccess }: PdfUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null; text: string }>({ type: null, text: '' });
  // Server je našao tekst koji liči na naredbe za AI: korisnik odlučuje da li ipak nastavlja
  const [suspiciousWarning, setSuspiciousWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setStatus({ type: null, text: '' });
      setSuspiciousWarning(null);
    }
  };

  const clearFile = () => {
    setFile(null);
    setSuspiciousWarning(null);
    if (fileInputRef.current) fileInputRef.current.value = ''; // Resetovanje inputa
  };

  const handleUpload = async (acknowledge = false) => {
    if (!file) {
      setStatus({ type: 'error', text: 'Molimo vas da prvo izaberete PDF fajl.' });
      return;
    }

    // Provera pre slanja: server ionako odbija veće fajlove, a Vercel odbija telo preko ~4.5MB
    if (file.size > MAX_FILE_SIZE) {
      setStatus({ type: 'error', text: FILE_TOO_LARGE });
      return;
    }

    setLoading(true);
    setStatus({ type: null, text: '' });
    setSuspiciousWarning(null);

    const formData = new FormData();
    formData.append('file', file);
    if (acknowledge) formData.append('acknowledge', 'true');
    const uploadedFileName = file.name; // Pamtimo ime fajla

    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        body: formData,
      });

      // Odgovor ne mora da bude JSON (npr. 413 sa Vercel-a pre nego što zahtev stigne do rute)
      const data = await res.json().catch(() => null);

      if (res.status === 409 && data?.code === 'suspicious_content') {
        setSuspiciousWarning(data.error);
      } else if (!res.ok) {
        setStatus({
          type: 'error',
          text: data?.error || (res.status === 413 ? FILE_TOO_LARGE : 'Došlo je do greške pri indeksiranju.'),
        });
      } else {
        setStatus({ type: 'success', text: data?.message || 'Dokument je uspešno sačuvan i indeksiran!' });
        clearFile();

        // Magija: Čekamo 1.5 sekundu da korisnik vidi zelenu poruku,
        // a zatim zatvaramo modal i šaljemo ime fajla glavnom interfejsu
        setTimeout(() => {
          onUploadSuccess(uploadedFileName);
        }, 1500);
      }
    } catch {
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
          <p className="mt-2 text-xs text-[#16263D]/60">PDF sa tekstom, najviše {MAX_FILE_SIZE / (1024 * 1024)}MB.</p>
        </div>

        {status.text && (
          <div className={`mb-6 p-3 rounded-md text-sm border ${status.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
            {status.text}
          </div>
        )}

        {suspiciousWarning && (
          <div role="alert" className="mb-6 p-3 rounded-md text-sm border bg-amber-50 border-amber-300 text-amber-900">
            {suspiciousWarning}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-2">
          {suspiciousWarning ? (
            <>
              <button
                onClick={clearFile}
                disabled={loading}
                className="px-4 py-2 text-sm text-[#16263D] hover:bg-[#16263D]/10 rounded-md transition disabled:opacity-50"
              >
                Otkaži
              </button>
              <button
                onClick={() => handleUpload(true)}
                disabled={loading}
                className="px-4 py-2 text-sm bg-amber-700 text-white rounded-md hover:bg-amber-800 disabled:opacity-50 transition shadow-sm"
              >
                Ipak dodaj
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 text-sm text-[#16263D] hover:bg-[#16263D]/10 rounded-md transition disabled:opacity-50"
              >
                Zatvori
              </button>
              <button
                onClick={() => handleUpload()}
                disabled={loading || !file || status.type === 'success'}
                className="px-4 py-2 text-sm bg-[#16263D] text-[#F7F3EC] rounded-md hover:bg-[#16263D]/90 disabled:opacity-50 transition flex items-center gap-2 shadow-sm"
              >
                {loading ? <span className="animate-pulse">Indeksiranje...</span> : 'Sačuvaj PDF'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
