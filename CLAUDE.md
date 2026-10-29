@AGENTS.md

# Pravni AI asistent (RAG): Enterprise Security Roadmap

Next.js 16 + Supabase (Postgres + pgvector) + Voyage AI (`voyage-law-2`, 1024 dimenzije) + Claude.
Cilj je da se proizvod prodaje advokatskim kancelarijama kao B2B rešenje. Zahtevi su zero-trust arhitektura, zaštita poverljivosti klijenata (DLP) i usklađenost sa NDA ugovorima.

## Status faza

- [x] **FAZA 1: Supabase i baza (izolacija podataka). ZAVRŠENA (korisnik potvrdio 2026-10-28; E2E i isključenu registraciju nisam sam proverio).** Korak 1 (dijagnostika) urađen 2026-10-27 preko Supabase MCP-a (`.mcp.json`, `read_only=true`). **Migracija `supabase/migrations/20261027120000_phase1_data_isolation.sql` primenjena 2026-10-27** (SQL Editor, bez backup-a: Free plan, samo CSV izvoz). Kod (Korak 3) je spojen u `main` (`ef50a9c`) i push-ovan. Verifikovano: (1) `supabase/tests/phase1_rls_test.sql` prošao ("FAZA 1: svi RLS testovi prošli"); (2) napad spolja sa anon ključem: `GET` na `documents`, `chats`, `messages`, `document_chunks`, `profiles` vraća `42501`, stari RPC potpis `PGRST202`, novi RPC i `get_daily_message_count` `42501`; (3) Advisors Security: sa 7 upozorenja na 2 (ostaju `vector` u šemi `public` i isključena zaštita od procurelih lozinki); (4) `tsc`, lint (0 grešaka) i build prolaze, a `server-only` je proveren negativnim testom. **Preostaje za zatvaranje Faze 1:** E2E sa dva naloga (tačka 5 verifikacije) i isključivanje "Allow new users to sign up" u Dashboard-u (razlog: javni anon ključ omogućava da bilo ko napravi nalog direktno preko Auth API-ja, pa sakrivanje `/register` stranice ne štiti; advokate poziva admin). Rute vraćaju 404 umesto 403 za tuđe razgovore (tuđi izgleda isto kao nepostojeći).
- [x] **FAZA 2: Zaštita API ruta. ZAVRŠENA 2026-10-28 (kod, migracije, SQL testovi i Production smoke test verifikovani; nepreuzete stavke su navedene na kraju ove tačke).** Rate limiting + potrošnja tokena, prompt injection, zod validacija, audit log. Detaljan plan i odluke su u odeljku „FAZA 2” ispod (plan usaglašen sa korisnikom 2026-10-28, kroz 20 pitanja). **U toku na grani `phase2-api-protection`:** urađeni su zod za `/api/chat` i `chats/[chatId]/*`, ograda RAG konteksta (`lib/rag-context.ts`) i čišćenje zavisnosti (0 ranjivosti), spojeno u `main` (`c87bdf6`) posle testa na preview-u. Korak 2.0 urađen 2026-10-28. **2.1: migracija `20261028120000_phase2_usage_audit.sql` JE primenjena** (provereno preko MCP-a 2026-10-28: `usage_ledger`, `audit_log`, `profiles.role` i `pg_cron` postoje). Nije potvrđeno da je na Supabase-u pokrenut `supabase/tests/phase2_rls_test.sql`. **2.2 urađen na `main` (2026-10-28, nije commit-ovan):** `lib/limits.ts`, `lib/usage.ts`, `lib/audit.ts`, `lib/client-ip.ts`, `lib/prompt-safety.ts`, `lib/prompts.ts`, `lib/api-error.ts`, `ingestFormSchema` u `lib/validation.ts`, uz testove (30/30). `tsc` i lint su bez grešaka. Lokalni `next build` pada i na čistom `main`, jer lokalno nema `.env` sa `NEXT_PUBLIC_SUPABASE_*`. **2.3 urađen na `main` (2026-10-28, nije commit-ovan):** `/api/chat` radi na ledger-u (rezervacija, stvarni tokeni, audit `chat_created` i `question_asked`, prompt iz `lib/prompts.ts`, upozorenje na 80% u UI-ju), uz `lib/claude.ts` i migraciju `20261028130000_match_chunks_document_id.sql` (**još nije primenjena**, primeniti pre deploy-a; vidi „Rezultat 2.3”). `npm test` 53/53, `tsc`, lint i `next build` prolaze. **2.5 urađen na `main` (2026-10-28, nije commit-ovan):** `/api/ingest` radi na ledger-u (rezervacija, stvarni Voyage tokeni, dvostepeno upozorenje o sumnjivom sadržaju, audit `document_uploaded` i `suspicious_content_flagged`), uz `lib/ingest.ts`; `npm test` 70/70, `tsc`, lint i `next build` prolaze, ali ruta nije proverena na preview-u (vidi „Rezultat 2.5”). **2.6 urađen na `main` (2026-10-28, nije commit-ovan):** open redirect u `auth/callback` zatvoren (`lib/safe-redirect.ts`), `deleteDocument` proverava UUID, audit `chat_deleted` i `document_deleted`, sve `chats` rute vraćaju `{ error, code }`; `npm test` 77/77, `tsc`, lint i `next build` prolaze, ali rute nisu pokrenute (vidi „Rezultat 2.6”). **2.7 urađen na `main` (2026-10-28, nije commit-ovan):** stranica `/activity` (`app/activity/page.tsx`, `lib/activity.ts`, link u `Sidebar.tsx`); `npm test` 94/94, `tsc`, lint i `next build` prolaze, ali stranica nije otvorena u browseru niti proverena kao admin (vidi „Rezultat 2.7”). **2.8 urađen na `main` (2026-10-28, nije commit-ovan):** IP burst zaštita (Postgres brojač, 60 zahteva u minuti po IP adresi, `IP_BURST_LIMIT`) kao prvi korak u `/api/chat` i `/api/ingest`, fail-closed, IPv6 po /64, bez nove migracije (`lib/ip-burst.ts`, `enforceIpBurst` u `lib/usage.ts`); `npm test` 110/110, `tsc`, lint i `next build` prolaze, ali rute nisu pokrenute (vidi „Rezultat 2.8”). **2.9 urađen koliko može bez Supabase-a i preview-a (2026-10-28, nije commit-ovan):** automatske provere prolaze (`npm test` 110/110, `tsc`, lint 0 grešaka, `next build`, `npm audit` 0), a živa baza je proverena samo čitanjem. **FAZA 2 ZATVORENA 2026-10-28.** Primenjeno na živoj bazi (SQL Editor): popravka profila (3 od 3), `…130000` (drugi pokušaj, posle ispravke za `hnsw.iterative_scan`) i `…140000` (stari brojač uklonjen). `phase1_rls_test.sql` i `phase2_rls_test.sql` su prošli na pravoj bazi (izvršio korisnik, ispis potvrđen). **Production smoke test (izveo korisnik, redove u bazi proverio Claude):** pitanje daje `usage_ledger` `chat/settled` sa stvarnim tokenima i audit `chat_created` + `question_asked` sa `document_ids` (samo ID-evi izvora, bez teksta); otpremanje PDF-a daje `ingest/settled` sa `embed_tokens` 7436, 18 pasusa i audit `document_uploaded`. Advisors Security posle svih migracija: bez novih upozorenja (ostaju `vector` u šemi `public`, isključena zaštita od procurelih lozinki i namerni INFO za `ip_rate_limit`). **Nije proveravano i prenosi se (obavezno pre prvog pilota):** (1) preview provere sa spuštenim limitima iz „Rezultat” 2.3, 2.5, 2.6, 2.8 (429 `limit_reached` za poruke i dokumente, `IP_BURST_LIMIT`, upozorenje o sumnjivom sadržaju, brisanje + audit, open redirect); (2) `/activity` kao admin (u bazi nema korisnika sa ulogom `admin`); (3) Dashboard: Authentication → Rate Limits, „Allow new users to sign up” = OFF (nasleđeno iz Faze 1) i zaštita od procurelih lozinki (Advisors je i dalje prijavljuje, pa nije uključena ili je plan ne dozvoljava); (4) env varijable na Vercelu. Faza 2.5 sme da počne.
- [ ] **FAZA 2.5: Admin panel za vlasnika kancelarije.** Plan u `docs/admin-panel-plan.md` (usaglašen 2026-10-28, kroz 10 pitanja). Faza 2 je zatvorena, rad je počeo 2026-10-28. **2.5.1 urađen i PRIMENJEN na Supabase-u 2026-10-28 (admin i phase1 test prošli, Advisors bez neočekivanog; rezultat izmenjenog `phase2_rls_test.sql` nije potvrđen):** migracija `20261028150000_phase25_admin.sql` i `supabase/tests/phase25_admin_test.sql`; test-prvo (crveno pa zeleno), 16 mutacija migracije obara test, `phase1`/`phase2` testovi prolaze pre i posle (detalji u „Rezultat 2.5.1” u planu); `phase2_rls_test.sql` izmenjen (admin C sa `aal2`). **2.5.2 urađen i commit-ovan (`2fd9840`):** `lib/csv.ts`, `lib/admin-access.ts`, `lib/require-admin.ts`, zod šeme za poziv/ulogu/podešavanja, `effectiveLimits` (`min(podešavanje, env)`, `lib/usage.ts` čita `office_settings`), nove admin akcije u audit logu i `/activity`; izmena `/api/chat` još nije potvrđena na produkciji (u `usage_ledger` nema reda novijeg od tog commit-a); `auditFilterSchema` ide u 2.5.7. **2.5.3 urađen (2026-10-28, commit-ovan u `a505cd5`; vlasnik je 2026-10-29 potvrdio na produkciji da QR i unos koda rade, u bazi je zapis `mfa_enrolled`; chat posle izmena iz 2.5.2 i 2.5.3 još nije potvrđen: u `usage_ledger` nema reda posle 2026-10-28 14:57):** MFA kapija u `proxy.ts` i `requireUser()` (nalog sa potvrđenim faktorom, a bez unetog koda, dobija preusmerenje na `/login/mfa`, a API i server akcije 401 `mfa_required`), stranice `/login/mfa` i `/account/security`, audit `mfa_enrolled` preko server akcije, čista logika u `lib/mfa-gate.ts` i `lib/mfa-code.ts`; `npm test` 176/176, `tsc`, lint (0 grešaka), `next build` i `npm audit` prolaze; kapija je probana na pravom `next start` sa lažnim Auth serverom (50 provera, sve prolaze), ali **QR i unos koda u browseru i pravi Supabase NISU probani** (detalji, odluke i nalaz u „Rezultat 2.5.3” u planu). **Poznata rupa (traži odluku vlasnika):** MFA štiti aplikaciju, ne i direktan REST pristup bazi sa lozinkom (`aal1`), jer RLS za advokate ne traži `aal2`; predlog je posebna migracija. **2.5.4 urađen (2026-10-28, commit-ovan u `4316a87`; da radi na produkciji nije potvrđeno):** `/auth/confirm` (`verifyOtp`, samo vrste `invite` i `recovery`, `next` samo na naš sajt), `/set-password`, `/link-expired`, zajednička forma za lozinku (najmanje 12 znakova, i na `/reset-password`), pravilo javnih putanja u `lib/route-access.ts`; `/register` obrisana (i dva dugmeta ka njoj na početnoj stranici). Test-prvo, `npm test` 207/207, 26 namernih grešaka uhvaćeno, `tsc`, lint (0 grešaka), `next build` i `npm audit` prolaze; ruta i `proxy.ts` probani na pravom `next start` sa lažnim Auth serverom (29 provera). **Nije viđeno:** pravi Supabase, mejl, forma u browseru, reset lozinke za nalog sa MFA. Forma traži 12 znakova, ali jedino Supabase podešavanje „Minimum password length” to primorava (`docs/next-steps.md`, B9). Tekst email šablona: `docs/email-templates.md` (šabloni se menjaju TEK posle deploy-a). **2.5.5 urađen (2026-10-28, commit-ovan u `01d79e5`; vlasnik je 2026-10-29 ušao u `/admin` kao admin sa MFA na produkciji):** `/admin` (Pregled: nalozi, potrošnja, advokati blizu limita) sa layout-om i navigacijom; pristup proveravaju layout I svaka stranica (`lib/admin-page.ts`, jer se layout ne izvršava ponovo pri navigaciji), advokat dobija 404, admin bez koda ide na unos koda ili uključivanje MFA. Panel NEMA `metadata` (naslov taba bi otkrio da postoji; važi i za 2.5.6 do 2.5.8). Čista logika u `lib/admin-overview.ts`; test-prvo, `npm test` 231/231, 25 namernih grešaka uhvaćeno, `tsc`, lint (0 grešaka), `next build` i `npm audit` prolaze; probano na pravom `next start` sa lažnim Auth i REST serverom (27 provera). Pravi Supabase, pravi `aal2` token i MFA tok potvrdio je vlasnik ulaskom u panel; izgled stranica nisam video; link u Sidebar-u stiže tek u 2.5.9. **2.5.6 urađen (2026-10-29, commit-ovan i push-ovan u `55cd533`; migracija `20261029100000_phase256_user_blocking.sql` PRIMENJENA na Supabase-u 2026-10-29: `phase256_users_test.sql` prošao na pravoj bazi, Advisors tačno 5 očekivanih upozorenja za `admin_*` i 2 stara, stanje baze (kolona, okidač, `is_admin`, grantovi, nema ostataka testa) proverio Claude preko MCP-a; rezultat `phase25`, `phase2` i `phase1` testova posle migracije vlasnik nije prijavio):** `/admin/users` (tabela, forma za poziv, traka potrošnje) i `/admin/users/<id>` (nazivi i datumi, bez sadržaja, svako otvaranje upisuje `admin_viewed_user`), akcije `inviteLawyer`, `resendInvite`, `disableLawyer`, `enableLawyer`, `setRole` u `app/admin/actions.ts` (svaka počinje sa `requireAdminAction()`: admin + nalog nije blokiran + `aal2`). **Blokada:** nije utvrđeno da `getUser()` odbija blokiranog korisnika sa još važećim tokenom (pravi nalog nisam smeo da blokiram), pa je dodata `profiles.disabled_at`; `requireUser()` odbija nalog ako je `banned_until` aktivan ILI je `disabled_at` postavljen (403 `account_blocked`; greška čitanja profila je 503, zatvoreno pravilo). Migracija još: `private.is_admin()` isključuje blokirane, okidač „bar jedan admin" broji samo aktivne i okida se i na `disabled_at`, `admin_list_users` / `admin_get_user` vraćaju `disabled_at`, nova `admin_set_disabled` (audit u istoj transakciji). Redosled radnji: baza prva, pa Auth ban. Kvota poziva je 20 u kliznih 24 sata. Test-prvo: `npm test` 263/263, SQL test na lokalnoj bazi (PGlite) sa 16 namernih grešaka u migraciji uhvaćenih, 71 provera na pravom `next start` sa lažnim Supabase-om uključujući pozivanje server akcija (od 8 namernih grešaka u kodu aplikacije jedna je preživela dok nije dodata provera admina bez MFA), `tsc`, lint (0 grešaka), `next build`, `npm audit` 0. **Nije viđeno:** ništa iz 2.5.6 na produkciji (2026-10-29 15:20 UTC u bazi nema zapisa `admin_viewed_user`, `user_disabled` ni `user_invited`), izgled u browseru, pravi mejl / SMTP, `/api/chat` na produkciji posle izmena 2.5.2 do 2.5.6 (poslednji red u `usage_ledger` je od 2026-10-28 14:57). **Poznata rupa (traži odluku, `docs/next-steps.md` C8):** blokiran advokat sa važećim tokenom može preko REST-a da čita svoje redove do isteka tokena. Redosled puštanja (migracija, 4 SQL testa, Advisors, pa push) i detalji su u „Rezultat 2.5.6" u planu. **2.5.7 i 2.5.8 urađeni (2026-10-29, na `main`, nije commit-ovano, NIJE na produkciji; migracija NIJE potrebna: baza već ima sve, provereno preko MCP-a):** `/admin/activity` (filteri advokat / vrsta / period u beogradskim datumima do 90 dana, podrazumevano 7; 50 po strani, paginacija po kursoru `(created_at, id)` sa mikrosekundama), `GET /api/admin/audit/export` (CSV sa `;`, UTF-8 sa BOM-om, strim, najviše 50.000 redova, `audit_exported` se upisuje PRE slanja i zatvoreno, zahtev sa tuđeg sajta se odbija), `/admin/settings` + akcija `updateSettings` (preko `admin_update_settings`, iste vrednosti se ne snimaju, granica iz env-a se prikazuje); `auditFilterSchema` je fabrika `createAuditFilterSchema(now)` u `lib/audit-filter.ts`. `npm test` 334/334 (bilo 263), `tsc`, lint (0 grešaka), `next build` i `npm audit` prolaze; **proba na pravom `next start` sa lažnim Supabase-om: 129 provera, sve prolaze**; 43 mutacije čiste logike (42 uhvaćeno, 1 dokazano ekvivalentna) i 18 mutacija povezivanja (sve uhvaćene). Proba i mutacije su sačuvane u `tools/verify/` (bez zavisnosti, van lint/tsc/build opsega). **Nije viđeno:** pravi Supabase REST (`or=(…)` filter sa vremenima pod navodnicima, `max_rows`, `count=exact`), Vercel strimovanje, izgled u browseru, otvaranje CSV-a u Excel-u, `Sec-Fetch-Site` iz pravog pregledača; paginacija na produkciji ne može da se isproba (u bazi je 8 zapisa). **Chat na produkciji i dalje nije potvrđen** (poslednji red u `usage_ledger` je od 2026-10-28 14:57). Sledi 2.5.9, 2.5.10. **Predlog koji čeka odluku vlasnika (C6, C7, C8 u `docs/next-steps.md`):** posle 2.5.10 i pre Faze 3 migracija „2.5.11" koja u bazi traži `aal2` za naloge sa MFA i da nalog nije blokiran (restriktivne polise na svim tabelama), uz audit za uklanjanje MFA faktora i odluku da li je MFA obavezan i za advokate. **Šta dalje, korak po korak (šta radi vlasnik, šta Claude): `docs/next-steps.md`.** Radi se samo na `main`, bez novih grana. Ukratko: poziv advokata emailom, blokada umesto brisanja, admin vidi nazive i datume (ne sadržaj) preko uskih RPC funkcija, globalni limiti (env je gornja granica), audit log sa CSV izvozom, više admina (bar jedan uvek), obavezan MFA (`aal2`) za admina.
- [ ] **FAZA 3: Bezbednost fajlova.** PDF/Word, malware, makroi. Prioritet odmah posle Faze 2.
- [ ] **FAZA 4: Isporuka kancelariji.** Poseban Vercel + Supabase projekat po kancelariji (silo). **Docker/on-prem je odbačen** (odluka korisnika 2026-10-28).

Pravilo: faze idu redom. Sledeća faza počinje tek kada je prethodna završena i verifikovana.

## Arhitektonske odluke

- **Izolacija po advokatu.** Svaki advokat (korisnik) vidi isključivo svoje dokumente, pasuse, razgovore i poruke.
- **Jedan Supabase projekat (ili on-prem instanca) po kancelariji (silo).** Granicu između firmi čuva infrastruktura, a granicu između advokata čuva RLS.
- **Postojeći podaci se čuvaju.** Migracije ne brišu podatke, osim siročića (pasusa i poruka bez roditelja).
- **Hibridni pristup bazi.** Čitanja idu preko korisnikovog JWT-a (RLS ih ograničava). Upisi idu preko `service_role`, a kompozitni FK u bazi čuva vlasništvo.
- **Javna registracija je isključena.** Advokate poziva admin kancelarije (Supabase Auth → „Allow new users to sign up” = OFF).

## Trajna bezbednosna pravila (obavezna za svaki novi kod)

Pravila 1-4 važe od kada je Faza 1 primenjena.

1. Korisnički podaci se **čitaju isključivo** preko korisničkog klijenta (`createClient` iz `lib/supabase/server.ts`, odnosno `requireUser().supabase`), nikad preko `supabaseAdmin`.
2. `supabaseAdmin` služi samo za upise. Uvek se postavlja `user_id: user.id` iz verifikovanog korisnika, nikad iz zahteva.
3. Svaka nova tabela dobija `enable row level security`, polise sa `(select auth.uid())` i eksplicitne grantove. Uloga `anon` ne dobija ništa.
4. RPC funkcije nikad ne primaju `user_id` kao parametar, već koriste `auth.uid()`. Uz to: `security invoker`, `set search_path` i `revoke execute ... from public, anon`.
5. Šema se menja **samo** kroz `supabase/migrations/<timestamp>_<ime>.sql`, a ne ručno u dashboard-u.
6. Posle svake promene baze pokrenuti RLS test (`supabase/tests/`) i Supabase Dashboard → Advisors → Security.
7. `lib/supabase.ts` (service_role) mora imati `import 'server-only';`.

---

# FAZA 1: Izolacija podataka (Supabase RLS)

## Nalazi revizije

| # | Ozbiljnost | Nalaz | Gde |
|---|---|---|---|
| F1 | **KRITIČNO (uslovno)** | `match_document_chunks` prima `filter_user_id` kao parametar. Anon ključ je javan (`NEXT_PUBLIC_…`, nalazi se u JS bundle-u). Postgres podrazumevano daje EXECUTE pravo ulozi PUBLIC. Ako funkcija nije zaključana, bilo ko može da pozove `POST /rest/v1/rpc/match_document_chunks` sa tuđim UUID-om i bilo kojim vektorom od 1024 dimenzije i dobije tuđe pasuse. | `app/api/chat/route.ts:142-149` |
| F2 | **VISOKO** | Skoro sve rute koriste `service_role` ključ, koji zaobilazi RLS. Izolacija zavisi isključivo od ručno napisanih provera `.eq('user_id')` i `chat.user_id !== user.id`. Dovoljna je jedna zaboravljena provera pa da podaci procure. To nije zero-trust. | `lib/supabase.ts:11`, `chat`, `chats/*`, `ingest` |
| F3 | **VISOKO** | Šema, RLS polise i funkcije ne postoje u repou. Ne može se dokazati klijentu (due diligence) šta štiti podatke, a ne može se ni reprodukovati za on-prem (Faza 4). | nema `supabase/` foldera |
| F4 | SREDNJE | `document_chunks` i `messages` nemaju `user_id`. Vlasništvo se izvodi samo preko roditelja u kodu, a baza ne sprečava upis pasusa u tuđi dokument. | `app/api/ingest/route.ts:110-114`, `app/api/chat/route.ts:107-109` |
| F5 | SREDNJE | `get_daily_message_count(input_user_id)` ima isti obrazac kao F1. Curi metapodatak (koliko neko koristi sistem). | `lib/check-rate-limit.ts:8` |
| F6 | NISKO | Brisanje razgovora ide u dva odvojena poziva (prvo poruke, pa razgovor), što znači da nema `ON DELETE CASCADE`. Ako drugi korak padne, ostaju siročići. | `app/api/chats/[chatId]/route.ts:40-51` |
| F7 | NISKO | Supabase podrazumevano automatski izlaže svaku novu tabelu i funkciju u `public` ulogama `anon` i `authenticated`. Nova tabela bez RLS-a odmah je javna. | podešavanje baze |

## Arhitektura zaštite (defense in depth)

1. **anon** nema nikakva prava na tabele i RPC funkcije. Direktan napad preko REST API-ja vraća `42501 permission denied`.
2. **authenticated** sme samo `SELECT` i `DELETE` sopstvenih redova (RLS sa `(select auth.uid())`). Nema `INSERT`/`UPDATE`, pa korisnik svojim tokenom ne može da podmetne lažne „assistant” poruke ni da zaobiđe MAX_CHUNKS.
3. **Upisi (service_role)** prolaze kroz kompozitni FK `(document_id, user_id) → documents(id, user_id)` i `(chat_id, user_id) → chats(id, user_id)`. Čak ni bug u serverskom kodu ne može da upiše pasus ili poruku pod tuđeg vlasnika.
4. **Vektorska pretraga** određuje korisnika iz JWT-a (`auth.uid()`), a ne iz parametra. Funkcija je `SECURITY INVOKER`, pa se na nju primenjuje RLS.
5. **Zero-trust podrazumevano:** buduće tabele i funkcije nisu automatski izložene.

## Korak 0: Backup

- Pro plan: Dashboard → Database → Backups (proveri da postoji današnji).
- Free plan: `npx supabase db dump --db-url "<connection string>" -f backup_schema.sql`, pa isto još jednom sa `--data-only -f backup_data.sql`.

## Korak 1: Dijagnostika (samo čita, ništa ne menja)

Fajl: `supabase/diagnostics/phase1_audit.sql`. Pokreće se u Supabase SQL Editoru, a ceo JSON rezultat se šalje Claude-u. Na osnovu njega se prilagođava migracija: šema pgvector-a (`public` ili `extensions`), tipovi ID kolona, nazivi postojećih FK, HNSW indeks, realtime i eventualne druge funkcije izložene ulozi anon.

```sql
-- SAMO ČITANJE. Pokreni u Supabase SQL Editoru i pošalji ceo JSON rezultat.
select jsonb_pretty(jsonb_build_object(
  'columns', (
    select jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name, 'type', udt_name,
                                        'nullable', is_nullable, 'default', column_default)
                     order by table_name, ordinal_position)
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('documents', 'document_chunks', 'chats', 'messages')),
  'rls', (
    select jsonb_agg(jsonb_build_object('table', relname, 'enabled', relrowsecurity, 'forced', relforcerowsecurity))
    from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'),
  'policies', (
    select jsonb_agg(jsonb_build_object('table', tablename, 'name', policyname, 'cmd', cmd,
                                        'roles', roles, 'using', qual, 'check', with_check))
    from pg_policies where schemaname = 'public'),
  'constraints', (
    select jsonb_agg(jsonb_build_object('table', conrelid::regclass::text, 'name', conname,
                                        'def', pg_get_constraintdef(oid)))
    from pg_constraint where connamespace = 'public'::regnamespace),
  'functions', (
    select jsonb_agg(jsonb_build_object('signature', p.oid::regprocedure::text,
                                        'security_definer', p.prosecdef,
                                        'config', p.proconfig,
                                        'anon_can_execute', has_function_privilege('anon', p.oid, 'execute'),
                                        'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'execute'),
                                        'definition', pg_get_functiondef(p.oid)))
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and not exists (select 1 from pg_depend dep where dep.objid = p.oid and dep.deptype = 'e')),
  'table_grants', (
    select jsonb_agg(jsonb_build_object('role', grantee, 'table', table_name, 'privilege', privilege_type))
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')),
  'indexes', (
    select jsonb_agg(jsonb_build_object('table', tablename, 'def', indexdef))
    from pg_indexes where schemaname = 'public'),
  'pgvector', (
    select jsonb_build_object('version', extversion, 'schema', extnamespace::regnamespace::text)
    from pg_extension where extname = 'vector'),
  'realtime_tables', (
    select jsonb_agg(tablename) from pg_publication_tables where pubname = 'supabase_realtime'),
  'counts', jsonb_build_object(
    'documents', (select count(*) from public.documents),
    'document_chunks', (select count(*) from public.document_chunks),
    'chats', (select count(*) from public.chats),
    'messages', (select count(*) from public.messages),
    'documents_without_owner', (select count(*) from public.documents where user_id is null),
    'chats_without_owner', (select count(*) from public.chats where user_id is null),
    'documents_with_deleted_owner', (select count(*) from public.documents d
                                     where not exists (select 1 from auth.users u where u.id = d.user_id)),
    'chats_with_deleted_owner', (select count(*) from public.chats ch
                                 where not exists (select 1 from auth.users u where u.id = ch.user_id)),
    'orphan_chunks', (select count(*) from public.document_chunks c
                      where not exists (select 1 from public.documents d where d.id = c.document_id)),
    'orphan_messages', (select count(*) from public.messages m
                        where not exists (select 1 from public.chats ch where ch.id = m.chat_id)))
)) as phase1_audit;
```

## Korak 2: Migracija

Fajl: `supabase/migrations/20261027120000_phase1_data_isolation.sql`. Izvršava se kao jedna transakcija: ili prođe cela, ili se ništa ne menja. **Ovo je nacrt.** Tipovi i linije označene sa USLOVNO potvrđuju se posle dijagnostike (Korak 1).

```sql
-- FAZA 1: izolacija podataka po advokatu (RLS + kompozitni FK + zaključani RPC).
-- Sve ili ništa: ako bilo koji korak padne, baza ostaje netaknuta.
begin;

-- 1. Siročići: pasusi/poruke čiji roditelj više ne postoji (zaostali poverljivi podaci).
delete from public.document_chunks c
where not exists (select 1 from public.documents d where d.id = c.document_id);

delete from public.messages m
where not exists (select 1 from public.chats ch where ch.id = m.chat_id);

-- 2. Vlasnik je obavezan. Ako postoji red bez vlasnika, migracija namerno puca.
alter table public.documents alter column user_id set not null;
alter table public.chats     alter column user_id set not null;

-- Brisanje naloga advokata NE briše njegove spise (RESTRICT): to mora biti svesna odluka.
alter table public.documents drop constraint if exists documents_user_id_fkey;
alter table public.documents add constraint documents_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete restrict;
alter table public.chats drop constraint if exists chats_user_id_fkey;
alter table public.chats add constraint chats_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete restrict;

-- 3. Ciljni ključevi za kompozitne FK.
alter table public.documents add constraint documents_id_user_id_key unique (id, user_id);
alter table public.chats     add constraint chats_id_user_id_key     unique (id, user_id);

-- 4. user_id na decu + popuna iz roditelja.
alter table public.document_chunks add column if not exists user_id uuid;
update public.document_chunks c set user_id = d.user_id
from public.documents d
where d.id = c.document_id and c.user_id is distinct from d.user_id;
alter table public.document_chunks alter column user_id set not null;

alter table public.messages add column if not exists user_id uuid;
update public.messages m set user_id = ch.user_id
from public.chats ch
where ch.id = m.chat_id and m.user_id is distinct from ch.user_id;
alter table public.messages alter column user_id set not null;

-- 5. Kompozitni FK: pasus/poruka MORA imati istog vlasnika kao roditelj.
--    Stari jednostruki FK (bez obzira na ime) zamenjujemo novim, sa kaskadnim brisanjem.
do $$
declare r record;
begin
  for r in
    select conrelid::regclass as tbl, conname from pg_constraint
    where contype = 'f'
      and ((conrelid = 'public.document_chunks'::regclass and confrelid = 'public.documents'::regclass)
        or (conrelid = 'public.messages'::regclass and confrelid = 'public.chats'::regclass))
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.document_chunks add constraint document_chunks_owner_fkey
  foreign key (document_id, user_id) references public.documents (id, user_id)
  on update cascade on delete cascade;
alter table public.messages add constraint messages_owner_fkey
  foreign key (chat_id, user_id) references public.chats (id, user_id)
  on update cascade on delete cascade;

-- 6. Indeksi za RLS filtere i kaskadno brisanje.
create index if not exists documents_user_id_created_at_idx on public.documents (user_id, created_at desc);
create index if not exists chats_user_id_created_at_idx     on public.chats (user_id, created_at desc);
create index if not exists document_chunks_owner_idx        on public.document_chunks (document_id, user_id);
create index if not exists document_chunks_user_id_idx      on public.document_chunks (user_id);
create index if not exists messages_owner_created_at_idx    on public.messages (chat_id, user_id, created_at);
create index if not exists messages_user_id_created_at_idx  on public.messages (user_id, created_at);

-- 7. RLS uključen; brišemo SVE stare polise da ne ostane neka "permissive" rupa.
alter table public.documents       enable row level security;
alter table public.document_chunks enable row level security;
alter table public.chats           enable row level security;
alter table public.messages        enable row level security;

do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('documents', 'document_chunks', 'chats', 'messages')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 8. Polise: advokat čita i briše ISKLJUČIVO svoje redove.
--    INSERT/UPDATE polisa namerno nema: upisuje samo server, a vlasništvo čuva kompozitni FK.
create policy documents_select_own on public.documents
  for select to authenticated using (user_id = (select auth.uid()));
create policy documents_delete_own on public.documents
  for delete to authenticated using (user_id = (select auth.uid()));

create policy document_chunks_select_own on public.document_chunks
  for select to authenticated using (user_id = (select auth.uid()));

create policy chats_select_own on public.chats
  for select to authenticated using (user_id = (select auth.uid()));
create policy chats_delete_own on public.chats
  for delete to authenticated using (user_id = (select auth.uid()));

create policy messages_select_own on public.messages
  for select to authenticated using (user_id = (select auth.uid()));

-- 9. Privilegije: anon NEMA NIŠTA; authenticated samo ono što polise pokrivaju.
revoke all on public.documents, public.document_chunks, public.chats, public.messages
  from public, anon, authenticated;
grant select, delete on public.documents, public.chats to authenticated;
grant select on public.document_chunks, public.messages to authenticated;

-- 10. Vektorska pretraga: korisnik se određuje iz JWT-a, NE iz parametra.
do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
           where proname = 'match_document_chunks' and pronamespace = 'public'::regnamespace
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

create function public.match_document_chunks(
  query_embedding vector(1024),
  match_count integer default 8
)
returns table (document_title text, content text, similarity double precision)
language sql
stable
security invoker
set search_path = public, extensions
-- USLOVNO (ako je pgvector >= 0.8 i postoji HNSW indeks): set hnsw.iterative_scan = 'strict_order'
as $$
  select d.title::text,
         c.content::text,
         1 - (c.embedding <=> query_embedding)
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.user_id = (select auth.uid())
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke execute on function public.match_document_chunks(vector, integer) from public, anon;
grant execute on function public.match_document_chunks(vector, integer) to authenticated;

-- 11. Brojač poruka za rate limit: dozvoljen samo serveru (service_role).
do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
           where proname = 'get_daily_message_count' and pronamespace = 'public'::regnamespace
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- 12. Zero-trust podrazumevano: nove tabele/funkcije u public NISU automatski izložene API-ju.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;

-- USLOVNO (ako dijagnostika pokaže da su u realtime publikaciji):
-- alter publication supabase_realtime drop table public.documents, public.document_chunks, public.chats, public.messages;

commit;
```

## Korak 3: Izmene koda (hibrid)

- **`lib/supabase.ts`:** dodati `import 'server-only';` na vrh. Next 16 to podržava bez instalacije paketa (`node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`). Build pada ako `service_role` ikada završi u klijentskom kodu.
- **`lib/require-user.ts`:** pored `user` vraća i `supabase` (korisnički klijent iz `lib/supabase/server.ts`), da bi ga rute koristile za RLS čitanja.
- **`app/api/chat/route.ts`:**
  - Provera vlasništva razgovora (65-73) ide preko `supabaseServer`: `.select('id').eq('id', activeChatId).maybeSingle()`. Ako nema reda, vraća se 404 „Razgovor nije pronađen.” Tuđi razgovor tako izgleda isto kao nepostojeći.
  - Istorija poruka (90-95) se čita preko `supabaseServer`.
  - Upisi poruka (107-109, 197-199) ostaju na `supabaseAdmin`, ali se dodaje `user_id: user.id`.
  - RPC (142-149) ide preko `supabaseServer.rpc('match_document_chunks', { query_embedding, match_count: 8 })`, bez `filter_user_id`.
- **`app/api/ingest/route.ts`:** u `insertData` (110-114) dodati `user_id: user.id`. Rollback (135) dobija `.eq('user_id', user.id)`.
- **`app/api/chats/route.ts`:** čitanje ide preko `supabase` iz `requireUser()`. `.eq('user_id')` ostaje kao drugi pojas zaštite.
- **`app/api/chats/[chatId]/route.ts`:** sve se zamenjuje jednim pozivom `supabase.from('chats').delete().eq('id', chatId).select('id')`. Prazan rezultat vraća 404, a poruke briše `ON DELETE CASCADE`. `supabaseAdmin` se uklanja.
- **`app/api/chats/[chatId]/messages/route.ts`:** oba upita idu preko korisničkog klijenta. `supabaseAdmin` se uklanja.
- **Bez izmena:** `app/actions/documents.ts` (već koristi RLS klijent) i `lib/check-rate-limit.ts` (ostaje na service_role, prepravlja se u Fazi 2).

## Korak 4: Puštanje u rad (redosled je bitan)

Stari kod šalje `filter_user_id` i ne upisuje `user_id`, pa između migracije i deploy-a chat ne radi oko 1-2 minuta. Redosled:
1. Kod pripremiti na grani i proveriti da build prolazi.
2. U mirnom periodu pokrenuti migraciju.
3. Odmah deploy-ovati kod.
4. Pokrenuti testove (ispod).

Podešavanje Auth-a (dashboard, bez koda): isključiti javnu registraciju (Authentication → Sign In / Providers → „Allow new users to sign up” = OFF).

## Verifikacija Faze 1

1. **SQL test izolacije** (`supabase/tests/phase1_rls_test.sql`, sve se poništava sa `rollback`). Test sam pravi dva privremena korisnika (A i B) sa dokumentima, pasusima, razgovorima i porukama unutar transakcije, pa ne zavisi od stvarnih naloga (u bazi je trenutno 0 dokumenata, pa "dva stvarna korisnika" ne bi imala šta da testiraju). Test se predstavlja kao A (`set local role authenticated` + `request.jwt.claims`) i proverava:
   - broj vidljivih redova u sve 4 tabele jednak je broju A-ovih redova (nema curenja, a RLS nije ni prestrog);
   - `match_document_chunks(array_fill(0.01::real, array[1024])::vector, 20)` vraća samo A-ove naslove;
   - `insert into public.messages (content) …` pada sa `insufficient_privilege`;
   - `get_daily_message_count` pada za `authenticated`;
   - kao `anon`: `select` iz `documents` i poziv `match_document_chunks` padaju sa `insufficient_privilege`.

   Na kraju se ispisuje „FAZA 1: svi RLS testovi prošli”. Ako bilo šta procuri, skripta puca sa `CURENJE: …`.
2. **Napad spolja (curl sa anon ključem):**
   - `GET /rest/v1/documents?select=*` → očekuje se `42501 permission denied`;
   - `POST /rest/v1/rpc/match_document_chunks` sa starim `filter_user_id` → očekuje se `PGRST202`/`42501`.
3. **Supabase Dashboard → Advisors → Security:** nema upozorenja „RLS disabled”, „function search_path mutable” ni „security definer” za ove objekte.
4. **`npm run lint` i `npm run build`** prolaze.
5. **E2E sa dva naloga** (običan i incognito prozor):
   - A otpremi PDF i pita nešto;
   - B postavi pitanje o sadržaju A-ovog dokumenta → bez izvora;
   - B pozove `GET /api/chats/<A chatId>/messages` i `DELETE /api/chats/<A chatId>` → oba vraćaju 404;
   - A obriše dokument → SQL pokazuje 0 njegovih pasusa;
   - dnevni limit od 40 poruka i dalje radi.
6. **Commit** svih SQL fajlova u `supabase/`, da šema i polise budu verzionisani.

## Fajlovi Faze 1

- Novi: `supabase/diagnostics/phase1_audit.sql`, `supabase/migrations/20261027120000_phase1_data_isolation.sql`, `supabase/tests/phase1_rls_test.sql`.
- Menjaju se: `lib/supabase.ts`, `lib/require-user.ts`, `app/api/chat/route.ts`, `app/api/ingest/route.ts`, `app/api/chats/route.ts`, `app/api/chats/[chatId]/route.ts`, `app/api/chats/[chatId]/messages/route.ts`.

---

# FAZA 2: Zaštita Next.js API ruta (sledeća)

Opseg: rate limiting i potrošnja tokena, zaštita od prompt injection napada, validacija ulaza (zod), audit log.

## Odluke korisnika (20 pitanja, 2026-10-28)

| Tema | Odluka |
|---|---|
| Stanje prodaje | Nema kupca još. Grade se temelji pre prvog pilota. |
| Prioritet unutar Faze 2 | 1. rate limit i potrošnja, 2. prompt injection, 3. audit log, 4. zod (zod ide uz svaku rutu koja se dira). |
| Merenje potrošnje | Tokeni (Claude ulaz+izlaz, Voyage), dnevno i mesečno, plus dnevni broj poruka. |
| Limit pitanja | **100 poruka dnevno** po advokatu. |
| Limit dokumenata | **20 dokumenata dnevno** po advokatu. |
| Čuvanje brojača | **Postgres tabela** (usage ledger), bez Redis-a (nema novog spoljnog servisa). |
| Burst zaštita | Po **IP adresi**. |
| Kad se dostigne limit | Upozorenje u aplikaciji na **80%**, blokada (429) na 100%. |
| Odbrana od prompt injection | **Ograda + čišćenje** (bez drugog LLM-a). Izvor dokumenata je mešan (zakoni, spisi, tuđi dokumenti), pa se SVE tretira kao nepouzdano. |
| Sumnjiv sadržaj pri otpremanju | **Upozoriti korisnika**, on odlučuje da li da nastavi (laka detekcija obrazaca, bez dodatnog LLM poziva). |
| Znanje van izvora | Ostaje: sme uz jasnu napomenu da nije iz literature. |
| Audit log: šta | **Akcije bez sadržaja** (ko, kada, šta, ID-evi). Nikad tekst pitanja, odgovora ni dokumenata. |
| Audit log: ko čita | Advokat vidi **svoje** zapise, **admin kancelarije vidi sve**. |
| Audit log: čuvanje | **90 dana**, posle toga automatsko brisanje. |
| Zod | **Sve API rute**, poruke na srpskom, jedinstven oblik greške. |
| Uloge | **Uloga `admin` / `lawyer` u bazi** (profili). Admin pozivanje advokata ostaje u Dashboard-u. |
| Ime asistenta | Neutralan prompt, bez „ko te je napravio” i šala. |
| Posle Faze 2 | Faza 3 (bezbednost fajlova). |

## Plan rada (redosled je bitan)

Radi se na grani `phase2-api-protection`. Posle svakog koraka: `tsc`, lint, build, `npm test`, pa commit, push i test na Vercel preview-u. Migracija se primenjuje tek kad je kod spreman (isti redosled kao u Fazi 1).

**2.0 Priprema.** Dijagnostika postojećeg: da li `profiles` postoji i koje kolone ima (`supabase/diagnostics/phase2_audit.sql`, samo čita). Proveriti kako radi prijava: ako ide iz browsera direktno na Supabase Auth, IP limit za login ne može u našem kodu, već u Supabase Auth rate limit podešavanjima (Dashboard) i/ili Vercel Firewall pravilu. Instalirati `zod`.

**Rezultat 2.0 (2026-10-28, `supabase/diagnostics/phase2_audit.sql` preko read-only MCP-a):**
- `profiles` (`id` uuid PK → `auth.users` ON DELETE CASCADE, `full_name`, `email`, `created_at`) postoji, ima RLS sa polisom `profiles_select_own` i `authenticated` ima samo SELECT (Faza 1). Prva verzija dijagnostike je pogrešno javila da granta nema: read-only uloga MCP-a (`supabase_read_only_user`) ne vidi tuđe grantove u `information_schema.role_table_grants`. **Grantove proveravati isključivo preko `has_table_privilege()`.**
- Profil pravi trigger `on_auth_user_created` → `handle_new_user()` (`security definer`, `search_path = ''`, OK). Kolona `role` sa default-om `lawyer` radi i za nove naloge, bez izmene triggera.
- **3 korisnika, 2 profila: jedan nalog nema profil.** Migracija 2.1 mora da popuni nedostajuće profile (`insert ... select from auth.users ... on conflict do nothing`), inače taj nalog nema ulogu.
- **Ko je admin:** korisnik pre 2.1 kaže koji email dobija `admin`. Taj `update` ide u migraciju ili se radi ručno, ali ne kroz kod.
- `pg_cron` je dostupan, ali nije uključen. Retencija od 90 dana ide preko `pg_cron` (uključivanje ekstenzije je deo 2.1).
- `usage_ledger` i `audit_log` ne postoje. Trenutno ima 0 dokumenata i 0 poruka u poslednjih 24h.
- `get_daily_message_count(uuid)` je dostupan samo za `service_role` (Faza 1). Uklanja se u 2.1, a zamenjuje ga rezervacija.
- **Prijava ide iz browsera direktno na Supabase Auth** (`app/login/page.tsx`, `register`, `forgot-password`), pa IP limit za login, registraciju i reset lozinke **ne može u našem kodu**. Rešenje: Dashboard → Authentication → Rate Limits (radi vlasnik), a IP burst iz 2.8 važi samo za `/api/chat` i `/api/ingest`.
- **Open redirect** u `app/auth/callback/route.ts`: `${origin}${next}` sa `next=@evil.com` daje `https://app@evil.com`, što browser otvara kao `evil.com`. Popravka je u 2.6 (`next` mora da počinje sa `/`, a ne sa `//` ni `/\`).
- `zod` 4 je već instaliran.

**2.1 Migracija `supabase/migrations/<timestamp>_phase2_usage_audit.sql`** (jedna transakcija, pravila 3-4 važe):
- `profiles.role` (`admin` | `lawyer`, default `lawyer`), CHECK ograničenje. Korisnik ne sme da menja svoju ulogu (nema UPDATE grant).
- `usage_ledger` (`id`, `user_id`, `kind` chat|ingest, `input_tokens`, `output_tokens`, `embed_tokens`, `status` reserved|settled|released, `created_at`). `authenticated` samo SELECT svojih redova. Upisuje samo `service_role`. Indeks `(user_id, created_at)`.
- Atomska rezervacija: funkcija samo za `service_role` (izuzetak od pravila 4, kao `get_daily_message_count`, jer ID dolazi iz verifikovanog korisnika na serveru) uzima `pg_advisory_xact_lock` po korisniku, proverava dnevni broj poruka/dokumenata i dnevni/mesečni budžet tokena, pa upisuje red `reserved`. Time paralelni zahtevi ne mogu da prođu preko limita. Posle poziva red se zatvara sa stvarnim tokenima (`settled`), a pri grešci se oslobađa (`released`), pa neuspeo poziv ne troši limit.
- Brisanje razgovora ili dokumenata NE dira ledger (to je zaobilaženje iz revizije).
- `audit_log` (`id`, `user_id`, `action`, `resource_type`, `resource_id`, `metadata jsonb` bez sadržaja, `ip`, `created_at`). Append-only: `authenticated` samo SELECT (svoje; admin sve, preko provere uloge u `profiles`), nema UPDATE/DELETE ni za koga osim retencije. Retencija 90 dana preko `pg_cron` (ili Vercel Cron rute ako `pg_cron` nije dostupan).
- Pomoćna funkcija `get_usage_summary()` (`security invoker`, `auth.uid()`) vraća potrošnju za prikaz u aplikaciji.
- **Rezultat 2.1 (2026-10-28):**
  - Migracija **samo dodaje** (`get_daily_message_count` ostaje dok novi kod ne bude u produkciji), pa se primenjuje **pre** deploy-a koda, bez prekida rada. Stari brojač uklanja posebna migracija posle 2.3.
  - Nove tabele: `usage_ledger`, `audit_log` (sa `actor_email`, jer admin pod RLS-om ne vidi tuđe profile, a zapis mora ostati čitljiv i posle brisanja naloga: `on delete set null`) i `ip_rate_limit` (za 2.8, bez polisa, samo za server).
  - Funkcije samo za `service_role`: `reserve_usage` (advisory lock po korisniku; dan i mesec po beogradskom vremenu), `close_usage` (settle ili release; release ne troši dnevni broj, ali potrošeni tokeni ostaju u budžetu, pa namerno izazvane greške ne daju besplatne pozive) i `hit_ip_rate_limit`. Za korisnika: `get_usage_summary()`.
  - **Od 2026-10-30 Supabase ne izlaže nove tabele automatski, ni `service_role`-u** (changelog 2026-04-28), pa svaka nova tabela dobija eksplicitan grant za svaku ulogu. `service_role` nema DELETE na ledger-u ni UPDATE/DELETE na audit logu. Briše samo `pg_cron` (90 dana za audit, 1 dan za IP brojač).
  - Popunjava se profil koji nedostaje (3 korisnika, 2 profila). Svi nalozi su `lawyer`. **Admin se postavlja pri uvođenju kancelarije** (email vlasnika kancelarije, vidi Fazu 4), a ne u migraciji.
  - **Lokalna provera** (PGlite 0.5.10 + pgvector, stub-ovi za `auth`, uloge i `pg_cron`, šema pre Faze 1 sa stvarnim kolonama): migracija Faze 1, simulacija 30.10, migracija Faze 2, ponovno pokretanje (pada bez polovičnog stanja), pa oba testa prolaze. Sedam namernih rupa (grantovi, polise, `close_usage` bez provere vlasnika) testovi hvataju. Konkurentnost advisory lock-a nije testirana (PGlite ima jednu konekciju).
- Limiti su u env varijablama (jedna kancelarija = jedan deploy): `DAILY_MESSAGE_LIMIT=100`, `DAILY_DOCUMENT_LIMIT=20`, `DAILY_TOKEN_BUDGET`, `MONTHLY_TOKEN_BUDGET`. Predlog za tokene (potvrditi pre migracije): oko 10k tokena po poruci, pa ~1.000.000 dnevno i ~20.000.000 mesečno.

**2.2 Zajednički kod (`lib/`):**
- `lib/validation.ts`: zod šeme (chat, ingest formData, `chatId` kao UUID) i helper koji vraća grešku `{ error, code }` na srpskom sa 400.
- `lib/usage.ts`: `reserveUsage`, `settleUsage`, `releaseUsage`. Zamenjuje `lib/check-rate-limit.ts`.
- `lib/audit.ts`: `logAudit(...)` kroz `supabaseAdmin`, nikad ne baca grešku koja ruši zahtev, i nikad ne prima tekst pitanja/odgovora.
- `lib/prompt-safety.ts`: čišćenje pasusa i naslova, ograda konteksta, detekcija sumnjivih obrazaca.
- `lib/prompts.ts`: system prompt izvučen iz rute, neutralan (bez ličnih šala i „ko te je napravio”).

**2.3 `/api/chat`:** zod → autentifikacija → rezervacija → razgovor i poruka → Voyage → pretraga → Claude → zatvaranje rezervacije sa stvarnim tokenima (`usage` iz odgovora Claude-a i Voyage-a) → upis odgovora → audit. Model iz `CLAUDE_MODEL` env varijable (proveriti važeći ID). Odgovor vraća i stanje potrošnje, a UI prikazuje upozorenje na 80%.

**Rezultat 2.3 (2026-10-28, na `main`, nije commit-ovano):**
- `app/api/chat/route.ts` radi na ledger-u: rezervacija pre upisa, stvarni tokeni iz odgovora Claude-a (`usage.input_tokens`/`output_tokens`) i Voyage-a (`usage.total_tokens`), prompt iz `lib/prompts.ts`, svi odgovori u obliku `{ error, code }` (`apiError`), audit `chat_created` i `question_asked`. Odgovor sadrži `usage: { percent, warning, message }`, a `app/chat/page.tsx` prikazuje žutu traku od 80%.
- **Rezervacija se zatvara u `finally`**, pa je pokriven svaki izlaz (greška, 404, prazan odgovor, izuzetak). Uspeh = `settled`, neuspeh = `released`: ne broji se u dnevni broj poruka, ali tokeni potrošeni do greške ostaju u budžetu. Procena ulaza za Claude se upisuje čim je zahtev poslat, pa timeout (35 s) ne daje besplatne pozive; briše se samo kad API izričito odbije zahtev.
- **Odluke:** (1) autentifikacija ostaje pre zod-a (anonimno telo se ne parsira); (2) vlasništvo razgovora i istorija se čitaju PRE rezervacije (samo čitanje preko RLS-a), da procena tokena koristi stvarnu istoriju, a upisa nema do rezervacije; (3) podrazumevani model je `claude-sonnet-5` (važeći ID, isti kao do sada), a `CLAUDE_MODEL` prihvata samo oblik `claude-[a-z0-9-]+`, inače pada na podrazumevani (npr. `claude-sonnet-5-5`); (4) prazan odgovor ili `refusal` vraća grešku i ne broji se u dnevni limit; (5) `lib/check-rate-limit.ts` je obrisan (poslednji uvoz je bio u ovoj ruti).
- **Nova migracija `20261028130000_match_chunks_document_id.sql`:** `match_document_chunks` vraća i `document_id`, da `question_asked` upiše KOJI su dokumenti pročitani (ID-evi, ne nazivi). Samo dodaje kolonu, pa se primenjuje **pre** deploy-a (kod radi i bez nje, audit tada dobija prazan spisak). Posle primene pokrenuti `supabase/tests/phase1_rls_test.sql` (proširen proverom `document_id`) i `phase2_rls_test.sql`.
- **Lokalna provera migracije** (PGlite 0.5.12 + `@electric-sql/pglite-pgvector`, šema posle Faze 1, pravi migracioni fajl): kolone, izolacija A/B, `anon` dobija `42501`, `security invoker` i `hnsw.iterative_scan` očuvani, ponovno pokretanje ostavlja jednu funkciju. Negativna kontrola (`security definer` bez filtera) puca. Napomena: sam filter `where c.user_id` u funkciji nije osmotriv sam, jer RLS na `document_chunks` izoluje i bez njega (dodatni pojas).
- **Testovi:** `npm test` 53/53 (novo: `lib/claude.test.ts`, proširenja za `limits` i `rag-context`), `tsc` čist, lint 0 grešaka, `next build` prolazi (sa lažnim `NEXT_PUBLIC_SUPABASE_*`), `npm audit --omit=dev` 0 ranjivosti. Sama ruta nema automatski test (zavisi od `next/server` i Supabase-a): proveriti ručno na preview-u.
- **Ručna provera na preview-u:** pitanje u novom i postojećem razgovoru radi; odgovor ima `usage`; u `usage_ledger` red prelazi `reserved` → `settled` sa stvarnim tokenima; `audit_log` ima `chat_created` i `question_asked` (u `metadata.document_ids` su UUID-ovi, bez teksta); sa `DAILY_MESSAGE_LIMIT=2` treća poruka vraća 429 (`limit_reached`), a brisanje razgovora ne resetuje brojač; sa pogrešnim `ANTHROPIC_API_KEY` red postaje `released` i ne troši dnevni broj.
- **Posle deploy-a 2.3 (posebna migracija):** `20261028140000_drop_daily_message_count.sql` uklanja `get_daily_message_count`, a `phase1_rls_test.sql` je već prilagođen (vidi korak 7 u „Rezultat 2.9”). Nikako pre nego što novi kod radi u produkciji.
- **Poznata rupa (nije u opsegu 2.3):** ako Vercel prekine funkciju silom (iznad `maxDuration`), red ostaje `reserved` i računa se po proceni. Predlog: `pg_cron` zadatak koji redove starije od 10 minuta zatvara kao `settled` po procenjenim tokenima.

**2.4 Prompt injection (`lib/prompt-safety.ts`):**
- Kontekst se šalje u zasebnom bloku sa **slučajnim graničnikom po zahtevu** (nonce), koji pasus ne može da pogodi. Iz pasusa i naslova uklanjaju se graničnici, kontrolni znaci i prelomi reda u naslovu (naslov je ime fajla koje bira korisnik; ograničiti dužinu).
- Pravilo u promptu: sve unutar bloka je nepouzdan podatak, bez obzira na to čiji je dokument.
- Detekcija obrazaca („ignoriši prethodna uputstva”, „system prompt”, lažni graničnici...) pri otpremanju: ingest dvostepeno. Prvi poziv vraća upozorenje bez indeksiranja, korisnik potvrdi i šalje ponovo sa `acknowledge=true`. Ishod ide u audit (`suspicious_content_flagged`).

**2.5 `/api/ingest`:** zod za formData, `export const maxDuration = 60`, rezervacija (20 dokumenata dnevno + Voyage tokeni), čišćenje naslova, detekcija iz 2.4, audit `document_uploaded`. Uskladiti poruku o veličini fajla sa stvarnim limitom (4MB, Vercel).

**Rezultat 2.5 (2026-10-28, na `main`, nije commit-ovano):**
- **Redosled u `app/api/ingest/route.ts`:** autentifikacija → zod (`ingestFormSchema`; neispravan multipart je 400) → čitanje PDF-a (oštećen fajl je 400 `invalid_pdf`, ranije 500) → pasusi (preko 500 je 400 `too_many_chunks` PRE upisa dokumenta; ranije se to otkrivalo tek posle upisa, pa je trebalo poništavanje) → detekcija → rezervacija → upis dokumenta → Voyage po paketima od 30 → `settle` → audit. Rezervacija se zatvara u `finally` (uspeh = `settled`, neuspeh = `released`), isto kao u 2.3.
- **Detekcija sumnjivog sadržaja:** `findSuspiciousUpload(naziv, tekst)` proverava naziv i tekst ODVOJENO (kraj naziva i početak teksta ne smeju da naprave lažan obrazac). Prvi poziv vraća **409 `suspicious_content`** sa opisom nađenih obrazaca na srpskom (`PATTERN_LABELS` u `lib/prompt-safety.ts`, bez internih ID-eva), bez indeksiranja i bez rezervacije (upozorenje ne troši ni red u ledger-u). Ponovni poziv sa `acknowledge=true` indeksira. Detekcija je pre rezervacije, pa korisnik na dnevnom limitu prvo vidi upozorenje, a 429 tek posle potvrde. Audit `suspicious_content_flagged` ide dvaput: `acknowledged: false` pri upozorenju, `acknowledged: true` sa ID-em dokumenta posle upisa. U audit idu samo oznake obrazaca.
- **Potrošnja:** procena rezervacije je zbir `estimateTokens` po pasusu. Procena paketa ide u `spent.embed` PRE poziva Voyage-a (timeout ne daje besplatne pozive), koriguje se na `usage.total_tokens`, a oduzima se samo kad Voyage izričito odbije zahtev. Poništavanje (rollback) briše dokument, kaskada briše pasuse, a neuspeh brisanja se loguje (ranije se ignorisao).
- **`parseVoyageBatchResponse` (`lib/claude.ts`):** odgovor mora imati tačno onoliko vektora koliko pasusa, redosled određuje `index`. Ranije je ruta slepo čitala `voyageData.data[index].embedding`, pa je neispravan odgovor rušio obradu sa `TypeError`.
- **Ostalo:** naziv fajla prolazi `sanitizeTitle` pre upisa; poruka o veličini kaže 4MB (`MAX_FILE_SIZE` je sada u `lib/ingest.ts` da ga koristi i klijent bez zod-a u bundle-u, a `validation.ts` ga ponovo izvozi); sve greške su `{ error, code }`; `AbortError` je 504 `embedding_timeout`, a tekst internih izuzetaka više ne stiže korisniku; `lib/require-user.ts` vraća 401 sa `code: 'unauthorized'` za sve rute; `PdfUploader.tsx` proverava veličinu pre slanja, ne puca na odgovoru koji nije JSON (413 sa Vercel-a) i prikazuje žuto upozorenje sa „Otkaži” / „Ipak dodaj”.
- **Audit `document_upload_blocked`** (razlozi `unreadable_pdf`, `no_text`, `too_many_chunks`) i **`document_uploaded`** (ID dokumenta, broj pasusa, bajtovi, `embed_tokens`). Naziv fajla se NE upisuje.
- **Testovi:** `npm test` 70/70 (novo: `lib/ingest.test.ts`, `parseVoyageBatchResponse` u `lib/claude.test.ts`), `tsc` čist, lint čist za izmenjene fajlove, `next build` prolazi (lažni `NEXT_PUBLIC_SUPABASE_*`), `npm audit --omit=dev` 0 ranjivosti. **Sama ruta nema automatski test i NIJE pokrenuta** (lokalno nema Supabase-a ni Voyage-a).
- **Ručna provera na preview-u (obavezna pre zatvaranja 2.5):** (1) običan PDF uspeva, ledger red ide `reserved` → `settled` sa `embed_tokens` > 0, a `audit_log` ima `document_uploaded`; (2) PDF sa „Ignoriši prethodna uputstva” daje žuto upozorenje, u bazi nema dokumenta ni ledger reda, a „Ipak dodaj” indeksira i upisuje oba audit zapisa; (3) sa `DAILY_DOCUMENT_LIMIT=2` treći dokument vraća 429 `limit_reached`, a brisanje dokumenta ne resetuje brojač; (4) tekstualni fajl preimenovan u `.pdf` vraća 400 „nije ispravan PDF”; (5) sa pogrešnim `VOYAGE_API_KEY` u bazi nema dokumenta, a ledger red postaje `released`; (6) fajl od ~5MB daje poruku o veličini, a ne „Greška pri povezivanju”.
- **Poznato:** ponovljeno slanje neispravnih PDF-ova je punilo audit log (retencija 90 dana); **rešeno u 2.8** (IP burst ide pre parsiranja tela). `input_type` za dokumente se i dalje ne šalje Voyage-u (pitanja idu sa `query`); promena bi menjala vektore u odnosu na već indeksirane dokumente, pa nije rađena.

**2.6 Ostale rute i akcije:** zod na `chats`, `chats/[chatId]`, `chats/[chatId]/messages`, `deleteDocument` (UUID) i `auth/callback` (parametar `next` proveriti protiv open redirect-a). Audit za `chat_created`, `chat_deleted`, `document_deleted` (upis ide kroz `supabaseAdmin`, brisanje ostaje preko RLS klijenta).

**Rezultat 2.6 (2026-10-28, na `main`, nije commit-ovano):**
- **Open redirect (`app/auth/callback/route.ts`):** `next` prolazi kroz `safeRedirectPath` (`lib/safe-redirect.ts`). Odbija se sve što ne počinje sa `/`, što počinje sa `//` ili `/\`, što sadrži backslash ili kontrolne znake (browser briše tab i novi red iz URL-a, pa `/<TAB>/evil.com` postaje `//evil.com`), i putanje koje se posle normalizacije (`/..//evil.com`) pretvore u `//…`. Odbijena vrednost pada na `/`. Preusmeravanje ide kroz `new URL(next, origin)`. Kodirano `/%2F/evil.com` ostaje obična putanja na našem sajtu. Test je napisan prvi i pao je zbog nepostojećeg modula pre implementacije.
- **`deleteDocument` (server akcija = javni endpoint):** ID se proverava sa `uuidSchema` pre baze (kolona `audit_log.resource_id` je `uuid`, pa neispravan ID ne sme ni u audit). Brisanje vraća obrisane redove (`.select('id')`): prazan rezultat daje grešku „Dokument nije pronađen.” (promena ponašanja: ranije je brisanje tuđeg ili nepostojećeg dokumenta vraćalo `success`). Brisanje ostaje preko RLS klijenta, a audit `document_deleted` ide kroz `supabaseAdmin` TEK posle stvarnog brisanja (samo ID dokumenta, bez naziva).
- **`DELETE /api/chats/[chatId]`:** audit `chat_deleted` (ID razgovora) posle stvarnog brisanja.
- **Jedinstven oblik greške:** `GET /api/chats`, `DELETE /api/chats/[chatId]` i `GET /api/chats/[chatId]/messages` koriste `apiError` (`{ error, code }`, kodovi `not_found`, `chats_list_failed`, `chat_delete_failed`, `messages_load_failed`). Frontend čita samo `res.ok` i `data.chats` / `data.messages`, pa se ništa ne lomi.
- **Šta nije dirano i zašto:** `GET /api/chats` nema ulaz (nema parametara) pa zod nema šta da proveri; `chatId` u obe `[chatId]` rute je već proveravan sa `uuidSchema` (neispravan ID = 404). Nova migracija nije potrebna: `chat_deleted` i `document_deleted` su već u CHECK listi `audit_log`, a `resource_id` nema FK, pa audit posle brisanja prolazi.
- **Poznato:** `app/auth/callback` trenutno ne koristi nijedna stranica u kodu (`forgot-password` šalje `redirectTo` na `/reset-password`). Ruta je ipak javna i `next` je ulaz iz URL-a, pa je zatvorena. Ako Supabase email šabloni (Dashboard) koriste `/auth/callback?next=…`, radi i dalje isto, samo sa proverom.
- **Testovi:** `npm test` 77/77 (novo: `lib/safe-redirect.test.ts`, 7 testova), `tsc` čist, lint čist za izmenjene fajlove, `next build` prolazi (lažni `NEXT_PUBLIC_SUPABASE_*`), `npm audit --omit=dev` 0 ranjivosti. **Rute i server akcija nemaju automatski test i NISU pokrenute** (lokalno nema Supabase-a).
- **Ručna provera na preview-u (obavezna pre zatvaranja 2.6):** (1) brisanje razgovora radi, a `audit_log` ima `chat_deleted` sa ID-em razgovora; (2) brisanje dokumenta radi, a `audit_log` ima `document_deleted`; (3) ponovni klik na „Obriši” za već obrisan dokument (drugi tab) daje „Dokument nije pronađen.” i NE pravi novi audit zapis; (4) `GET /api/chats/<tuđi chatId>/messages` i `DELETE` daju 404 `{ error, code: 'not_found' }`, bez audit zapisa; (5) `/auth/callback?code=<važeći>&next=@evil.com` i `next=//evil.com` završavaju na `/`, a `next=/reset-password` na `/reset-password`.

**2.7 Audit događaji (bez sadržaja):** `document_uploaded`, `document_upload_blocked`, `document_deleted`, `chat_created`, `chat_deleted`, `question_asked` (u `metadata`: ID razgovora, **ID-evi dokumenata korišćenih kao izvori** = ko je „pročitao” koji dokument, broj tokena), `limit_reached`, `suspicious_content_flagged`. Stranica `/activity`: advokat vidi svoje, admin sve.

**Rezultat 2.7 (2026-10-28, na `main`, nije commit-ovano):**
- **Svi događaji iz spiska se već upisuju** (2.3, 2.5, 2.6): `document_uploaded`, `document_upload_blocked`, `document_deleted`, `chat_created`, `chat_deleted`, `question_asked`, `limit_reached`, `suspicious_content_flagged`. U 2.7 je dodata samo stranica za pregled.
- **`/activity` (`app/activity/page.tsx`)** je server komponenta. Čita `audit_log` isključivo preko korisničkog klijenta (pravilo 1): RLS polisa `audit_log_select_own_or_admin` daje advokatu svoje zapise, a adminu sve. Za ne-admina se dodaje `.eq('user_id', user.id)` kao drugi pojas. Uloga iz `profiles` služi samo za prikaz (naslov i kolona „Korisnik”), zaštitu daje baza. Filter po vrsti (`?action=`) i strane (`?page=`, 50 po strani, najviše 200) prolaze `parseActivityQuery`: sve što nije očekivanog oblika pada na podrazumevano, pa URL ne može da proizvede proizvoljan upit. Strana se određuje sa PAGE_SIZE+1 redova, bez posebnog brojanja. Vreme je uvek beogradsko (server radi u UTC). Bez prijave preusmerava na `/login` (uz `proxy.ts`).
- **`lib/activity.ts`** (čist kod, bez `server-only`, testiran): `describeActivity` pretvara zapis u naslov i redove detalja na srpskom. Polje `metadata` se tretira kao nepouzdan oblik (svako polje se proverava), nepoznata akcija ili neispravan `metadata` ne ruše prikaz. `PAGE_SIZE`, `MAX_PAGE`, `ACTION_LABELS` (Record preko `AuditAction`: nova akcija bez opisa ne prolazi `tsc`).
- **Naslovi dokumenata:** audit namerno ne čuva nazive fajlova (odluka iz 2.5), pa se naslov prikazuje samo za dokument koji još postoji i pripada korisniku koji gleda (upit na `documents` preko RLS-a). Za obrisane dokumente i za tuđe (admin gleda zapis advokata) prikazuje se skraćen ID (`ID 3f2b8c1e`). Admin vidi nazive tuđih dokumenata tek u Fazi 2.5 (uske RPC funkcije).
- **Stanje žive baze (provereno 2026-10-28 preko read-only MCP-a):** `audit_log` ima RLS i polisu iznad, `authenticated` ima samo SELECT (`has_table_privilege`: insert/update/delete = false), `anon` nema ništa, kolonu `profiles.role` `authenticated` sme da čita, ali ne i da menja. U tabeli su 2 zapisa (`chat_created`, `question_asked`).
- **MIGRACIJA `20261028130000_match_chunks_document_id.sql` NIJE PRIMENJENA** (`match_document_chunks` još vraća samo `document_title, content, similarity`). Posledica: svi `question_asked` zapisi, uključujući postojeći, imaju `document_ids: []`, pa `/activity` ne može da kaže KOJI su dokumenti pročitani, a to je glavna svrha ovog zapisa (ko je „pročitao” koji dokument). Prikaz zato ne tvrdi „bez izvora” kad je `sources > 0`, već piše „Broj pasusa iz izvora: N (dokumenti nisu zabeleženi)”. **Primeniti migraciju pre pilota.** Stari zapisi ostaju bez ID-eva (retencija ih briše za 90 dana).
- **Testovi:** `npm test` 94/94 (novo: `lib/activity.test.ts`, 17 testova; poslednji dodat posle nalaza o migraciji i video sam ga kako pada pre ispravke), `tsc` čist, lint čist za nove fajlove (`Sidebar.tsx` ima 2 stara upozorenja: neiskorišćen `router` i `window.location.href`), `next build` prolazi (`/activity` je dinamička ruta), `npm audit --omit=dev` 0 ranjivosti. **Stranica nije otvorena u browseru i nije proverena kao admin** (lokalno nema Supabase-a, a u bazi nema korisnika sa ulogom `admin`).
- **Ručna provera na preview-u (obavezna pre zatvaranja 2.7):** (1) kao advokat: `/activity` pokazuje samo svoje zapise, link „🕘 Aktivnost” u sidebar-u radi; (2) posle akcija (pitanje, otpremanje, brisanje dokumenta i razgovora) novi zapisi su na vrhu, sa tačnim vremenom (Beograd); (3) filter „Postavljeno pitanje” i `?page=2` rade, a `?page=abc` i `?action=x` ne ruše stranicu; (4) kao admin (`update public.profiles set role = 'admin' where email = '…';` u SQL Editoru, posle provere vratiti na `lawyer`): vidi zapise svih korisnika i kolonu „Korisnik”; (5) posle primene migracije `…130000`: novo pitanje pokazuje nazive dokumenata kao izvore; (6) `phase2_rls_test.sql` prolazi na Supabase-u (još nije potvrđeno).

**2.8 IP burst zaštita:** limit po IP adresi na `/api/chat` i `/api/ingest` (brojač u Postgres-u ili Vercel Firewall pravilo, odlučiti u 2.0 posle provere ograničenja Vercel plana). Ne verovati ručno poslatom `X-Forwarded-For` van Vercel-a.

**Rezultat 2.8 (2026-10-28, na `main`, nije commit-ovano):**
- **Odluka: brojač u Postgres-u** (tabela `ip_rate_limit` i `hit_ip_rate_limit` iz 2.1, već primenjeni; **nova migracija nije potrebna**). Razlog: nema novog spoljnog servisa, isti obrazac kao ledger. Provereno 2026-10-28 preko read-only MCP-a: funkciju sme da zove samo `service_role`, a tabela je zatvorena za `anon` i `authenticated`.
- **Novi `lib/ip-burst.ts`** (čist kod, testiran): `getIpBurstLimit` (env `IP_BURST_LIMIT`, podrazumevano **60 zahteva u minuti po IP adresi**, neispravna vrednost pada na podrazumevanu), `decideIpBurst` (`allow` / `blocked` + `Retry-After` / `unavailable`), `secondsUntilNextWindow`, `ipBurstKey`. **`enforceIpBurst(ip)` u `lib/usage.ts`** vraća odgovor ili `null`; `apiError` dobija opcioni `headers`.
- **Redosled u obe rute:** IP burst je PRVI korak, pre autentifikacije i pre čitanja tela. Poplava zahteva tako ne stiže do Supabase Auth-a, a ponovljena neispravna otpremanja ne pune audit log niti troše CPU na parsiranju PDF-ova.
- **Jedan brojač za `/api/chat` i `/api/ingest` zajedno** (tabela nema kolonu za vrstu). Ako zatreba stroži limit za ingest, treba nova migracija (kolona `scope` u ključu i funkciji).
- **Odgovori:** 429 `too_many_requests` sa zaglavljem `Retry-After`; 503 `rate_limit_unavailable`. **Fail-closed:** greška baze, izuzetak ili odgovor koji nije boolean NE propuštaju zahtev (isto kao `reserveUsage`).
- **Bez poverljive IP adrese** (van Vercel-a, ili nevažeće zaglavlje; vidi `lib/client-ip.ts`) brojanja nema i zahtev prolazi: nema po čemu da se broji. Lokalni rad zato nije ograničen.
- **IPv6 se broji po /64 mreži** (ključ oblika `2001:db8:1:2:0:0:0:0/64`). Klijent obično dobija celu /64, pa bi rotacija adresa unutar nje zaobišla limit. IPv4 upakovan u IPv6 (`::ffff:a.b.c.d`) vraća se na IPv4, inače bi svi delili ključ `::/64`.
- **Blokada se NE upisuje u audit log:** poplava bi ga punila (retencija 90 dana). Vidi se samo kao 429 u Vercel logovima. Greška baze se loguje (`IP Burst Error`).
- **Zašto 60:** cela kancelarija je obično iza jedne IP adrese (NAT), pa limit mora da trpi više advokata istovremeno. Pravi dnevni limit po advokatu čuva ledger, a ovo je gruba brana po mreži. Za veću kancelariju podići `IP_BURST_LIMIT` u env-u (jedan deploy = jedna kancelarija).
- **Fiksni prozor** (60 s): na granici prozora moguć je do dvostruki nalet. Za zaštitu od poplave to je prihvatljivo.
- **Login, registracija i reset lozinke NISU pokriveni** (idu iz browsera direktno na Supabase Auth): rešenje je Dashboard → Authentication → Rate Limits (radi vlasnik), vidi 2.0.
- **Testovi:** `npm test` 110/110 (novo: `lib/ip-burst.test.ts`, 16 testova). Mutacije na kopiji (fail-open na grešku, bez /64 grupisanja, bez IPv4-mapped, blokada koja propušta, `Retry-After` 0) padaju na odgovarajućim testovima; prva mutacija je prošla neprimećeno dok test nije pojačan (`error` mora da pobedi i uz `data=true`). `tsc` čist, lint čist za izmenjene fajlove, `next build` prolazi (lažni `NEXT_PUBLIC_SUPABASE_*`), `npm audit --omit=dev` 0 ranjivosti. SQL test `phase2_rls_test.sql` već pokriva `hit_ip_rate_limit` (limit, nezavisnost po adresi, `42501` za ostale uloge). **Rute NISU pokrenute** (lokalno nema Supabase-a, a bez `VERCEL=1` IP je `null`).
- **Ručna provera na preview-u (obavezna pre zatvaranja 2.8):** (1) običan chat i otpremanje rade kao pre (u `ip_rate_limit` se pojavljuje red sa tvojom IP adresom, `hits` raste); (2) sa `IP_BURST_LIMIT=3` četvrti zahtev u istom minutu daje 429 `too_many_requests` sa `Retry-After`, UI prikazuje poruku, a posle isteka minuta radi opet (vratiti env posle testa); (3) 429 nema upis u `audit_log`; (4) odjavljen korisnik (401) se takođe broji, a ne ruši rutu; (5) `select count(*) from ip_rate_limit` ne raste posle 24h (cron `ip-rate-limit-cleanup`).

**2.9 Testovi i verifikacija:**
- `supabase/tests/phase2_rls_test.sql` (sve sa `rollback`): `authenticated` ne može INSERT/UPDATE/DELETE u `usage_ledger` ni `audit_log`; vidi samo svoje; admin vidi sve u kancelariji; `anon` nema ništa; korisnik ne može da promeni svoju ulogu; rezervacija ne dozvoljava prekoračenje limita; brisanje razgovora ne smanjuje potrošnju.
- Jedinični testovi (`npm test`, ugrađeni Node runner `node:test`, bez vitest-a) za `prompt-safety`, zod šeme i računanje limita.
- Ručno: 101. poruka vraća 429; 21. dokument vraća 429; obrisan razgovor ne resetuje brojač; dokument sa „ignoriši uputstva” daje upozorenje; Advisors → Security bez novih upozorenja; `tsc`, lint, build.
- Na kraju ažurirati ovaj fajl (status Faze 2) i commit-ovati SQL.

**Rezultat 2.9 (2026-10-28, na `main`, nije commit-ovano): kod je gotov, ali FAZA 2 NIJE ZATVORENA.** Ostaju koraci koje Claude ne može da uradi (MCP je read-only, nema pristupa preview-u).
- **Pokrivenost liste iz 2.9:** `supabase/tests/phase2_rls_test.sql` već pokriva svih sedam stavki (korisnik ne upisuje u ledger/audit, vidi samo svoje, admin vidi audit, `anon` ništa, korisnik ne menja ulogu, rezervacija ne dozvoljava prekoračenje, brisanje razgovora ne smanjuje potrošnju), pa nije dodat novi SQL. Jedinični testovi za `prompt-safety`, zod šeme i limite postoje od ranije. SQL je pod git-om i nema izmena.
- **Dokazano ovog puta:** `npm test` 110/110, `tsc` čist, `npm run lint` 0 grešaka (3 stara upozorenja: `app/chat/page.tsx:142` neiskorišćen `error`, `Sidebar.tsx` `router` i `window.location.href`), `next build` exit 0 (lažni `NEXT_PUBLIC_SUPABASE_*`), `npm audit --omit=dev` 0 ranjivosti.
- **Revizija koda po trajnim pravilima:** (1, 2) `supabaseAdmin` se koristi samo za upise i RPC (`lib/usage.ts`, `lib/audit.ts`, upisi u `chat` i `ingest`), čitanja idu preko korisničkog klijenta; (7) `lib/supabase.ts` ima `server-only`; `get_daily_message_count` i `check-rate-limit` se više ne pominju nigde u kodu.
- **Živa baza (read-only MCP):** 24 statičke provere iz odeljka 1 testa (RLS na svim tabelama, nema polisa za upis, `anon` bez pristupa ijednoj tabeli, grantovi `authenticated` i `service_role`, `reserve_usage`/`close_usage`/`hit_ip_rate_limit` samo za `service_role` i `security invoker`, `profiles.role` se ne menja) bez ijednog prekršaja; oba `pg_cron` zadatka aktivna. **Ovo NIJE zamena za SQL test**, koji proverava ponašanje (rezervacije, RLS po redovima). Advisors Security: i dalje 2 stara upozorenja (`vector` u šemi `public`, isključena zaštita od procurelih lozinki) i novi INFO `ip_rate_limit` „RLS bez polisa”, što je namerno (tabela je samo za server, korisnici nemaju ni grant). Advisors Performance: 4 INFO „neiskorišćen indeks”, očekivano pri nekoliko redova, bez akcije.
- **NALAZ: 3 korisnika, a samo 1 profil.** Dva starija naloga (septembar, test) nemaju profil, iako migracija 2.1 popunjava profile koji fale (u 2.0 je bio 1 profil nedostajao). Uzrok nije utvrđen. Posledica: chat i otpremanje rade (ledger i audit ne zavise od profila), ali `update public.profiles set role = 'admin' where email = '…'` za nalog bez profila **tiho menja 0 redova**, što bi pokvarilo uvođenje admina (Faza 4). Popravka u SQL Editoru (idempotentna): `insert into public.profiles (id, full_name, email) select u.id, u.raw_user_meta_data ->> 'full_name', u.email from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id) on conflict (id) do nothing;`
- **Redosled zatvaranja Faze 2 (radi vlasnik):**
  1. Popraviti profile (SQL iznad), pa proveriti `select count(*) from public.profiles` = broj korisnika.
  2. Primeniti `supabase/migrations/20261028130000_match_chunks_document_id.sql` u SQL Editoru (pre deploy-a). **Prvi pokušaj 2026-10-28 pao** sa `42501 permission denied to set parameter "hnsw.iterative_scan"` (SQL Editor nije superuser, a pgvector biblioteka nije bila učitana u sesiji). Popravljeno u migraciji (`select '[1]'::public.vector;` pre `create function`) i reprodukovano/proveravano lokalno sa ne-superuser ulogom; ponovni pokušaj na pravoj bazi čeka. Pad je ostavio bazu netaknutom (živa funkcija ima stari potpis i `hnsw.iterative_scan=strict_order`). `phase1_rls_test.sql` je tada pao samo zato što traži kolonu `document_id`, ne zbog curenja; `phase2_rls_test.sql` i popravka profila (3 od 3) su prošli. Provera: `select pg_get_function_result('public.match_document_chunks(vector,integer)'::regprocedure);` mora da sadrži `document_id`.
  3. Pokrenuti `supabase/tests/phase1_rls_test.sql`, pa `supabase/tests/phase2_rls_test.sql`. Oba moraju da ispišu „svi … prošli” (pun ispis poslati Claude-u ako puca).
  4. Dashboard: Authentication → Rate Limits (login, registracija, reset lozinke ne prolaze kroz naš kod); isključiti „Allow new users to sign up” (preostalo iz Faze 1); uključiti zaštitu od procurelih lozinki ako plan dozvoljava.
  5. Vercel env: obavezne `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Opcione (svaka ima podrazumevanu vrednost): `CLAUDE_MODEL`, `DAILY_MESSAGE_LIMIT` (100), `DAILY_DOCUMENT_LIMIT` (20), `DAILY_TOKEN_BUDGET` (1.000.000), `MONTHLY_TOKEN_BUDGET` (20.000.000), `IP_BURST_LIMIT` (60 u minuti).
  6. Commit, push, preview: proći ručne provere iz „Rezultat 2.3”, „2.5”, „2.6”, „2.7” i „2.8” (za testiranje privremeno `DAILY_MESSAGE_LIMIT=2`, `DAILY_DOCUMENT_LIMIT=2`, `IP_BURST_LIMIT=3`, pa **vratiti**). Uz to Advisors → Security posle koraka 2.
  7. Kad novi kod radi u produkciji: primeniti `supabase/migrations/20261028140000_drop_daily_message_count.sql` (**pripremljena 2026-10-28, NIJE primenjena**; briše svaki potpis funkcije bez CASCADE, pa puca i ne menja ništa ako nešto zavisi od nje), pa ponovo pokrenuti `phase1_rls_test.sql`. Test je izmenjen da važi i pre i posle migracije (tri poziva stare funkcije se preskaču kad je nema), a poslednji red ispisuje da li je stari brojač uklonjen. Lokalno proveren na PGlite-u: petlja ima 3 stavke dok funkcija postoji i 2 kad je nema, migracija puca na zavisnom pogledu bez polovičnog stanja, ponovno pokretanje je bezopasno. Provera ponašanja testa na pravoj bazi (uloge, RLS) nije rađena. Tek posle ovoga Faza 2 postaje `[x]`.

**Fajlovi Faze 2.** Novi: `supabase/diagnostics/phase2_audit.sql`, `supabase/migrations/<ts>_phase2_usage_audit.sql`, `supabase/tests/phase2_rls_test.sql`, `lib/validation.ts`, `lib/usage.ts`, `lib/audit.ts`, `lib/prompt-safety.ts`, `lib/prompts.ts`, `app/activity/page.tsx`. Menjaju se: `app/api/chat/route.ts`, `app/api/ingest/route.ts`, `app/api/chats/**`, `app/actions/documents.ts`, `app/auth/callback/route.ts`, `app/chat/page.tsx` (prikaz potrošnje), `lib/check-rate-limit.ts` (briše se).

## Nalazi preneti iz revizije Faze 1
- **Rate limit se može zaobići.** `get_daily_message_count` broji redove iz `messages`, pa korisnik koji obriše razgovor resetuje svoj brojač. Treba posebna tabela potrošnje (usage ledger) u koju korisnik ne može da piše niti iz nje da briše (`lib/check-rate-limit.ts`).
- **`/api/ingest` nema rate limit.** Neograničeni pozivi Voyage API-ja troše kredite (`app/api/ingest/route.ts`). **Urađeno u 2.5** (20 dokumenata dnevno + budžet tokena); IP burst urađen u 2.8.
- **Nema zod validacije.** `chatId` i telo zahteva se ne validiraju (`app/api/chat/route.ts:48`). **Delimično urađeno:** `lib/validation.ts` (`chatRequestSchema`, `uuidSchema`) koriste `/api/chat` i obe rute `chats/[chatId]`. Neispravno telo vraća 400, a neispravan ID u putanji 404. `/api/ingest` je urađen u 2.5, a `deleteDocument` i `auth/callback` u 2.6.
- **Prompt injection.** RAG kontekst iz dokumenata se ubacuje direktno u system prompt (`app/api/chat/route.ts:13-32`), a `document_title` (ime fajla koje bira korisnik) ide u kontekst bez ikakve obrade. **Delimično urađeno:** `lib/rag-context.ts` stavlja svaki izvod u blok `<izvod naziv="...">` i escape-uje `<` i `>` u sadržaju i nazivu, pa dokument ne može da zatvori blok niti da lažira izvod. Time je pokriven cilj „slučajnog graničnika” iz 2.4: graničnik ne mora biti tajan kad ga sadržaj ne može napisati. Naziv se čisti od kontrolnih, zero-width i bidi znakova i od preloma, i skraćuje na 120 znakova. Detekcija sumnjivog sadržaja pri otpremanju je urađena u 2.5.
- **Zavisnosti: bilo je 13 ranjivosti (2 kritične, `npm audit --omit=dev`, 2026-10-27), sada 0.** Uklonjeni su neiskorišćeni `langchain` i `@langchain/community`. Urađen je `npm audit fix`. `zod` je podignut sa 3 na 4, a `next` i `eslint-config-next` sa 16.3.0 na 16.4.3 (RCE u Image Optimization API-ju, DoS preko Server Actions). **Pre spajanja u `main` ručno proći login, chat, otpremanje PDF-a i brisanje dokumenta.** Trajno pravilo: `npm audit --omit=dev` ide u svaku reviziju.
- **Nema audit loga** (ko je kada otpremio, pročitao ili obrisao dokument). Advokatske kancelarije to traže zbog NDA.

# FAZA 3: Bezbednost PDF/Word fajlova

Opseg: sprečavanje malicioznih fajlova (malware, makro virusi) pre parsiranja.

Nalazi preneti iz revizije Faze 1:
- **PDF se prepoznaje samo po MIME tipu ili ekstenziji.** Nema provere magičnih bajtova (`%PDF-`) (`app/api/ingest/route.ts:33`).
- **Word se parsira u browseru** preko mammoth.js (`app/chat/page.tsx:123`). Server nikad ne vidi originalni fajl.
- **Limit veličine se ne slaže sa porukom.** `MAX_FILE_SIZE` je 4MB, a poruka i komentar kažu 10MB (`app/api/ingest/route.ts:8,30`). **Urađeno u 2.5:** poruka kaže 4MB, a limit je jedna konstanta u `lib/ingest.ts`.
- **Parsiranje (unpdf) nema timeout ni izolaciju.** Pokreće se direktno u API ruti.

# FAZA 4: Isporuka kancelariji (Vercel + Supabase silo)

Odluka (2026-10-28): **Docker i on-prem nisu u planu.** Svaka kancelarija dobija poseban Vercel projekat i poseban Supabase projekat, a postupak podizanja je dokumentovan checklista.

Opseg:
- **Bazna šema u repou.** Nov Supabase projekat mora da se podigne od nule, a migracije postoje samo preko postojeće šeme. Treba napraviti baznu šemu preko `supabase db dump --schema-only` i migracije poređati tako da prolaze na praznoj bazi.
- **Checklista za onboarding** (`docs/onboarding.md`): Supabase projekat (EU region, Pro plan zbog backup-a), migracije redom, Auth podešavanja (registracija OFF, zaštita od procurelih lozinki, rate limit), env varijable na Vercel-u (uključujući limite iz Faze 2), prvi admin nalog (`update public.profiles set role = 'admin' where email = '<email vlasnika kancelarije>';` u SQL Editoru, posle njegovog prvog prijavljivanja), test izolacije.
- **Spoljni AI servisi.** Voyage AI i Claude su cloud API-ji. Pripremiti za kancelariju pregled tokova podataka i uslova čuvanja (zero retention), za DPA i bezbednosni upitnik.
