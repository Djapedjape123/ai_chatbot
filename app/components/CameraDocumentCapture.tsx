'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePrepareError, prepareImage, type PreparedImage } from '@/lib/image-prepare';
import { MAX_DOCUMENT_PAGES, TRANSCRIPT_MAX_LENGTH } from '@/lib/image-limits';

// Slikan dokument u bazu znanja (Faza 3.5): do 5 strana → prepis strana po stranu (/api/ingest/transcribe) →
// advokat pregleda i ispravlja tekst → indeksiranje (/api/ingest/text). Slike se ne čuvaju: posle prepisa
// ostaju samo u memoriji pregledača dok je prozor otvoren.

interface CameraDocumentCaptureProps {
  onBack: () => void;
  onUploadSuccess: (title: string) => void;
}

type Step = 'pick' | 'transcribing' | 'review';

const defaultTitle = () => `Slikani dokument ${new Date().toLocaleDateString('sr-Latn-RS')}`;

export default function CameraDocumentCapture({ onBack, onUploadSuccess }: CameraDocumentCaptureProps) {
  const [pages, setPages] = useState<PreparedImage[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [step, setStep] = useState<Step>('pick');
  // Prepis po strani; dužina niza = broj strana koje su već prepisane
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [truncatedPages, setTruncatedPages] = useState<number[]>([]);
  const [title, setTitle] = useState(defaultTitle);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [suspiciousWarning, setSuspiciousWarning] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pagesRef = useRef<PreparedImage[]>([]);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  // Lokalni prikazi slika se oslobađaju kad se prozor zatvori
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (inputRef.current) inputRef.current.value = '';
    if (files.length === 0) return;
    setError(null);
    const room = MAX_DOCUMENT_PAGES - pages.length;
    if (files.length > room) setError(`Dokument može da ima najviše ${MAX_DOCUMENT_PAGES} strana. Dodate su prve ${room}.`);
    setPreparing(true);
    try {
      const added: PreparedImage[] = [];
      for (const file of files.slice(0, room)) {
        try {
          added.push(await prepareImage(file));
        } catch (err) {
          setError(err instanceof ImagePrepareError ? err.message : 'Slika ne može da se obradi. Slikajte ponovo.');
        }
      }
      setPages((prev) => [...prev, ...added]);
    } finally {
      setPreparing(false);
    }
  }

  function removePage(index: number) {
    URL.revokeObjectURL(pages[index].previewUrl);
    setPages((prev) => prev.filter((_, i) => i !== index));
  }

  function movePage(index: number, delta: number) {
    setPages((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  // Prepis kreće od prve neprepisane strane, pa "Pokušaj ponovo" ne plaća ponovo već prepisane
  async function transcribe() {
    // Sve strane su već prepisane (povratak iz pregleda): ispravljen tekst ostaje
    if (transcripts.length === pages.length && text) {
      setStep('review');
      return;
    }
    setStep('transcribing');
    setError(null);
    const done = [...transcripts];
    const truncated = [...truncatedPages];
    for (let i = done.length; i < pages.length; i++) {
      const formData = new FormData();
      formData.append('image', pages[i].blob, `strana-${i + 1}.jpg`);
      try {
        const res = await fetch('/api/ingest/transcribe', { method: 'POST', body: formData });
        const data = await res.json().catch(() => null);
        if (!res.ok || typeof data?.text !== 'string') {
          setError(`Strana ${i + 1}: ${data?.error || (res.status === 413 ? 'slika je prevelika.' : 'prepis nije uspeo.')}`);
          setTranscripts(done);
          setTruncatedPages(truncated);
          setStep('pick');
          return;
        }
        done.push(data.text);
        if (data.truncated === true) truncated.push(i + 1);
        setTranscripts([...done]);
      } catch {
        setError(`Strana ${i + 1}: greška pri povezivanju sa serverom.`);
        setTranscripts(done);
        setTruncatedPages(truncated);
        setStep('pick');
        return;
      }
    }
    setTruncatedPages(truncated);
    setText(done.map((t, i) => (done.length > 1 ? `[Strana ${i + 1}]\n${t}` : t)).join('\n\n'));
    setStep('review');
  }

  async function save(acknowledge = false) {
    setLoading(true);
    setError(null);
    setSuspiciousWarning(null);
    try {
      const res = await fetch('/api/ingest/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, text, pages: pages.length, acknowledge }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 409 && data?.code === 'suspicious_content') {
        setSuspiciousWarning(data.error);
      } else if (!res.ok) {
        setError(data?.error || 'Došlo je do greške pri indeksiranju.');
      } else {
        setSuccess(data?.message || 'Dokument je sačuvan u bazi znanja.');
        const savedTitle = title;
        setTimeout(() => onUploadSuccess(savedTitle), 1500);
      }
    } catch {
      setError('Greška pri povezivanju sa serverom.');
    } finally {
      setLoading(false);
    }
  }

  // Promena strana posle delimičnog prepisa: prepis se radi ispočetka, da tekst odgovara stranama
  function resetTranscripts() {
    setTranscripts([]);
    setTruncatedPages([]);
    setText('');
  }

  const busy = preparing || loading || step === 'transcribing';

  return (
    <div>
      {step !== 'review' ? (
        <>
          <p className="text-sm text-[#16263D]/80 mb-3">
            Slikajte do {MAX_DOCUMENT_PAGES} strana dokumenta redom. Tekst će biti prepisan, a vi ga pregledate pre čuvanja.
          </p>
          <input
            type="file"
            accept="image/*"
            multiple
            ref={inputRef}
            onChange={handlePick}
            className="hidden"
          />
          {pages.length > 0 && (
            <ol className="mb-3 space-y-2">
              {pages.map((p, i) => (
                <li key={p.previewUrl} className="flex items-center gap-3 bg-white border border-[#16263D]/15 rounded-md p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- lokalni blob: prikaz, ne ide na server */}
                  <img src={p.previewUrl} alt={`Strana ${i + 1}`} className="h-14 w-11 object-cover rounded border border-[#16263D]/10" />
                  <span className="text-sm text-[#16263D] flex-1">
                    Strana {i + 1}
                    {i < transcripts.length && <span className="text-emerald-700"> · prepisana</span>}
                  </span>
                  <button onClick={() => { resetTranscripts(); movePage(i, -1); }} disabled={busy || i === 0} className="px-2 text-[#16263D]/60 disabled:opacity-30" aria-label="Pomeri gore">↑</button>
                  <button onClick={() => { resetTranscripts(); movePage(i, 1); }} disabled={busy || i === pages.length - 1} className="px-2 text-[#16263D]/60 disabled:opacity-30" aria-label="Pomeri dole">↓</button>
                  <button onClick={() => { resetTranscripts(); removePage(i); }} disabled={busy} className="px-2 text-red-600/70 disabled:opacity-30" aria-label="Ukloni stranu">✕</button>
                </li>
              ))}
            </ol>
          )}
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy || pages.length >= MAX_DOCUMENT_PAGES}
            className="w-full mb-2 py-2.5 rounded-md border border-dashed border-[#16263D]/30 bg-white text-sm text-[#16263D] disabled:opacity-50"
          >
            {preparing ? 'Pripremam sliku...' : pages.length === 0 ? '📷 Slikaj prvu stranu' : `📷 Dodaj stranu (${pages.length}/${MAX_DOCUMENT_PAGES})`}
          </button>
          <p className="text-[11px] text-[#16263D]/50 mb-4">Slika se šalje AI servisu radi prepisa i ne čuva se.</p>
          {step === 'transcribing' && (
            <p role="status" className="mb-4 text-sm text-[#16263D] animate-pulse">
              Prepisujem stranu {Math.min(transcripts.length + 1, pages.length)} od {pages.length}...
            </p>
          )}
        </>
      ) : (
        <>
          <label className="block text-xs font-medium text-[#16263D]/70 mb-1" htmlFor="camera-doc-title">Naziv dokumenta</label>
          <input
            id="camera-doc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            disabled={loading}
            className="w-full mb-3 rounded-md border border-[#16263D]/20 px-3 py-2 text-sm bg-white"
          />
          <label className="block text-xs font-medium text-[#16263D]/70 mb-1" htmlFor="camera-doc-text">
            Prepis (proverite brojeve članova, datume i iznose; ispravite greške)
          </label>
          <textarea
            id="camera-doc-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={loading}
            rows={10}
            className="w-full rounded-md border border-[#16263D]/20 px-3 py-2 text-sm bg-white font-mono"
          />
          <p className={`text-[11px] mb-3 ${text.length > TRANSCRIPT_MAX_LENGTH ? 'text-red-600' : 'text-[#16263D]/50'}`}>
            {text.length.toLocaleString('sr-Latn-RS')} / {TRANSCRIPT_MAX_LENGTH.toLocaleString('sr-Latn-RS')} znakova
          </p>
          {truncatedPages.length > 0 && (
            <p className="mb-3 p-2 rounded-md text-xs border bg-amber-50 border-amber-300 text-amber-900">
              Prepis strane {truncatedPages.join(', ')} je možda nepotpun (strana je vrlo gusta). Proverite kraj te strane.
            </p>
          )}
        </>
      )}

      {error && <div className="mb-4 p-3 rounded-md text-sm border bg-red-50 border-red-200 text-red-700">{error}</div>}
      {success && <div className="mb-4 p-3 rounded-md text-sm border bg-emerald-50 border-emerald-200 text-emerald-700">{success}</div>}
      {suspiciousWarning && (
        <div role="alert" className="mb-4 p-3 rounded-md text-sm border bg-amber-50 border-amber-300 text-amber-900">
          {suspiciousWarning}
        </div>
      )}

      <div className="flex justify-end gap-3">
        {suspiciousWarning ? (
          <>
            <button onClick={() => setSuspiciousWarning(null)} disabled={loading} className="px-4 py-2 text-sm text-[#16263D] hover:bg-[#16263D]/10 rounded-md disabled:opacity-50">
              Otkaži
            </button>
            <button onClick={() => save(true)} disabled={loading} className="px-4 py-2 text-sm bg-amber-700 text-white rounded-md hover:bg-amber-800 disabled:opacity-50 shadow-sm">
              Ipak dodaj
            </button>
          </>
        ) : step === 'review' ? (
          <>
            <button onClick={() => setStep('pick')} disabled={loading || !!success} className="px-4 py-2 text-sm text-[#16263D] hover:bg-[#16263D]/10 rounded-md disabled:opacity-50">
              Nazad na strane
            </button>
            <button
              onClick={() => save()}
              disabled={loading || !!success || !title.trim() || !text.trim() || text.length > TRANSCRIPT_MAX_LENGTH}
              className="px-4 py-2 text-sm bg-[#16263D] text-[#F7F3EC] rounded-md hover:bg-[#16263D]/90 disabled:opacity-50 shadow-sm"
            >
              {loading ? <span className="animate-pulse">Indeksiranje...</span> : 'Dodaj u bazu znanja'}
            </button>
          </>
        ) : (
          <>
            <button onClick={onBack} disabled={busy} className="px-4 py-2 text-sm text-[#16263D] hover:bg-[#16263D]/10 rounded-md disabled:opacity-50">
              Nazad
            </button>
            <button
              onClick={transcribe}
              disabled={busy || pages.length === 0}
              className="px-4 py-2 text-sm bg-[#16263D] text-[#F7F3EC] rounded-md hover:bg-[#16263D]/90 disabled:opacity-50 shadow-sm"
            >
              {transcripts.length > 0 && transcripts.length < pages.length ? 'Nastavi prepis' : 'Prepiši'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
