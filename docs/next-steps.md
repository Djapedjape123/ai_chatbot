# Šta dalje: Faza 2.5 (admin panel), korak po korak

Stanje na dan 2026-10-29. Ovaj fajl je namenjen tebi: odozgo nadole piše šta TI radiš, a šta radi Claude.
Za detalje i obrazloženja: `docs/admin-panel-plan.md` (plan) i `CLAUDE.md` (status faza).

## Gde smo

| Faza | Stanje |
|---|---|
| 1. Izolacija podataka (RLS) | Gotova |
| 2. Zaštita API ruta | Gotova (preostale stavke su dole, odeljak 1D) |
| 2.5.1 Migracija admin panela + SQL test | Primenjena na Supabase-u, testovi prošli |
| 2.5.2 Zajednički kod (`lib/`) | Napisan i commit-ovan (`2fd9840`); izmena `/api/chat` još nije potvrđena na produkciji |
| 2.5.3 MFA (kapija, `/login/mfa`, `/account/security`) | Commit-ovan i na GitHub-u (`a505cd5`); **vlasnik potvrdio na produkciji 2026-10-29: QR i kod rade** (u bazi je zapis `mfa_enrolled`); chat posle ove izmene još nije potvrđen (odeljak 1A) |
| 2.5.4 Pozivnica i postavljanje lozinke | Commit-ovan i na GitHub-u (`4316a87`); ruta i `proxy.ts` probani lokalno (29 provera); **na produkciji nije potvrđeno** (odeljak 2, „2.5.4") |
| 2.5.5 Admin okvir i pregled | Kod napisan, `npm test` 231/231, probano lokalno (27 provera); commit-ovan (`01d79e5`); **vlasnik je 2026-10-29 ušao u `/admin` kao admin sa MFA na produkciji** (odeljak 2, „2.5.5"). U bazi je 1 admin |
| 2.5.6 Advokati (tabela, pregled jednog, poziv, blokada, uloga) | Commit-ovan i push-ovan (`55cd533`), migracija primenjena i `phase256` test prošao na pravoj bazi (2026-10-29); **na produkciji nije probano** (nema traga u bazi) (odeljak 2, „2.5.6") |
| 2.5.7 do 2.5.10 | Nije počelo |
| 2.5.11 (predlog) Tvrdi RLS: `aal2` + blokada na nivou baze + audit uklanjanja MFA | Čeka tvoju odluku (C6, C7, C8) |
| 3. Bezbednost fajlova | Posle 2.5 |
| 4. Isporuka kancelariji | Posle faze 3 |

## 1. Šta radiš TI (pre sledećeg ćaskanja)

### A. Odmah
Već urađeno: `phase2_rls_test.sql` je prošao (2026-10-28), a kod 2.5.1 i 2.5.2 plus dokumenti su commit-ovani i na GitHub-u (`83169e3`).

1. **Još nije urađeno, a sad je važnije: pošalji jednu poruku u chat na produkciji PRE nego što pustiš 2.5.6** (Vercel deploy mora biti „Ready"). U `usage_ledger` još nema
   nijednog reda posle izmene iz 2.5.2 (poslednji je iz 15:57, smoke test Faze 2). Javi Claude-u da proveri novi red. Razlog: 2.5.3 menja
   i `/api/chat` (prelazak na `requireUser()`), pa ako bi chat posle toga prestao da radi, ne bi se znalo koja je izmena kriva. Od 2026-10-29 u `usage_ledger` i dalje nema reda posle 2.5.2, a 2.5.6 opet menja `requireUser()` (sada čita i profil), pa su na produkciji neproverene tri izmene u nizu.
2. ~~Commit i push 2.5.3~~ **Urađeno** (`a505cd5`, na GitHub-u). Ostaje samo da proveriš da je Production „Ready" pre koraka 1 i 3.
   Podsetnik: `main` je produkcija, pa je ovo već promenilo pravu aplikaciju, uključujući `proxy.ts` (kapiju cele aplikacije).
3. **Posle deploy-a (Production „Ready") testiraj ovim redom:**
   1. Običan prozor, nalog još bez MFA: prijava, chat i dokumenti moraju da rade kao pre. Ako ne rade, javi odmah; izlaz je
      vraćanje (`git revert`) tog commit-a.
   2. (B1 mora biti urađen.) Otvori `/account/security`, klikni „Uključi dvostepenu prijavu", skeniraj QR aplikacijom
      (Google Authenticator, Microsoft Authenticator, Authy…) i unesi 6 cifara. Treba da piše „Uključena".
   3. Incognito prozor, isti nalog: posle lozinke traži se kod. Pogrešan kod daje poruku, tačan otvara chat.
   4. U incognito prozoru, pre unosa koda, otvori direktno `/chat` ili `/documents`: mora da te vrati na unos koda.
   5. Javi Claude-u ishod; on u bazi proverava zapis `mfa_enrolled`.

   Ako je kod uvek „pogrešan", proveri da je na telefonu uključeno automatsko vreme. Ako se zaključaš (izgubljen telefon ili greška):
   Dashboard → Authentication → Users → tvoj nalog → ukloni faktor (vidi C5).

### B. Dashboard podešavanja (Supabase), redom po tome kad ti trebaju
Putanje u Supabase Dashboard-u (Authentication je u levom meniju):

| # | Šta | Kada ti treba | Kako |
|---|---|---|---|
| 1 | **TOTP MFA uključen** | Pre testiranja 2.5.3 | Authentication → Multi-Factor → TOTP: Enabled |
| 2 | Javna registracija isključena | Odmah (nasleđeno iz Faze 1) | Authentication → Sign In / Providers → „Allow new users to sign up" = OFF |
| 3 | URL Configuration | Pre testiranja 2.5.4 | Site URL = produkcioni domen. Redirect URLs: produkcioni domen + Vercel preview šablon (npr. `https://*-tvoj-tim.vercel.app/**`) |
| 4 | Sopstveni SMTP (npr. Resend, EU region) | Pre testiranja 2.5.4 | Authentication → SMTP Settings. Podrazumevani SMTP šalje vrlo malo mejlova i nije za produkciju. Resend traži da potvrdiš domen preko DNS zapisa |
| 5 | Rate Limits | Pre pilota | Authentication → Rate Limits: prođi login, registraciju i reset lozinke (ne prolaze kroz naš kod) |
| 6 | Zaštita od procurelih lozinki | Pre pilota | Authentication → Sign In / Providers → Email. **Samo Pro plan i više** (Supabase dokumentacija); na Free planu je nema, zato je Advisors i dalje prijavljuje. Još jedan razlog za Pro (backup je prvi, Faza 4) |
| 7 | JWT expiry 1 sat ili kraće | Pre pilota | Blokiran nalog zadržava važeći token do isteka |
| 8 | **Email šabloni (Invite user i Reset password)** | **TEK kad je 2.5.4 na produkciji** | Tačan tekst i koraci provere: `docs/email-templates.md`. **Ne menjaj ih ranije:** novi link vodi na `/auth/confirm` koje do deploy-a ne postoji, pa bi reset lozinke prestao da radi |
| 9 | **Minimalna dužina lozinke = 12** | Pre testiranja 2.5.4 | Authentication → Sign In / Providers → Email → Minimum password length. Forma u aplikaciji već traži 12, ali **samo ovo podešavanje to stvarno primorava**: lozinka ide iz pregledača direktno Supabase-u, pa ko ima sesiju može da zaobiđe formu. Ostavi „Require reauthentication when changing password" isključeno (naša forma ne podržava taj tok) |

### C. Odluke koje čekaju tebe (potvrdi ili promeni, može jednom rečenicom)
1. **CSV izvoz koristi `;` kao razdvajač** (srpski Excel očekuje `;`, a zarez je tamo decimalni znak). Jedna konstanta, lako se menja.
2. **Mesečni budžet tokena ne sme biti manji od dnevnog** (pravilo samo u formi).
3. **Ime advokata ne sme da sadrži `<`, `>` ni kontrolne znakove** (ide u mejl pozivnice).
4. **MFA za advokate (primenjeno):** uključivanje je opciono, ali ko ga uključi, ne može da preskoči kod. Kapija je u `proxy.ts` i u
   `requireUser()` (API rute, server akcije, stranice). Primenjeno kao preporuka, jer na pitanje nije stigao odgovor; ako se ne slažeš, reci.
5. **Izgubljen telefon admina:** Supabase za TOTP nema rezervne kodove. Vlasnik projekta uklanja faktor u
   Dashboard-u (Authentication → Users → korisnik → faktori), pa se admin ponovo prijavi i uključi novi. Prihvatljivo?
   (Alternativa „admin resetuje MFA drugom adminu" je dodatni posao i nije u planu.)
6. **NOVO, traži tvoju odluku: MFA štiti aplikaciju, ne i bazu.** Ko ima samo ukradenu lozinku, dobija od Supabase Auth-a sesiju bez koda
   (`aal1`) i preko REST API-ja (anon ključ je javan) može da čita sve što RLS dozvoljava tom nalogu: dokumente, pasuse, razgovore. Naša
   kapija to ne vidi. Rešenje je posebna migracija koja u bazi traži `aal2` za naloge sa uključenim MFA (menja RLS na svim tabelama, pa traži
   tvoje odobrenje i ponovni SQL test). Opcije: (a) odmah, kao 2.5.3b; (b) posle admin panela, a pre pilota (preporuka); (c) ne radimo.
   Napomena: ni to ne štiti naloge bez uključenog MFA, jer je za advokate opcion. Da li MFA treba da bude obavezan i za advokate? (Posebna odluka.)
7. **NOVO: audit za isključivanje MFA.** Uklanjanje faktora trenutno nije u audit logu (lista akcija u bazi nema takvu stavku). Dodavanje je
   mala migracija; preporuka je da ide zajedno sa tačkom 6, ako se ona radi.
8. **NOVO (2.5.6): blokada štiti aplikaciju, ne i REST pristup bazi.** Blokiran advokat sa još važećim tokenom (do 1 sat) i dalje može preko REST API-ja (javni anon ključ) da čita SVOJE redove, jer RLS ne proverava blokadu. Predlog: ista restriktivna polisa kao za MFA (tačka 6), pa jedna migracija proverava i `aal2` i da nalog nije blokiran (traži tvoje odobrenje i ponovni SQL test). Opcije: (a) odmah; (b) posle admin panela, a pre pilota (preporuka, zajedno sa tačkom 6); (c) ne radimo, uz JWT expiry od 1 sata (B7).

### D. Preneto iz Faze 2, obavezno pre prvog pilota
- Preview provere sa spuštenim limitima (`DAILY_MESSAGE_LIMIT=2`, `DAILY_DOCUMENT_LIMIT=2`, `IP_BURST_LIMIT=3`, pa vrati):
  429 `limit_reached`, upozorenje o sumnjivom PDF-u, brisanje + audit, open redirect (opisano u CLAUDE.md, „Rezultat" 2.3, 2.5, 2.6, 2.8).
  **Napomena:** od 2.5.2 env varijable samo ograničavaju odozgo; dok admin ne promeni podešavanja važe vrednosti iz baze
  (100/20/1.000.000/20.000.000), pa za ovakav test spusti env ispod tih vrednosti.
- `/activity` kao admin (moguće tek posle 2.5.3 i prvog admina).
- Vercel env varijable (spisak u CLAUDE.md, „Rezultat 2.9", korak 5).

## 2. Šta radi CLAUDE (redom, svaki korak je poseban čet ili dva)

Pravila za sve korake: test-prvo, pa `tsc`, lint, `next build`, `npm test`, `npm audit`; rad ide samo na `main`; Claude ne pravi commit
(radiš ti); rezultat se upisuje u `docs/admin-panel-plan.md` i `CLAUDE.md`; što zavisi od Supabase-a/Vercel-a piše kao „nije
proveravano" dok ti ne potvrdiš. Izgled admin stranica prati postojeću aplikaciju (boje `#16263D` i `#F7F3EC`, bele kartice,
isto kao `/activity`), bez nove biblioteke. Pre izmene `proxy.ts` Claude čita `node_modules/next/dist/docs/` (pravilo iz `AGENTS.md`).

### 2.5.3 MFA — URAĐENO i potvrđeno na produkciji (QR i kod rade, 2026-10-29)
Šta je napravljeno, koje su odluke donete umesto tebe i šta nije provereno: `docs/admin-panel-plan.md`, „Rezultat 2.5.3". Ukratko: kapija u
`proxy.ts` i `requireUser()` (nalog sa potvrđenim faktorom bez koda ne ulazi nigde osim na `/login/mfa`; API i server akcije dobijaju
401 `mfa_required`), stranice `/login/mfa` i `/account/security`, audit `mfa_enrolled` preko server akcije. Kapija je probana lokalno na pravom
`next start` sa lažnim Auth serverom (50 provera), ali QR i unos koda u browseru nisu probani: to je tvoj test.
Jedno odstupanje od ranijeg opisa: proxy nema poseban slučaj za `/admin/*` (ne zna ulogu bez upita u bazu); admin bez koda se usmerava iz
`/admin` layout-a u 2.5.5.

### 2.5.4 Pozivnica i postavljanje lozinke — URAĐENO i commit-ovano (`4316a87`), čeka tvoj test
Šta je napravljeno, odluke i šta nije provereno: `docs/admin-panel-plan.md`, „Rezultat 2.5.4". Ukratko: `/auth/confirm` (poziv i reset, samo
te dve vrste, `next` samo na naš sajt), `/set-password`, `/link-expired`, zajednička forma (12 znakova i na `/reset-password`), `/register` obrisana
(uključujući dva dugmeta na početnoj stranici, koja plan nije pominjao). Lokalno: 207/207 testova, 26 namernih grešaka uhvaćeno, 29 provera na
pravom `next start` sa lažnim Auth serverom. **Nije viđeno:** pravi Supabase, mejl, forma u browseru, tok reseta za nalog sa MFA.

**Tvoj deo (redom):**
1. **B3, B4, B9** (URL Configuration, SMTP, minimalna dužina lozinke). Bez SMTP-a Supabase šalje samo članovima tvoje organizacije.
2. ~~Commit i push~~ **Urađeno** (`4316a87`). Proveri samo da je Production „Ready". **Pažnja:** ovo je menjalo `proxy.ts` i uklonilo `/register`.
3. Kad je Production „Ready", **pre menjanja šablona**: otvori `/auth/confirm?token_hash=x&type=invite` (mora da prikaže „Link nije važeći"),
   `/register` (mora da te vrati na prijavu) i početnu stranicu (nema „Započni besplatno").
4. **B8:** zalepi šablone iz `docs/email-templates.md`, pa prođi proveru na dnu tog fajla (reset, poziv iz Dashboard-a, isti link drugi put).
5. Ako imaš nalog sa uključenim MFA: reset lozinke za njega (`/forgot-password` → mejl → kod iz aplikacije → nova lozinka). Javi ishod ako puca.
6. Javi Claude-u ishod; sledeći korak je 2.5.5.

### 2.5.5 Admin okvir i pregled — URAĐENO, commit-ovano (`01d79e5`), potvrđeno na produkciji (ulaz u `/admin` sa MFA)
Šta je napravljeno, odluke i šta nije provereno: `docs/admin-panel-plan.md`, „Rezultat 2.5.5". Ukratko: `/admin` (Pregled): nalozi (ukupno,
aktivni, pozvani, blokirani), potrošnja (poruke, dokumenti, obrada, najveći potrošač), važeći limiti i lista advokata na 80% ili više limita.
Pristup proveravaju layout I svaka stranica; advokat dobija 404 (bez ijednog teksta panela, ni u naslovu taba), admin bez koda se vodi na
unos koda ili uključivanje MFA. Lokalno: 231/231 testova, 25 namernih grešaka uhvaćeno, 27 provera na pravom `next start` sa lažnim
Supabase-om. **Nije viđeno:** pravi Supabase sa pravim `aal2` tokenom, izgled u browseru, pravi MFA tok.

**Tvoj deo (redom):**
1. Commit i push (predlog poruke: `faza 2.5.5 admin pregled`). `main` je produkcija; ovo dodaje samo novu rutu `/admin` i ne menja postojeće stranice.
2. Kad je Production „Ready": odeljak 3 ispod („Prvi admin"): SQL za ulogu, MFA na `/account/security`, prijava sa kodom, pa otvori
   `https://<tvoj-domen>/admin` (**linka u aplikaciji još nema**, stiže u 2.5.9).
3. Očekuješ: Ukupno 3, Aktivni 3, Pozvani 0, Blokirani 0; poruke i dokumenti danas prema tvojoj upotrebi; „Nijedan advokat nije blizu limita".
4. Proveri i da te `/admin` ne pušta: (a) u incognito prozoru bez prijave vodi na prijavu; (b) sa običnim advokatskim nalogom (npr. jedan od druga dva
   u bazi) daje 404; (c) sa adminom koji ima MFA, a još nije uneo kod, traži kod. Javi ishod.

### 2.5.6 Advokati — URAĐENO, migracija primenjena, commit-ovano (`55cd533`), čeka tvoj test na produkciji
Šta je napravljeno, odluke i šta nije provereno: `docs/admin-panel-plan.md`, „Rezultat 2.5.6". Ukratko: `/admin/users` (tabela naloga sa stanjem, ulogom, MFA, poslednjom prijavom, potrošnjom i formom za poziv), `/admin/users/<id>` (nazivi i datumi dokumenata i razgovora, bez sadržaja; dugmad sa potvrdom), akcije poziv / ponovno slanje / blokada / odblokada / uloga. **Blokada ima dva izvora** (`banned_until` iz Auth-a i nova kolona `profiles.disabled_at`), jer nije utvrđeno da `getUser()` odbija blokiranog korisnika sa još važećim tokenom; proverava ih `requireUser()` pri svakom zahtevu. Lokalno: 263/263 testova, SQL test na lokalnoj bazi (16 namernih grešaka u migraciji uhvaćeno), 71 provera na pravom `next start` sa lažnim Supabase-om (uključujući pozivanje samih server akcija). **Nije viđeno:** pravi Supabase (migracija nikad nije pokrenuta na pravoj bazi), izgled u browseru, pravi mejl.

**Stavke 1 do 4 su urađene 2026-10-29** (migracija primenjena, `phase256` test prošao, Advisors tačno 5 + 2 stara, push `55cd533`). Nije prijavljen rezultat `phase25`, `phase2` i `phase1` testa posle migracije. Ostaje stavka 5 (test na produkciji).

**Tvoj deo (redom; redosled je obavezan):**
1. **SQL Editor: primeni `supabase/migrations/20261029100000_phase256_user_blocking.sql`, PRE commit-a i push-a.** Novi kod čita `profiles.disabled_at` i bez nje odbija SVAKI zahtev svakog korisnika (503), uključujući chat. Ako migracija pukne, pošalji ceo ispis i ne puštaj kod.
2. Pokreni testove, svaki mora da ispiše „prošli": `supabase/tests/phase256_users_test.sql` (novi), `phase25_admin_test.sql` (**izmenjen**, uzmi ga iz repozitorijuma, ne iz stare kopije), `phase2_rls_test.sql`, `phase1_rls_test.sql`.
3. Advisors → Security: očekuješ **5** upozorenja „security definer function executable by authenticated" (`admin_list_users`, `admin_get_user`, `admin_set_role`, `admin_update_settings`, `admin_set_disabled`), nijedno drugo.
4. Tek onda commit i push (predlog poruke: `faza 2.5.6 advokati`). `main` je produkcija.
5. Kad je Production „Ready":
   1. **Pošalji jednu poruku u chat** (odeljak 1A, tačka 1) i javi Claude-u da proveri novi red u `usage_ledger`.
   2. `/admin` → **Advokati**: vidiš naloge sa stanjem (Aktivan / Pozvan / Blokiran), ulogom, MFA i potrošnjom.
   3. Klikni svoj nalog: nema dugmadi „Blokiraj" ni promene uloge, piše „Ovo je vaš nalog".
   4. Klikni drugi nalog: vidiš nazive dokumenata i razgovora (ne sadržaj) i napomenu da je pregled zabeležen. U SQL Editoru: `select action, resource_id, created_at from public.audit_log where action = 'admin_viewed_user' order by created_at desc limit 3;` mora da vrati red za svako otvaranje.
   5. **Blokada (treba drugi nalog, npr. jedan od starih test naloga):** drugi nalog se prijavi u incognito prozoru i ostavi chat otvoren. Ti ga blokiraš na stranici njegovog naloga (potvrda). Taj nalog pošalje poruku u chatu: **odmah** dobija „Vaš nalog je blokiran…" (ne tek posle sat vremena). Odjavi se i pokušaj prijavu: ne uspeva. Ti ga odblokiraš: prijava i chat rade. Zapisi: `select action, resource_id, created_at from public.audit_log where action in ('user_disabled', 'user_enabled') order by created_at desc limit 4;`
   6. **Poziv** radi tek kad su urađeni B3, B4 i B8 (URL Configuration, SMTP, email šabloni): pozovi novu adresu sa forme; mejl stiže, link otvara „Postavite lozinku", posle čuvanja si u chatu, a nalog ima ulogu advokata. Ako mejl ne stiže ili forma javi grešku, pošalji tačnu poruku.
   7. Javi ishod; sledeći korak je 2.5.7.

### 2.5.7 Aktivnost i CSV izvoz
`app/admin/activity/page.tsx` (filteri advokat/akcija/period, najviše 90 dana, strane po 50), `auditFilterSchema` (beogradski datumi),
`app/api/admin/audit/export/route.ts` (CSV iz `lib/csv.ts`, najviše 50.000 redova, upisuje `audit_exported` PRE slanja).

### 2.5.8 Podešavanja kancelarije
`app/admin/settings/page.tsx`: četiri limita, uz trenutnu vrednost i gornju granicu iz env-a; snimanje preko `admin_update_settings`.

### 2.5.9 Ulaz u panel
`Sidebar.tsx` dobija prop `isAdmin` (link „Admin panel") i link „Bezbednost naloga" za sve; `GET /api/me` (`{ role }`) za `app/chat/page.tsx`.

### 2.5.10 Završna provera Faze 2.5
Ručni E2E iz `docs/admin-panel-plan.md` (osam tačaka), Advisors, `tsc`/lint/build/test/audit, pa u CLAUDE.md Faza 2.5 postaje `[x]`.

## 3. Prvi admin (radiš ti, tek kad je 2.5.5 na produkciji; do tada `/admin` ne postoji)
**Urađeno 2026-10-29:** u bazi je 1 admin sa 1 potvrđenim faktorom, a `/admin` se otvara. Ostalo u ovom odeljku važi samo za naredne admine.
1. Prijavi se svojim nalogom da bi imao nalog i profil.
2. SQL Editor (promeni mejl): `update public.profiles set role = 'admin' where email = 'tvoj@mejl.rs' returning id, email, role;`
   **Mora da vrati tačno 1 red.** Ako vrati 0, nalog nema profil; javi Claude-u.
3. Ako MFA već nisi uključio (2.5.3), otvori `/account/security` i uključi ga; odjavi se, prijavi se (traži kod), pa otvori `/admin`.
4. Do tada admina nema (u bazi je 0), i to je ispravno.

## 4. Kako znamo da je Faza 2.5 gotova
- Svih osam ručnih E2E tačaka iz plana (admin bez MFA ne ulazi; advokat dobija 404 na `/admin` i `42501` na RPC; poziv stiže mejlom;
  blokiran advokat ne može da se prijavi; limit 2 daje 429 na trećoj poruci; CSV se otvara sa ispravnim slovima; Advisors bez neočekivanog).
- `phase1`, `phase2` i `phase25` SQL testovi prolaze na pravoj bazi.
- U CLAUDE.md Faza 2.5 je `[x]`, a Faza 3 (bezbednost fajlova) je sledeća.

## 5. Šta uneti na početku sledećeg ćaskanja
Kopiraj ceo blok ispod. Nema šta da se popunjava (jedino opciona linija „Dopuna od mene"); sve što ne piše kao urađeno Claude smatra neurađenim i proverava u bazi. Svaki čet na kraju zamenjuje ovaj odeljak novim promptom.

```
Pročitaj redom: CLAUDE.md, docs/next-steps.md, docs/admin-panel-plan.md (naročito „Rezultat 2.5.6" i korake 2.5.7 do 2.5.10) i memoriju (local-verification-recipe). Odgovaraj na srpskom.

STANJE (29.10.2026.)
- Faze 1 i 2 su zatvorene. Faza 2.5 (admin panel): urađeni su 2.5.1 do 2.5.6. Poslednji commit je 55cd533 („faza 2.5.6 advokati"), push-ovan. Migracija 20261029100000 je primenjena na Supabase-u (phase256 test je prošao na pravoj bazi, Advisors bez novih upozorenja).
- Potvrđeno na produkciji: 2.5.3 (MFA) i 2.5.5 (/admin pregled). NIJE probano: 2.5.4 (pozivnica i postavljanje lozinke) i 2.5.6 (advokati, blokada).
- Ostaje: 2.5.7 Aktivnost + CSV izvoz, 2.5.8 Podešavanja, 2.5.9 Ulaz u panel, 2.5.10 Završna provera. Zatim (predlog) 2.5.11 tvrdi RLS, pa Faza 3 (bezbednost fajlova) i Faza 4 (isporuka kancelariji).

KORAK 0, pre ikakvog koda (veruj bazi, ne meni): preko Supabase MCP-a (read-only) pokreni
  select (select max(created_at) from public.usage_ledger) as poslednji_chat_red,
         (select count(*) from public.audit_log where action = 'admin_viewed_user') as pregledi_naloga,
         (select count(*) from public.audit_log where action in ('user_disabled', 'user_enabled')) as blokade,
         (select count(*) from public.audit_log where action = 'user_invited') as pozivi,
         (select count(*) from public.profiles where disabled_at is not null) as blokirani,
         (select max(last_sign_in_at) from auth.users) as poslednja_prijava;
i javi mi u par redova šta je potvrđeno, a šta nije.
- Ako je poslednji_chat_red stariji od 2026-10-28 14:57, chat posle izmena 2.5.2, 2.5.3 i 2.5.6 nije potvrđen: reci mi da pošaljem jednu poruku, pa proveri novi red. Ako chat vrati grešku (403 ili 503), to je prioritet nad svim ostalim (superpowers:systematic-debugging).
- Ono što ne vidiš iz baze (izgled u browseru, stiže li mejl) pitaj me. Sve što ovde ne piše kao urađeno smatraj neurađenim, uključujući Dashboard stavke B2 do B9 iz next-steps.md.
- Dopuna od mene (opciono): ____

ZADATAK OVOG ČETA: 2.5.7, pa 2.5.8 ako stane (2.5.9 i 2.5.10 idu u sledeći čet). Pazi na ovo:
- 2.5.7: auditFilterSchema (advokat, akcija, period do 90 dana) radi sa BEOGRADSKIM datumima. Pretvaranje u UTC mora da preživi promenu sata (29.3. i 25.10.2026.): test-prvo sa ručno izvedenim literalima. Stranica čita audit_log preko korisničkog klijenta (RLS + aal2), keyset paginacija po (created_at, id), 50 po strani, opisi iz lib/activity.ts.
- 2.5.7 izvoz je GET ruta: requireAdmin + mfa === 'ok', zod za filtere, lib/csv.ts (delimiter ';', zaštita od CSV injection), UTF-8 sa BOM-om, audit_exported se upisuje PRE slanja, najviše 50.000 redova. Supabase vraća najviše 1000 redova po upitu (max_rows, proveri), a Vercel odbija ne-streaming odgovor veći od oko 4,5 MB (proveri u dokumentaciji), pa izvoz mora da ide u petlji po stranicama i da se strimuje.
- 2.5.8: forma za 4 limita (settingsSchema postoji), prikaz trenutne vrednosti i env gornje granice, snimanje preko RPC-a admin_update_settings; promena važi odmah.

MOJE ODLUKE (važe osim ako ispod dopišem drugačije)
- C1 do C5 kako su predložene u next-steps.md (CSV ';', mesečni budžet ≥ dnevni, ime bez < i >, MFA kapija za naloge sa uključenim MFA, izgubljen telefon = ja uklanjam faktor u Dashboard-u).
- C6, C7, C8 (aal2 i blokada na nivou baze, audit uklanjanja MFA): opcija (b), jedna migracija „2.5.11" posle 2.5.10 a pre Faze 3. Na početku 2.5.11 pitaj me da li MFA postaje obavezan i za advokate.
- Alate za proveru (proba na pravom next start sa lažnim Supabase-om, kasnije i PGlite harness) sačuvaj u repo u tools/verify/ sa sopstvenim package.json i kratkim README-om, tako da npm run lint, tsc i next build ostanu čisti. Prvo mi u dve rečenice reci šta dodaješ.

PRAVILA (uvek)
- Test-prvo (superpowers:test-driven-development): vidi test kako pada iz pravog razloga, pa piši kod; posle toga namerne greške (mutacije) u novom kodu.
- Samo main, bez novih grana i BEZ commit-a (commit i push radim ja).
- Svaka stranica u app/admin zove requireAdminPage(next), svaka server akcija requireAdminAction(), svaka admin ruta requireAdmin() i proverava mfa === 'ok'. Stranice u app/admin NEMAJU metadata (naslov taba otkriva panel). Čitanja idu preko korisničkog klijenta, supabaseAdmin samo za upise i Auth Admin API (trajna pravila 1 do 7 u CLAUDE.md).
- Migracija: fajl u supabase/migrations + SQL test; ja je primenjujem PRE push-a (kod zavisi od nje); posle toga 4 SQL testa i Advisors. RLS tabela iz Faze 1 ne diraj bez mog odobrenja.
- Pre pisanja Next koda pročitaj relevantne strane u node_modules/next/dist/docs/ (AGENTS.md).
- Pre izveštaja: npm test, tsc, lint, next build (sa NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321), npm audit --omit=dev i proba na pravom next start. Izveštaj pošten: „viđeno" odvojeno od „nije proveravano".
- Velike fajlove piši alatom Write, ne bash heredoc-om (dugačka komanda se seče).

KRAJ ČETA: upiši rezultat u docs/admin-panel-plan.md, CLAUDE.md i docs/next-steps.md; napiši „Tvoj deo" (SQL, Dashboard, ručni testovi); u docs/next-steps.md zameni odeljak 5 novim promptom za sledeći čet.
```
