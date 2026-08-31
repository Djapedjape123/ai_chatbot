import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { extractText, getDocumentProxy } from 'unpdf';
import { requireUser } from '@/lib/require-user';

// Bezbednosni limiti
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB limit
const MAX_CHUNKS = 500; // Maksimalan broj pasusa (sprečava probijanje API limita)

export async function POST(req: Request) {
  try {
    // 0. Provera da li je korisnik prijavljen
    const { user, errorResponse } = await requireUser();
    if (!user) return errorResponse!;

    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'Niste poslali PDF fajl.' }, { status: 400 });
    }

    // --- 1. BEZBEDNOSNE PROVERE FAJLA ---
    if (file.size === 0) {
      return NextResponse.json({ error: 'Fajl je prazan (0 bajtova).' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Fajl je prevelik. Maksimalna dozvoljena veličina je 10MB.' }, { status: 400 });
    }

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Dozvoljen je isključivo PDF format fajla.' }, { status: 400 });
    }

    // 2. Pretvaranje fajla u Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // 3. Izvlačenje teksta iz PDF-a
    const pdf = await getDocumentProxy(buffer);
    const { text } = await extractText(pdf, { mergePages: true });
    const rawText = text;

    if (!rawText || rawText.trim().length === 0) {
      return NextResponse.json({ error: 'PDF ne sadrži tekst ili je skenirana slika (potreban je OCR).' }, { status: 400 });
    }

    // 4. Upisujemo ZAGLAVLJE dokumenta u bazu
    const { data: document, error: docError } = await supabaseAdmin
      .from('documents')
      .insert({ title: file.name, user_id: user.id })
      .select('id')
      .single();

    if (docError || !document) {
      console.error('Supabase Error (documents):', docError);
      return NextResponse.json({ error: 'Greška pri čuvanju dokumenata u bazu.' }, { status: 500 });
    }

    // --- 5. ROLLBACK MEHANIZAM (Zaštita od polovično obrađenih dokumenata) ---
    try {
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });

      const docs = await textSplitter.createDocuments([rawText]);
      const chunkTexts = docs.map((d) => d.pageContent);

      // Zid za ogromne dokumente
      if (chunkTexts.length > MAX_CHUNKS) {
        throw new Error(`Fajl je prevelik za procesiranje. Ograničen je na ${MAX_CHUNKS} pasusa, a ovaj ima ${chunkTexts.length}.`);
      }

      // Slanje na Voyage AI u paketićima po 30
      const batchSize = 30;
      for (let i = 0; i < chunkTexts.length; i += batchSize) {
        const batch = chunkTexts.slice(i, i + batchSize);

        // Timeout zaštita (15 sekundi max po batchu)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        // Slanje batch-a na Voyage AI za generisanje vektora
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
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!voyageRes.ok) {
          const errText = await voyageRes.text();
          console.error('Voyage API Error:', errText);
          throw new Error('Greška u komunikaciji sa AI servisom za vektore.');
        }

        const voyageData = await voyageRes.json();

        // Priprema i upis pasusa i vektora
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
          throw new Error('Greška pri upisu vektora u bazu podataka.');
        }
      }

      return NextResponse.json({
        success: true,
        message: `Uspešno indeksiran dokument "${file.name}"! Ukupno pasusa: ${chunkTexts.length}`,
      });

    } catch (innerError) {
      
      // ROLLBACK: Brisanje nekompletnog dokumenta iz baze ukoliko se desila bilo kakva greška!
      console.error('Proces obrade prekinut. Pokrećem rollback...', innerError);
      await supabaseAdmin.from('documents').delete().eq('id', document.id);
      
      const errorMessage = innerError instanceof Error ? innerError.message : 'Došlo je do greške pri obradi fajla.';
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }

  } catch (error) {
    console.error('Ingestion Exception:', error);
    return NextResponse.json({ error: 'Interna greška prilikom uvoza fajla.' }, { status: 500 });
  }
}