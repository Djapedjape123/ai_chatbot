'use client';

import { useState } from 'react';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const handleUpload = async () => {
    if (!file) {
      alert('Molimo izaberite PDF fajl!');
      return;
    }

    setLoading(true);
    setStatus('Procesiram PDF, seckam tekst i kreiram Voyage AI pravne vektore...');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setStatus(`✅ ${data.message}`);
      } else {
        setStatus(`❌ Greška: ${data.error}`);
      }
    } catch (err) {
      setStatus('❌ Greška na mreži pri slanju fajla.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-amber-50 text-slate-900">
      <div className="bg-white p-6 rounded-xl shadow-lg border border-amber-200 max-w-md w-full flex flex-col gap-4">
        <h1 className="text-xl font-bold text-slate-800">🏛️ Pravni Asistent — Test Ingest</h1>
        <p className="text-sm text-slate-600">Ubaci jednu pravnu skriptu ili zakon u PDF formatu da proverimo baza/vektor pipeline.</p>
        
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="border p-2 rounded text-sm file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:bg-amber-100 file:text-amber-800 font-sans"
        />

        <button
          onClick={handleUpload}
          disabled={loading}
          className="bg-slate-900 text-amber-50 py-2.5 px-4 rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 transition-all"
        >
          {loading ? 'Obrada u toku...' : 'Ubaci knjigu u bazu'}
        </button>

        {status && <div className="p-3 bg-slate-100 rounded text-xs font-mono break-words">{status}</div>}
      </div>
    </main>
  );
}