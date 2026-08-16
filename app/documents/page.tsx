'use client';

import { useEffect, useState } from 'react';
import { getUserDocuments, deleteDocument } from '@/app/actions/documents';

interface DocumentItem {
  id: string;
  title: string;
  created_at: string;
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadDocs();
  }, []);

  async function loadDocs() {
    setLoading(true);
    const docs = await getUserDocuments();
    setDocuments(docs);
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Da li ste sigurni da želite da obrišete ovaj dokument? Svi njegovi indeksirani vektori biće uklonjeni.')) {
      return;
    }

    setDeletingId(id);
    const res = await deleteDocument(id);
    setDeletingId(null);

    if (res.error) {
      alert(res.error);
    } else {
      setDocuments((prev) => prev.filter((doc) => doc.id !== id));
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F3EC] p-6 md:p-12">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-[#16263D]">
              Vaši Dokumenti
            </h1>
            <p className="text-sm text-[#16263D]/60 mt-1">
              Pregled i upravljanje učitanim PDF fajlovima za AI pretragu.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg border border-[#16263D]/10 p-8 text-center text-[#16263D]/60">
            Učitavanje dokumenata…
          </div>
        ) : documents.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#16263D]/10 p-8 text-center text-[#16263D]/60">
            Nemate učitanih dokumenata. Učitajte PDF unutar chat interfejsa.
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-[#16263D]/10 overflow-hidden shadow-sm">
            <div className="divide-y divide-[#16263D]/10">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="p-4 flex items-center justify-between hover:bg-[#F7F3EC]/50 transition"
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-[#16263D]/5 rounded-md text-[#16263D]">
                      📄
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#16263D]">
                        {doc.title}
                      </p>
                      <p className="text-xs text-[#16263D]/50">
                        Dodato: {new Date(doc.created_at).toLocaleDateString('sr-RS')}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(doc.id)}
                    disabled={deletingId === doc.id}
                    className="text-xs text-red-600 hover:text-red-800 font-medium border border-red-200 bg-red-50 hover:bg-red-100 rounded px-3 py-1.5 transition disabled:opacity-50"
                  >
                    {deletingId === doc.id ? 'Brisanje…' : 'Obriši'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}