import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
// Dodajemo import server klijenta da bismo proverili ko je ulogovan
import { createClient } from '@/lib/supabase/server';

const SYSTEM_PROMPT = (context: string) => `Ti si pravni asistent za advokatskog pripravnika. Odgovaraš isključivo na srpskom jeziku, kolegijalnim i predusretljivim tonom, kao iskusna koleginica koja pomaže.

Pravila:
- Prvenstveno koristi tekst iz priloženih izvoda ispod. Ako je relevantan član zakona ili pasus prisutan, prepiši ga u celosti i zatim ga jasno protumači.
- Ako tražena informacija NIJE u priloženim izvodima, na početku odgovora eksplicitno napomeni: "Ovo se ne nalazi u priloženoj literaturi, ali prema opštem pravnom znanju..." — nikad ne mešaj izvore bez ove napomene.
- Ako se izvodi razlikuju ili su kontradiktorni, napomeni to umesto da tiho izabereš jedan.
- Ne koristi podebljan (bold) tekst, osim ako pitanje zahteva tabelu sa više rokova.
- Na kraju svakog citiranog pasusa, u zagradi navedi naziv izvora.

Izvodi iz literature relevantni za ovo pitanje:
${context || '(Nije pronađen relevantan izvod u priloženoj literaturi za ovo pitanje.)'}`;

export async function POST(req: Request) {
  try {
    // 0. Autentifikacija: Proveravamo da li je korisnik ulogovan
    const supabaseServer = await createClient();
    const { data: { user }, error: authError } = await supabaseServer.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Niste ulogovani ili je sesija istekla.' }, { status: 401 });
    }

    const { query, chatId } = await req.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Pitanje nije poslato.' }, { status: 400 });
    }

    let activeChatId = chatId;

    // 1. Autorizacija i kreiranje chata
    if (activeChatId) {
      // Ako chat već postoji, proveravamo da li pripada ulogovanom korisniku!
      const { data: existingChat, error: chatCheckError } = await supabaseAdmin
        .from('chats')
        .select('id, user_id')
        .eq('id', activeChatId)
        .single();

      if (chatCheckError || !existingChat || existingChat.user_id !== user.id) {
        return NextResponse.json({ error: 'Nemate pristup ovom razgovoru.' }, { status: 403 });
      }
    } else {
      // Ako nema chatId, pravimo novi razgovor i vezujemo ga za user.id
      const title = query.length > 50 ? query.slice(0, 50) + '…' : query;
      const { data: newChat, error: chatError } = await supabaseAdmin
        .from('chats')
        .insert({ title, user_id: user.id }) // <-- KLJUČNO: Upisujemo vlasnika
        .select('id')
        .single();

      if (chatError || !newChat) {
        console.error('Chat Create Error:', chatError);
        return NextResponse.json({ error: 'Greška pri kreiranju razgovora.' }, { status: 500 });
      }
      activeChatId = newChat.id;
    }

    // 2. Učitavamo prethodnu istoriju za kontekst modelu
    const { data: historyRows, error: historyError } = await supabaseAdmin
      .from('messages')
      .select('role, content')
      .eq('chat_id', activeChatId)
      .order('created_at', { ascending: true });

    if (historyError) {
      console.error('History Load Error:', historyError);
      return NextResponse.json({ error: 'Greška pri učitavanju istorije.' }, { status: 500 });
    }

    // 3. Čuvamo korisnikovu poruku
    const { error: userMsgError } = await supabaseAdmin
      .from('messages')
      .insert({ chat_id: activeChatId, role: 'user', content: query });

    if (userMsgError) {
      console.error('User Message Save Error:', userMsgError);
      return NextResponse.json({ error: 'Greška pri čuvanju poruke.' }, { status: 500 });
    }

    // 4. Embedujemo pitanje preko Voyage AI
    const voyageRes = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({ input: [query], model: 'voyage-law-2', input_type: 'query' }),
    });

    if (!voyageRes.ok) {
      const errText = await voyageRes.text();
      console.error('Voyage API Error:', errText);
      return NextResponse.json({ error: 'Greška pri obradi pitanja.' }, { status: 500 });
    }

    const voyageData = await voyageRes.json();
    const queryEmbedding = voyageData.data[0].embedding;

    // 5. Pretraga relevantnih pasusa sa FILTEROM ZA KORISNIKA
    const { data: chunks, error: searchError } = await supabaseAdmin.rpc(
      'match_document_chunks',
      { 
        query_embedding: queryEmbedding, 
        match_count: 8,
        filter_user_id: user.id // <-- KLJUČNO: Traži samo po dokumentima ulogovanog korisnika
      }
    );

    if (searchError) {
      console.error('Supabase Search Error:', searchError);
      return NextResponse.json({ error: 'Greška pri pretrazi baze.' }, { status: 500 });
    }

    const context = (chunks || [])
      .map((c: any) => `[Izvor: ${c.document_title}]\n${c.content}`)
      .join('\n\n---\n\n');

    // 6. Slanje Claude-u (Ispravljen naziv modela u pravi)
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5', // ISPRAVLJENO: Zvaničan string za Claude 3.5 Sonnet
        max_tokens: 4096,
        system: SYSTEM_PROMPT(context),
        messages: [
          ...(historyRows || []).map((h) => ({ role: h.role, content: h.content })),
          { role: 'user', content: query },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Claude API Error:', errText);
      return NextResponse.json({ error: 'Greška na Claude API servisu.' }, { status: 500 });
    }

    const claudeData = await claudeRes.json();
    const answer = claudeData.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');

    // 7. Čuvamo Claude-ov odgovor
    const { error: assistantMsgError } = await supabaseAdmin
      .from('messages')
      .insert({ chat_id: activeChatId, role: 'assistant', content: answer });

    if (assistantMsgError) {
      console.error('Assistant Message Save Error:', assistantMsgError);
    }

    return NextResponse.json({
      chatId: activeChatId,
      response: answer,
      sources: (chunks || []).map((c: any) => ({ title: c.document_title, snippet: c.content.slice(0, 150) })),
    });
  } catch (error) {
    console.error('Chat Exception:', error);
    return NextResponse.json({ error: 'Interna greška prilikom obrade pitanja.' }, { status: 500 });
  }
}