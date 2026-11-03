import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireUser } from '@/lib/require-user';
import { apiError } from '@/lib/api-error';
import { chatImagesFormInput, chatImagesFormSchema, chatRequestSchema } from '@/lib/validation';
import {
  buildImageUserContent,
  estimateImageTokens,
  imageMessageContent,
  inspectImages,
  type CheckedImage,
  type ClaudeContentBlock,
} from '@/lib/chat-images';
import { describeRejection } from '@/lib/upload-rejection';
import { buildRagContext, uniqueDocumentIds } from '@/lib/rag-context';
import { buildSystemPrompt } from '@/lib/prompts';
import { enforceIpBurst, reserveUsage, settleUsage, releaseUsage, type ActualTokens } from '@/lib/usage';
import { logAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/client-ip';
import { clientUsage, estimateTokens, parseUsageSummary, usageStatus } from '@/lib/limits';
import {
  CHAT_MAX_OUTPUT_TOKENS,
  estimateChatTokens,
  getClaudeModel,
  parseClaudeResponse,
  parseVoyageResponse,
} from '@/lib/claude';

// Ovaj fajl je deo API rute za chat funkcionalnost. Omogućava korisnicima da postavljaju pitanja i dobijaju odgovore od AI asistenta, uz poštovanje bezbednosnih pravila i ograničenja.
export const maxDuration = 60;
// Limit na broj starih poruka koje šaljemo AI-ju radi štednje tokena
const MAX_HISTORY_MESSAGES = 12;
// Claude sa slikama radi duže; zajedno sa Voyage-om (15 s) staje u maxDuration
const CLAUDE_TIMEOUT_MS = 35_000;
const CLAUDE_IMAGES_TIMEOUT_MS = 40_000;

// Oblik reda koji vraća match_document_chunks (document_id stiže tek posle migracije 20261028130000)
type MatchedChunk = { document_id?: string; document_title: string; content: string; similarity: number };

export async function POST(req: Request) {
  // Rezervacija iz usage ledger-a MORA biti zatvorena na svakom izlazu (vidi finally):
  // inače ostaje 'reserved' i troši korisnikov limit po proceni.
  let reservation: { id: string; userId: string } | null = null;
  let closed = false;
  const spent: ActualTokens = {};

  try {
    // 0. IP burst zaštita (pre autentifikacije: poplava zahteva ne sme da stigne ni do Supabase Auth-a)
    const ip = getClientIp(req.headers);
    const burstBlock = await enforceIpBurst(ip);
    if (burstBlock) return burstBlock;

    // 0.2 Autentifikacija (requireUser za nalog sa uključenom dvostepenom prijavom traži i uneti kod)
    const { user, supabase: supabaseServer, errorResponse: authErrorResponse } = await requireUser();
    if (authErrorResponse) return authErrorResponse;
    const actor = { id: user.id, email: user.email };

    // 0.5 Validacija tela zahteva (zod): pitanje je string 1-4000 karaktera posle trim-a, chatId je UUID ili ga nema.
    //     Pitanje sa slikama (Faza 3.5) stiže kao multipart/form-data sa 1-5 slika; bez slika kao JSON.
    let trimmedQuery: string;
    let chatId: string | undefined;
    let images: CheckedImage[] = [];

    if ((req.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) {
      let formData: FormData;
      try {
        formData = await req.formData();
      } catch {
        return apiError('Neispravan zahtev.', 400, 'invalid_request');
      }
      const parsed = chatImagesFormSchema.safeParse(chatImagesFormInput(formData));
      if (!parsed.success) {
        return apiError(parsed.error.issues[0].message, 400, 'invalid_request');
      }
      ({ query: trimmedQuery, chatId } = parsed.data);
      const files = parsed.data.images;

      // Slika po SADRŽAJU (samo JPEG), bez metapodataka (EXIF, GPS). Odbijanje ne troši ledger (rezervacija je
      // kasnije); u audit ide razlog, bez slike i bez naziva fajla.
      const checked = inspectImages(await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer()))));
      if (!checked.ok) {
        const d = describeRejection(checked.rejection, 'image');
        if (d.audit) {
          const size = checked.index > 0 ? files[checked.index - 1].size : undefined;
          await logAudit(actor, 'document_upload_blocked', {
            ip,
            metadata: { ...d.audit, file_kind: 'image', context: 'chat_image', ...(size !== undefined ? { size_bytes: size } : {}) },
          });
        }
        return apiError(d.message, d.status, d.code);
      }
      images = checked.images;
    } else {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return apiError('Neispravan zahtev.', 400, 'invalid_request');
      }
      const parsed = chatRequestSchema.safeParse(body);
      if (!parsed.success) {
        return apiError(parsed.error.issues[0].message, 400, 'invalid_request');
      }
      ({ query: trimmedQuery, chatId } = parsed.data);
    }
    const imageTokens = images.reduce((sum, img) => sum + estimateImageTokens(img.width, img.height), 0);

    // 1. Čitanja pre rezervacije (korisnički klijent, RLS): vlasništvo razgovora i istorija.
    //    Istorija se šalje AI-ju pri svakom pitanju, pa je glavni deo procene tokena. Upisa još nema.
    let formattedHistory: { role: string; content: string }[] = [];

    if (chatId) {
      // RLS vraća samo korisnikove razgovore: tuđi razgovor izgleda isto kao nepostojeći (404).
      const { data: existingChat, error: chatCheckError } = await supabaseServer
        .from('chats')
        .select('id')
        .eq('id', chatId)
        .maybeSingle();

      if (chatCheckError) {
        console.error('Chat Check Error:', chatCheckError);
        return apiError('Greška pri proveri razgovora.', 500, 'chat_check_failed');
      }
      if (!existingChat) {
        return apiError('Razgovor nije pronađen.', 404, 'not_found');
      }

      // Učitavanje samo POSLEDNJIH N poruka iz baze
      const { data: historyRows, error: historyError } = await supabaseServer
        .from('messages')
        .select('role, content, created_at')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(MAX_HISTORY_MESSAGES);

      if (historyError) {
        console.error('History Load Error:', historyError);
        return apiError('Greška pri učitavanju istorije.', 500, 'history_failed');
      }

      formattedHistory = (historyRows || []).reverse().map((h) => ({
        role: h.role,
        content: h.content,
      }));
    }

    // 2. Atomska rezervacija (dnevni broj poruka, dnevni i mesečni budžet tokena). Fail-closed.
    //    Brisanje razgovora ne dira ledger, pa se brojač ne može resetovati.
    const reserved = await reserveUsage(
      actor,
      'chat',
      estimateChatTokens(trimmedQuery, formattedHistory.map((h) => h.content)) + imageTokens,
      ip
    );
    if (!reserved.ok) return reserved.errorResponse;
    reservation = { id: reserved.reservationId, userId: user.id };
    const limits = reserved.limits;

    // 3. Razgovor i poruka korisnika (upisi idu preko service_role, sa user_id iz verifikovanog korisnika)
    let activeChatId: string | undefined = chatId;

    if (!activeChatId) {
      const title = trimmedQuery.length > 50 ? trimmedQuery.slice(0, 50) + '…' : trimmedQuery;
      const { data: newChat, error: chatError } = await supabaseAdmin
        .from('chats')
        .insert({ title, user_id: user.id })
        .select('id')
        .single();

      if (chatError || !newChat) {
        console.error('Chat Create Error:', chatError);
        return apiError('Greška pri kreiranju razgovora.', 500, 'chat_create_failed');
      }
      activeChatId = newChat.id;
      await logAudit(actor, 'chat_created', { resourceType: 'chat', resourceId: newChat.id, ip });
    }

    const { error: userMsgError } = await supabaseAdmin
      .from('messages')
      // Slika se ne čuva: u istoriju ide samo oznaka „📷 N slika” i pitanje
      .insert({
        chat_id: activeChatId,
        user_id: user.id,
        role: 'user',
        content: images.length > 0 ? imageMessageContent(images.length, trimmedQuery) : trimmedQuery,
      });

    if (userMsgError) {
      console.error('User Message Save Error:', userMsgError);
      return apiError('Greška pri čuvanju poruke.', 500, 'message_save_failed');
    }

    // 4. Poziv Voyage AI uz Timeout zaštitu (15s)
    const voyageController = new AbortController();
    const voyageTimeout = setTimeout(() => voyageController.abort(), 15000);

    const voyageRes = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({ input: [trimmedQuery], model: 'voyage-law-2', input_type: 'query' }),
      signal: voyageController.signal,
    });

    clearTimeout(voyageTimeout);

    if (!voyageRes.ok) {
      const errText = await voyageRes.text();
      console.error('Voyage API Error:', errText);
      return apiError('Greška pri obradi pitanja na vektorskom servisu.', 500, 'embedding_failed');
    }

    const voyage = parseVoyageResponse(await voyageRes.json());
    if (!voyage) {
      console.error('Voyage API Error: neočekivan oblik odgovora');
      return apiError('Greška pri obradi pitanja na vektorskom servisu.', 500, 'embedding_failed');
    }
    // Vektorski servis je naplatio poziv: tokeni ostaju u budžetu čak i ako kasnije nešto padne
    spent.embed = voyage.tokens ?? estimateTokens(trimmedQuery);

    // 5. Pretraga po bazi: korisnika određuje auth.uid() iz JWT-a unutar funkcije, ne parametar
    const { data: chunks, error: searchError } = await supabaseServer.rpc(
      'match_document_chunks',
      {
        query_embedding: voyage.embedding,
        match_count: 8,
      }
    );

    if (searchError) {
      console.error('Supabase Search Error:', searchError);
      return apiError('Greška pri pretrazi baze.', 500, 'search_failed');
    }

    const sources: MatchedChunk[] = chunks || [];

    // Dokumenti su nepouzdani: buildRagContext escape-uje < i > i čisti naziv fajla
    const systemPrompt = buildSystemPrompt(buildRagContext(sources), { images: images.length });
    // Slike vidi samo ovo pitanje; istorija je tekst (odluka vlasnika)
    const claudeMessages: { role: string; content: string | ClaudeContentBlock[] }[] = [
      ...formattedHistory,
      { role: 'user', content: images.length > 0 ? buildImageUserContent(images, trimmedQuery) : trimmedQuery },
    ];

    // Zahtev ide na Claude: i ako se prekine (timeout, mreža), Anthropic je ulaz verovatno već obradio.
    // Procena ulaza zato ostaje u budžetu, da se dugi odgovori ne mogu "besplatno" ponavljati preko timeout-a.
    const estimatedInputTokens =
      estimateTokens(systemPrompt + formattedHistory.map((m) => m.content).join('') + trimmedQuery) + imageTokens;
    spent.input = estimatedInputTokens;

    // 6. Poziv Claude API uz Timeout zaštitu (35 s, sa slikama 40 s)
    const claudeController = new AbortController();
    const claudeTimeout = setTimeout(() => claudeController.abort(), images.length > 0 ? CLAUDE_IMAGES_TIMEOUT_MS : CLAUDE_TIMEOUT_MS);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: getClaudeModel(),
        max_tokens: CHAT_MAX_OUTPUT_TOKENS,
        system: systemPrompt,
        messages: claudeMessages,
      }),
      signal: claudeController.signal,
    });

    clearTimeout(claudeTimeout);

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Claude API Error:', errText);
      spent.input = undefined; // API je odbio zahtev bez obrade, pa nema potrošnje
      return apiError('Greška na AI servisu za generisanje odgovora.', 500, 'ai_service_error');
    }

    const claude = parseClaudeResponse(await claudeRes.json());
    if (!claude) {
      console.error('Claude API Error: neočekivan oblik odgovora');
      return apiError('Greška na AI servisu za generisanje odgovora.', 500, 'ai_service_error');
    }

    // Stvarna potrošnja iz odgovora. Ako API ne vrati brojeve, računa se procena (nula bi zaobišla budžet).
    const inputTokens = claude.inputTokens ?? estimatedInputTokens;
    const outputTokens = claude.outputTokens ?? estimateTokens(claude.answer);
    spent.input = inputTokens;
    spent.output = outputTokens;

    // Odbijen ili prazan odgovor: nema šta da se prikaže. Tokeni su potrošeni (ostaju u budžetu),
    // ali se pitanje ne broji u dnevni limit (finally zatvara rezervaciju kao release).
    if (!claude.answer.trim()) {
      console.error('Claude API Error: prazan odgovor, stop_reason =', claude.stopReason);
      return apiError(
        claude.stopReason === 'refusal'
          ? 'AI servis nije mogao da odgovori na ovo pitanje. Pokušajte da ga preformulišete.'
          : 'AI servis nije vratio odgovor. Pokušajte ponovo.',
        500,
        'ai_service_error'
      );
    }

    // 7. Zatvaranje rezervacije stvarnom potrošnjom
    await settleUsage(reservation.id, user.id, spent);
    closed = true;

    const { error: assistantMsgError } = await supabaseAdmin
      .from('messages')
      .insert({ chat_id: activeChatId, user_id: user.id, role: 'assistant', content: claude.answer });

    if (assistantMsgError) {
      console.error('Assistant Message Save Error:', assistantMsgError);
    }

    // 8. Audit: ko je pitao i koje je dokumente "pročitao" (samo ID-evi i brojevi, nikad tekst)
    await logAudit(actor, 'question_asked', {
      resourceType: 'chat',
      resourceId: activeChatId,
      ip,
      metadata: {
        document_ids: uniqueDocumentIds(sources),
        sources: sources.length,
        ...(images.length > 0 ? { images: images.length } : {}),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        embed_tokens: spent.embed,
      },
    });

    // 9. Stanje potrošnje za upozorenje u aplikaciji (80%). Ako ne uspe, odgovor ide bez njega.
    const { data: summaryRow, error: summaryError } = await supabaseServer.rpc('get_usage_summary');
    if (summaryError) console.error('Usage Summary Error:', summaryError);
    const summary = parseUsageSummary(summaryRow);

    return NextResponse.json({
      chatId: activeChatId,
      response: claude.answer,
      sources: sources.map((c) => ({ title: c.document_title, snippet: c.content.slice(0, 150) })),
      usage: summary ? clientUsage(usageStatus(summary, limits)) : undefined,
    });
  } catch (error) {
    console.error('Chat Exception:', error);
    return apiError('Interna greška prilikom obrade pitanja.', 500, 'internal_error');
  } finally {
    // Svaki neuspeh posle rezervacije: ne broji se u dnevni limit, a već potrošeni tokeni ostaju u budžetu
    if (reservation && !closed) {
      await releaseUsage(reservation.id, reservation.userId, spent);
    }
  }
}
