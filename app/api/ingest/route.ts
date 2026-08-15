import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { extractText, getDocumentProxy } from 'unpdf';
import { requireUser } from '@/lib/require-user';

export async function POST(req: Request) {
  try {
    // 0. Proveravamo da li je korisnik prijavljen
    const { user, errorResponse } = await requireUser();
    if (!user) return errorResponse!;

    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'Niste poslali PDF fajl.' }, { status: 400 });
    }

    // 1. Pretvaranje fajla u Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // 2. Izvlačenje teksta iz PDF-a (unpdf — bez workera, radi glatko na Next.js/Vercel)
    const pdf = await getDocumentProxy(buffer);
    const { text } = await extractText(pdf, { mergePages: true });
    const rawText = text;

    if (!rawText || rawText.trim().length === 0) {
      return NextResponse.json({ error: 'PDF ne sadrži tekst ili je skenirana slika (potreban je OCR).' }, { status: 400 });
    }

    // 3. Upisujemo dokument u 'documents' tabelu, vezan za ulogovanog korisnika
    const { data: document, error: docError } = await supabaseAdmin
      .from('documents')
      .insert({ title: file.name, user_id: user.id })
      .select('id')
      .single();

    if (docError || !document) {
      console.error('Supabase Error (documents):', docError);
      return NextResponse.json({ error: 'Greška pri čuvanju dokumenata u bazu.' }, { status: 500 });
    }

    // 4. Seckanje teksta na pasuse (chunking)
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const docs = await textSplitter.createDocuments([rawText]);
    const chunkTexts = docs.map((d) => d.pageContent);

    // 5. Slanje na Voyage AI u paketićima po 30 radi stabilnosti
    const batchSize = 30;
    for (let i = 0; i < chunkTexts.length; i += batchSize) {
      const batch = chunkTexts.slice(i, i + batchSize);

      const voyageRes = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
        },
        body: JSON.stringify({
          input: batch,
          model: 'voyage-law-2',
        }),
      });

      if (!voyageRes.ok) {
        const errText = await voyageRes.text();
        console.error('Voyage API Error:', errText);
        return NextResponse.json({ error: 'Greška na Voyage AI servisu.' }, { status: 500 });
      }

      const voyageData = await voyageRes.json();

      // 6. Priprema i upis pasusa i vektora u 'document_chunks' tabelu
      const insertData = batch.map((text, index: number) => ({
        document_id: document.id,
        content: text,
        embedding: voyageData.data[index].embedding,
      }));

      const { error: chunkError } = await supabaseAdmin
        .from('document_chunks')
        .insert(insertData);

      if (chunkError) {
        console.error('Supabase Error (document_chunks):', chunkError);
        return NextResponse.json({ error: 'Greška pri upisu vektora u bazu.' }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Uspešno indeksiran dokument "${file.name}"! Ukupno pasusa: ${chunkTexts.length}`,
    });
  } catch (error) {
    console.error('Ingestion Exception:', error);
    return NextResponse.json({ error: 'Interna greška prilikom obrade fajla.' }, { status: 500 });
  }
}