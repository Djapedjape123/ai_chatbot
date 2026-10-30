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
| 2.5.6 Advokati (tabela, pregled jednog, poziv, blokada, uloga) | Commit-ovan i push-ovan (`55cd533`), migracija primenjena i `phase256` test prošao na pravoj bazi (2026-10-29); **na produkciji delimično viđeno:** u bazi je `user_invited` (2026-10-29 16:59 UTC, akcija poziva prolazi), a pregled naloga, blokada, mejl i link nisu probani (odeljak 2, „2.5.6") |
| 2.5.7 Aktivnost (`/admin/activity`) + CSV izvoz | Commit-ovano i push-ovano (`0b12fbe`); probano lokalno (129 provera na pravom `next start`, 334 testa, mutacije); **na produkciji nije viđeno** (u bazi `audit_exported` 0); bez migracije (odeljak 2, „2.5.7") |
| 2.5.8 Podešavanja (`/admin/settings`) | Isto kao 2.5.7, u istom commit-u (u bazi `settings_changed` 0) (odeljak 2, „2.5.8") |
| 2.5.9 Ulaz u panel (`GET /api/me`, veze u meniju) | Kod napisan i probano lokalno, uključujući pravi pregledač (proba 35/35, 340 testova, mutacije); commit-ovano (`ad83132`), **meni na produkciji nije viđen**; bez migracije (odeljak 2, „2.5.9") |
| 2.5.10 Završna provera | Provere koje Claude sme su urađene (Advisors, `tsc`/lint/build/test/audit, stanje baze); **ručne tačke čekaju tebe** (SQL testovi: javio si 2026-10-29 da su sva četiri prošla) (odeljak 2, „2.5.10"). Faza 2.5 ostaje `[ ]` |
| 2.5.11 Tvrdi RLS: `aal2` + blokada na nivou baze + audit uklanjanja MFA | **Napisano i provereno lokalno (2026-10-29), NIJE primenjeno na Supabase-u i nije commit-ovano.** Migracija `20261029110000_phase2511_hard_rls.sql`, test `phase2511_hard_rls_test.sql`, PGlite harness u `tools/verify/` (5 SQL testova prolazi, 38 od 39 mutacija uhvaćeno, 1 ekvivalentna), akcija `mfa_removed` u aplikaciji (341/341 testova). Izmenjena su i dva stara SQL testa (`phase1`, `phase2`). **Čeka tvoj deo: odeljak 2, „2.5.11"** |
| 3. Bezbednost fajlova | Posle 2.5 |
| 4. Isporuka kancelariji | Posle faze 3 |

## 1. Šta radiš TI (pre sledećeg ćaskanja)

### A. Odmah
Već urađeno: `phase2_rls_test.sql` je prošao (2026-10-28), a kod 2.5.1 i 2.5.2 plus dokumenti su commit-ovani i na GitHub-u (`83169e3`).

1. **Još nije urađeno, a sad je važnije: pošalji jednu poruku u chat na produkciji PRE nego što pustiš 2.5.6** (Vercel deploy mora biti „Ready"). U `usage_ledger` još nema
   nijednog reda posle izmene iz 2.5.2 (poslednji je iz 15:57, smoke test Faze 2). Javi Claude-u da proveri novi red. Razlog: 2.5.3 menja
   i `/api/chat` (prelazak na `requireUser()`), pa ako bi chat posle toga prestao da radi, ne bi se znalo koja je izmena kriva. Od 2026-10-29 u `usage_ledger` i dalje nema reda posle 2.5.2, a 2.5.6 opet menja `requireUser()` (sada čita i profil), pa su na produkciji neproverene tri izmene u nizu. Proveravano ponovo na kraju četa 2.5.9 (2026-10-29): i dalje nema novog reda u `usage_ledger`; Supabase log pokazuje da `requireUser()` radi za GET rute (22 uspešna čitanja `chats` u 24 sata), ali nijedan poziv `reserve_usage`.
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
6. **MFA štiti aplikaciju, ne i bazu (napisano u 2.5.11, čeka primenu na Supabase-u, odeljak 2).** Ko ima samo ukradenu lozinku, dobija od Supabase Auth-a sesiju bez koda
   (`aal1`) i preko REST API-ja (anon ključ je javan) može da čita sve što RLS dozvoljava tom nalogu: dokumente, pasuse, razgovore. Naša
   kapija to ne vidi. Rešenje je posebna migracija koja u bazi traži `aal2` za naloge sa uključenim MFA (menja RLS na svim tabelama, pa traži
   tvoje odobrenje i ponovni SQL test). Opcije: (a) odmah, kao 2.5.3b; (b) posle admin panela, a pre pilota (preporuka); (c) ne radimo.
   Napomena: ni to ne štiti naloge bez uključenog MFA, jer je za advokate opcion. Da li MFA treba da bude obavezan i za advokate? (Posebna odluka.) **Odluka vlasnika 2026-10-29: opcija (b), jedna migracija 2.5.11 posle 2.5.10 a pre Faze 3. Odgovor 2026-10-29 na pitanje o obaveznom MFA za advokate: NE, ostaje opcion, opcija (a) (opcije i plan: `docs/admin-panel-plan.md`, „Korak 2.5.11"). Nalaz: restriktivna polisa ide na 6 tabela, a NE na `profiles`, jer bi blokiran nalog sakrio `disabled_at` od `requireUser()`, koji „profil se ne vidi" tumači kao „nije blokiran".**
7. **Audit za isključivanje MFA (napisano u 2.5.11, čeka primenu; beleži se samo uklanjanje POTVRĐENOG faktora).** Uklanjanje faktora trenutno nije u audit logu (lista akcija u bazi nema takvu stavku). Dodavanje je
   mala migracija; preporuka je da ide zajedno sa tačkom 6, ako se ona radi.
8. **(2.5.6; napisano u 2.5.11, čeka primenu): blokada štiti aplikaciju, ne i REST pristup bazi.** Blokiran advokat sa još važećim tokenom (do 1 sat) i dalje može preko REST API-ja (javni anon ključ) da čita SVOJE redove, jer RLS ne proverava blokadu. Predlog: ista restriktivna polisa kao za MFA (tačka 6), pa jedna migracija proverava i `aal2` i da nalog nije blokiran (traži tvoje odobrenje i ponovni SQL test). Opcije: (a) odmah; (b) posle admin panela, a pre pilota (preporuka, zajedno sa tačkom 6); (c) ne radimo, uz JWT expiry od 1 sata (B7).

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

### 2.5.7 Aktivnost i CSV izvoz — URAĐENO, commit-ovano (`0b12fbe`), čeka tvoj test na produkciji
Šta je napravljeno, odluke i šta nije provereno: `docs/admin-panel-plan.md`, „Rezultat 2.5.7". Ukratko: `/admin/activity` (filteri: advokat, vrsta, period u beogradskim datumima do 90 dana, podrazumevano 7 dana; 50 zapisa po strani, paginacija po kursoru `(created_at, id)`: „Starije →" i „← Na početak") i `GET /api/admin/audit/export` (CSV, razdvajač `;`, UTF-8 sa BOM-om, najviše 50.000 najnovijih redova, strim, `audit_exported` se upisuje PRE slanja i ako upis ne uspe izvoz se ne šalje). **Bez migracije:** baza već ima sve (provereno preko MCP-a). Lokalno: `npm test` 334/334, proba na pravom `next start` sa lažnim Supabase-om (129 provera za 2.5.7 i 2.5.8 zajedno), namerne greške. **Nije viđeno:** pravi Supabase REST (naročito `or=(…)` filter sa vremenima pod navodnicima i `max_rows`), Vercel, izgled u browseru, otvaranje CSV-a u Excel-u.

### 2.5.8 Podešavanja kancelarije — URAĐENO, commit-ovano (`0b12fbe`), čeka tvoj test na produkciji
Šta je napravljeno, odluke i šta nije provereno: `docs/admin-panel-plan.md`, „Rezultat 2.5.8". Ukratko: `/admin/settings` (četiri limita sa vrednošću iz baze, gornjom granicom iz env-a i napomenom kad granica skraćuje vrednost) i akcija `updateSettings` preko `admin_update_settings` (audit `settings_changed` upisuje baza; iste vrednosti se ne snimaju). Promena važi odmah. Bez migracije.

**Tvoj deo za 2.5.7 i 2.5.8 (redom):**
1. ~~Commit i push~~ **Urađeno** (`0b12fbe`, na GitHub-u; nema SQL-a ni migracije). Proveri samo da je Production „Ready". Novo su `/admin/activity`, `/admin/settings` i `/api/admin/audit/export`; od postojećeg je dirnuto samo: boja zapisa u `/activity` (ista), `lib/csv.ts` i `lib/audit.ts` (isto ponašanje, uz novu funkciju).
2. Kad je Production „Ready":
   1. **Pošalji jednu poruku u chat** (odeljak 1A, tačka 1) i javi Claude-u da proveri novi red u `usage_ledger`. U bazi još nema reda posle 2026-10-28 14:57, a od tada su se promenile `/api/chat` (2.5.2), `requireUser` (2.5.3, 2.5.6) i čitanje podešavanja (2.5.2).
   2. `/admin` → **Aktivnost**: vidiš svoje zapise (u bazi ih je 8, sa tvojim MFA zapisom), vreme je beogradsko. Probaj filter „Vrsta aktivnosti", filter „Advokat" i izbor jednog dana. Unesi period duži od 90 dana (datum ručno): poruka na stranici, bez greške.
   3. **„Preuzmi CSV"**: preuzima se `aktivnost_<od>_<do>.csv`. Otvori ga dvoklikom u Excel-u: slova č, ć, š, ž, đ moraju biti ispravna i podaci razdvojeni u 11 kolona. **Ako je sve u jednoj koloni, javi** (znači da je potreban zarez umesto `;`, odluka C1, jedna konstanta).
   4. Vrati se na **Aktivnost**: na vrhu mora biti novi zapis „Izvezen dnevnik aktivnosti" sa periodom i brojem redova. SQL: `select action, metadata, created_at from public.audit_log where action = 'audit_exported' order by created_at desc limit 3;`
   5. **Podešavanja**: vidiš 100 / 20 / 1.000.000 / 20.000.000. Ako su na Vercel-u postavljene env granice (`DAILY_MESSAGE_LIMIT` i ostale) ispod tih vrednosti, piše „Važi gornja granica ugovora: X" (javi koje vrednosti vidiš, da ih upišem u dokument). Promeni dnevni limit poruka na **2** i sačuvaj („Podešavanja su sačuvana"), pa pošalji 3 poruke u chat: treća mora da vrati poruku o dnevnom limitu (429). **Vrati na 100.** SQL: `select action, metadata, created_at from public.audit_log where action = 'settings_changed' order by created_at desc limit 3;` mora da pokaže staro i novo.
   6. **Kao advokat** (drugi nalog, običan prozor ili incognito) otvori `/admin/activity` i `/admin/settings`: oba daju 404, kao i `/api/admin/audit/export`.
   7. Javi ishod. **Paginacija na produkciji ne može da se isproba:** strana ima 50 zapisa, a u bazi ih je 8; proveri je kad se nakupi, ili preskoči (proba je pokriva sa 120 zapisa, uključujući zapise sa istim vremenom).

### 2.5.9 Ulaz u panel — URAĐENO, commit-ovano (`ad83132`), čeka tvoj test na produkciji
`Sidebar.tsx` dobija prop `isAdmin` (link „Admin panel") i link „Bezbednost naloga" za sve; `GET /api/me` (`{ role }`) za `app/chat/page.tsx`.

Šta je napravljeno, odluke i šta nije provereno: `docs/admin-panel-plan.md`, „Rezultat 2.5.9". Ukratko: meni u chatu dobija vezu „🔐 Bezbednost naloga" (svi) i „🛡️ Admin panel" (samo admin). Uloga stiže iz `GET /api/me`, koji vraća isključivo `{"role":"admin"}` ili `{"role":"lawyer"}`. Veza samo olakšava ulaz (panel i dalje daje 404 advokatu) i pojavljuje se sekundu posle učitavanja chata, jer se uloga čita posle učitavanja stranice. Lokalno: 340 testova, proba 35/35 u pravom pregledaču (Edge), namerne greške. **Nije viđeno:** produkcija. Izgled menija (desktop i telefon) sam gledao samo na snimcima ekrana iz Edge-a.

**Tvoj deo (redom):**
1. ~~Commit i push~~ **Urađeno** (`ad83132`; nema SQL-a ni migracije). Proveri samo da je Production „Ready". `main` je produkcija; novo su `GET /api/me`, dve veze u meniju chata i `lib/me.ts` (+ test), uz alate u `tools/verify/`.
2. Kad je Production „Ready":
   1. **Pošalji jednu poruku u chat** (odeljak 1A, tačka 1) i javi Claude-u da proveri novi red u `usage_ledger`.
   2. Kao admin: u meniju chata (levo), ispod „Aktivnost", vidiš „Bezbednost naloga", a sekundu posle učitavanja i „Admin panel". Klik otvara `/admin`.
   3. Običan advokatski nalog (incognito prozor): vidi „Bezbednost naloga", **ne vidi** „Admin panel".
   4. Telefon (ili uzak prozor): otvori meni dugmetom u gornjem levom uglu; obe veze staju, a klik zatvara meni.
   5. Javi ishod.

### 2.5.10 Završna provera Faze 2.5 — provere urađene, čekaju se tvoje ručne tačke
**Stanje baze 2026-10-29 18:00 UTC (čet 2.5.11, bez tvoje dopune):** pozvani nalog je potvrdio mejl 35 s posle poziva (mejl je stigao), ali je u logu `GET /auth/v1/verify?token=…&type=invite&redirect_to=<produkcioni domen>`: to je **podrazumevani Supabase link, a ne naš `/auth/confirm`**, dakle šablon „Invite user" (B8, `docs/email-templates.md`) nije bio primenjen. Nalog je dobio sesiju, a **tok do `/set-password` nije prošao** (u logu za 24 sata nema nijednog `PUT /auth/v1/user`). Poziv do kraja je neproveren dok B8 nije urađen. Pregled naloga viđen na produkciji (`admin_viewed_user` 2). Blokada, CSV izvoz i promena podešavanja: 0 zapisa. **Chat i dalje nije potvrđen** (poslednji red u `usage_ledger` je 2026-10-28 14:57, nijedan poziv `reserve_usage` u logu).
Ručni E2E iz `docs/admin-panel-plan.md` (osam tačaka), Advisors, `tsc`/lint/build/test/audit, pa u CLAUDE.md Faza 2.5 postaje `[x]`.

Detalji: `docs/admin-panel-plan.md`, „Rezultat 2.5.10". **Faza 2.5 u CLAUDE.md ostaje `[ ]` dok ne potvrdiš ručne tačke.** Urađeno 2026-10-29: Advisors (tačno 5 upozorenja za `admin_*` + `vector` + zaštita od procurelih lozinki + namerni INFO za `ip_rate_limit`), provera stanja baze (RLS, grantovi), `tsc`, lint (0 grešaka), `next build`, `npm test` 340/340, `npm audit` 0, obe probe na pravom `next start` (129/129 i 35/35).

**Tvoj deo (redom):**
1. **Urađeno (javio si 2026-10-29: sva četiri prošla).** Za ponavljanje posle sledeće migracije: pokreni sva četiri testa, svaki mora da ispiše „prošli": `supabase/tests/phase1_rls_test.sql`, `phase2_rls_test.sql`, `phase25_admin_test.sql`, `phase256_users_test.sql` (uzmi ih iz repozitorijuma). Poznato je samo da je `phase256` prošao posle poslednje migracije. Ako neki puca, pošalji ceo ispis.
2. **Ručne tačke** (označi koje si prošao):
   - [ ] 1. Incognito, admin nalog: prijava lozinkom, **ne unosi kod**, otvori `/admin`: mora da traži kod. (Ulaz sa kodom si već probao.)
   - [ ] 2. Advokatski nalog: `/admin` daje 404. Pa provera `42501` preko REST-a (traži lozinku advokatskog naloga). U terminalu, sa vrednostima iz Dashboard-a (Project Settings → API):
     ```
     curl -s -X POST "$URL/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{"email":"<advokat>","password":"<lozinka>"}'
     curl -s -X POST "$URL/rest/v1/rpc/admin_list_users" -H "apikey: $ANON" -H "Authorization: Bearer <access_token iz prvog odgovora>" -H "Content-Type: application/json" -d '{}'
     ```
     Drugi odgovor mora da sadrži `42501`.
   - [ ] 3. Poziv novog advokata (zavisi od B3, B4, B8, B9): odeljak 2, „2.5.6 Advokati", tačka 5.6.
   - [ ] 4. Blokada: odeljak 2, „2.5.6 Advokati", tačka 5.5.
   - [ ] 5. Podešavanja: limit 2 pa 429 na trećoj poruci, **vrati na 100**: odeljak 2, „Tvoj deo za 2.5.7 i 2.5.8", tačka 2.5.
   - [ ] 6. CSV u Excel-u: odeljak 2, „Tvoj deo za 2.5.7 i 2.5.8", tačka 2.3.
3. Javi koje tačke prolaze, a koje ne (i da li je `;` u CSV-u radio). Kad su 1 do 6 potvrđene, Faza 2.5 postaje `[x]`.
4. **Urađeno: odgovor je NE, MFA ostaje opcion (opcija (a)).** Staro pitanje za 2.5.11: (odeljak 1C, tačka 6): da li MFA postaje obavezan i za advokate? Opcije (a), (b), (c) i preporuka su u `docs/admin-panel-plan.md`, „Korak 2.5.11".

### 2.5.11 Tvrdi RLS (aal2 + blokada u bazi + audit uklanjanja MFA) — NAPISANO i provereno lokalno, NIJE primenjeno na Supabase-u
Šta je napravljeno, odluke i šta nije provereno: `docs/admin-panel-plan.md`, „Rezultat 2.5.11". Ukratko: šest restriktivnih polisa (`documents`, `document_chunks`, `chats`, `messages`, `usage_ledger`, `audit_log`) koje se I-uju sa postojećim: nalog sa **potvrđenim MFA faktorom** vidi podatke samo sa tokenom `aal2`, nalog koji je **blokiran** (`profiles.disabled_at` ili aktivan `banned_until`) ne vidi ništa ni sa važećim tokenom, nalog bez faktora radi kao pre. `profiles` namerno NEMA polisu (aplikacija po njemu otkriva blokadu). Okidač na `auth.mfa_factors` upisuje `mfa_removed` kad se obriše potvrđen faktor (ko je uklonio, baza ne zna). Zatvara C6, C7 i C8 čim se ovo primeni i proveri.

Lokalno (PGlite, `node tools/verify/run-sql-tests.mjs`): sva 5 SQL testova prolaze; 39 mutacija migracije (38 uhvaćeno, 1 ekvivalentna); `npm test` 341/341, `tsc`, lint, build, audit, probe 129/129 i 35/35. **Nije viđeno:** ništa na pravoj bazi, a naročito okidač koji pali pravi Auth server (korak 2).

**Tvoj deo (redom; redosled je obavezan):**
1. **SQL Editor: primeni `supabase/migrations/20261029110000_phase2511_hard_rls.sql`, PRE commit-a i push-a.** Mora da završi bez greške. Jedna je transakcija: ako pukne, baza je netaknuta; pošalji ceo ispis. Kod ne zavisi od migracije (dodaje samo prikaz nove akcije), pa nema prozora u kom nešto ne radi.
2. **Odmah posle, pre svega ostalog: proba okidača** (jedino što lokalni harness ne može da dokaže: da li Auth server pali okidač na tabeli `auth.mfa_factors` bez greške). Nalog bez faktora (npr. onaj koji počinje sa `ebaad2f0`, nema podataka): prijavi ga u incognito prozoru, `/account/security` → uključi dvostepenu prijavu (QR, kod). Zatim ga isključi **ili** u Dashboard-u (Authentication → Users → taj nalog → ukloni faktor). Uklanjanje mora da prođe bez greške, a u SQL Editoru:
   ```sql
   select action, actor_email, resource_id, metadata, created_at
   from public.audit_log where action = 'mfa_removed' order by created_at desc limit 3;
   ```
   mora da vrati red sa `metadata` = `{"status": "verified", "factor_type": "totp"}`. **Ako uklanjanje pukne ili zapisa nema:** odmah `drop trigger if exists on_mfa_factor_removed on auth.mfa_factors;` i javi ispis (uklanjanje faktora tada opet radi, samo bez traga). Ne koristi svoj admin nalog za ovu probu.
3. **Pet SQL testova**, svaki mora da ispiše „prošli". Uzmi fajlove iz repozitorijuma (**`phase1` i `phase2` su izmenjeni**, stare kopije bi pale): `supabase/tests/phase1_rls_test.sql`, `phase2_rls_test.sql`, `phase25_admin_test.sql`, `phase256_users_test.sql`, `phase2511_hard_rls_test.sql`. Ako neki puca, pošalji ceo ispis (`CURENJE: …` znači da nešto vidi previše, `PRESTROGO: …` da nalog gubi pristup onome što treba da vidi).
4. **Advisors → Security:** isto kao pre, bez novih upozorenja: 5 `admin_*`, `vector` u šemi `public`, zaštita od procurelih lozinki i namerni INFO za `ip_rate_limit` (šema `private` nije izložena REST-u).
5. **C6: REST sa tokenom bez koda ne vidi ništa.** Vrednosti iz Dashboard-a (Project Settings → API). Koristi nalog sa MFA (tvoj admin). **Admin nema nijedan dokument ni razgovor, pa se provera radi preko `audit_log` (ima ga):**
   ```
   URL="https://<ref>.supabase.co"; ANON="<anon ključ>"
   # 1. prijava lozinkom daje token bez koda (aal1): zapiši "access_token" (T1) i "user.factors[0].id" (FAKTOR_ID)
   curl -s -X POST "$URL/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{"email":"<admin>","password":"<lozinka>"}'
   # 2. sa T1 mora da vrati [] (pre migracije vraća tvoje zapise)
   curl -s "$URL/rest/v1/audit_log?select=action,created_at" -H "apikey: $ANON" -H "Authorization: Bearer <T1>"
   # 3. KONTROLA (bez nje [] ne dokazuje ništa): podigni token na aal2
   curl -s -X POST "$URL/auth/v1/factors/<FAKTOR_ID>/challenge" -H "apikey: $ANON" -H "Authorization: Bearer <T1>"      # vraća "id" = CHALLENGE_ID
   curl -s -X POST "$URL/auth/v1/factors/<FAKTOR_ID>/verify" -H "apikey: $ANON" -H "Authorization: Bearer <T1>" -H "Content-Type: application/json" -d '{"challenge_id":"<CHALLENGE_ID>","code":"<6 cifara iz aplikacije>"}'     # vraća novi "access_token" (T2)
   # 4. isti upit sa T2 mora da vrati zapise
   curl -s "$URL/rest/v1/audit_log?select=action,created_at" -H "apikey: $ANON" -H "Authorization: Bearer <T2>"
   ```
6. **C8: blokiran nalog sa još važećim tokenom ne vidi ništa.** Nalog koji počinje sa `c7577c7f` ima 3 razgovora (advokat bez MFA):
   ```
   # 1. PRE blokade: prijava tim nalogom, zapiši "access_token" (T3)
   curl -s -X POST "$URL/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{"email":"<advokat>","password":"<lozinka>"}'
   # 2. kontrola: vidi 3 razgovora
   curl -s "$URL/rest/v1/chats?select=id" -H "apikey: $ANON" -H "Authorization: Bearer <T3>"
   # 3. u panelu: /admin/users → taj nalog → Blokiraj (potvrda)
   # 4. isti T3 (još važi) mora ODMAH da vrati []
   curl -s "$URL/rest/v1/chats?select=id" -H "apikey: $ANON" -H "Authorization: Bearer <T3>"
   # 5. profil MORA ostati čitljiv i pokazati blokadu (tako aplikacija zna da je nalog blokiran): 1 red, disabled_at nije null
   curl -s "$URL/rest/v1/profiles?select=id,disabled_at" -H "apikey: $ANON" -H "Authorization: Bearer <T3>"
   # 6. Odblokiraj u panelu; isti T3 opet vidi 3 razgovora.
   ```
   Ako nalog nemaš lozinku: isti test sa nalogom `ba1e7d91` (3 dokumenta), upit `…/rest/v1/documents?select=id`.
7. **Tek onda commit i push** (predlog poruke: `faza 2.5.11 tvrdi rls`). `main` je produkcija.
8. Kad je Production „Ready": `/admin/activity` mora da prikaže zapis iz koraka 2 kao „Uklonjena dvostepena prijava" (žuto) sa napomenom da izvršilac nije zabeležen, a filter „Vrsta aktivnosti" ima novu stavku.
9. (Preporuka, 2 minuta) plan izvršavanja na pravoj bazi, da se potvrdi da se funkcije računaju jednom po upitu (u planu treba da vidiš `InitPlan`, ne `SubPlan` po redu):
   ```sql
   begin;
   select set_config('request.jwt.claims', '{"sub":"<ID bilo kog naloga>","role":"authenticated","aal":"aal2"}', true);
   set local role authenticated;
   explain (analyze, buffers) select * from public.document_chunks limit 10;
   rollback;
   ```
10. Javi ishod (naročito korak 2 i 5 do 6). Povratak cele migracije je u njenom zaglavlju.

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
- Svih pet SQL testova (`phase1`, `phase2`, `phase25`, `phase256`, `phase2511`) prolazi na pravoj bazi, a migracija 2.5.11 je primenjena i proverena (korak 2, 5 i 6 u odeljku 2, „2.5.11").
- U CLAUDE.md Faza 2.5 je `[x]`, a Faza 3 (bezbednost fajlova) je sledeća.

## 5. Šta uneti na početku sledećeg ćaskanja
Kopiraj ceo blok ispod i popuni „Dopuna od mene" (prazno = nisam probao). Sve što ne piše kao urađeno Claude smatra neurađenim i proverava u bazi. Svaki čet na kraju zamenjuje ovaj odeljak novim promptom.

```
Pročitaj redom: CLAUDE.md, AGENTS.md, docs/next-steps.md, docs/admin-panel-plan.md (naročito „Rezultat 2.5.3" i „Poznato, za 2.5.4", „Rezultat 2.5.10", „Rezultat 2.5.11"), docs/email-templates.md, tools/verify/README.md (odeljak „SQL harness") i memoriju (local-verification-recipe). Kad diraš SQL, Auth ili RLS, pročitaj i bezbednosnu listu u .agents/skills/supabase/SKILL.md. Odgovaraj na srpskom. Radi sam, bez podagenata.

O PROJEKTU
Pravni AI asistent (RAG) za advokatske kancelarije, B2B: Next.js 16 + Supabase (Postgres, pgvector, RLS) + Voyage AI + Claude, na Vercelu (produkcija: https://ai-chatbot-2qmj.vercel.app). Cilj je zero-trust i zaštita poverljivosti klijenata (NDA). Faze 1 i 2 su zatvorene. Faza 2.5 (admin panel) je skoro gotova. Sledi Faza 3 (bezbednost fajlova), pa Faza 4 (isporuka kancelariji, poseban Vercel + Supabase projekat po kancelariji).

STANJE (kraj prethodnog četa, 2026-10-29)
- Faza 2.5: urađeni su 2.5.1 do 2.5.11, ali je u CLAUDE.md i dalje [ ] jer ručne tačke 1 do 6 iz „Rezultat 2.5.10" nisu potvrđene (osim ako Dopuna kaže drugačije). 2.5.1 do 2.5.9 su commit-ovani (poslednji: ad83132); 2.5.11 je vlasnik javio da push-uje (hash u Dopuni).
- 2.5.11 (tvrdi RLS): migracija 20261029110000_phase2511_hard_rls.sql JE primenjena na Supabase-u (baza 2026-10-29: funkcije postoje, 6 restriktivnih polisa, okidač on_mfa_factor_removed postoji). Vlasnik je javio „sve prolazi" za SQL testove (ispis nisam video). NIJE viđeno: okidač sa pravim Auth serverom (mfa_removed_zapisi = 0), C6 i C8 sa pravim tokenima, Advisors posle migracije, plan izvršavanja na pravoj bazi. Lokalno (PGlite, node tools/verify/run-sql-tests.mjs): 5/5 SQL testova, 38 od 39 mutacija uhvaćeno + 1 ekvivalentna; npm test 341/341.
- NOVI NALAZ (Supabase log): pozvani nalog je potvrdio mejl, ali je kliknut PODRAZUMEVANI Supabase link (GET /auth/v1/verify?token=…&type=invite&redirect_to=<produkcija>), ne naš /auth/confirm?token_hash=…. Znači šablon „Invite user" (B8, tekst u docs/email-templates.md) NIJE bio primenjen, nalog nikad nije stigao na /set-password (nema PUT /auth/v1/user), pa je poziv advokata do kraja NEPROVEREN.
- Chat na produkciji NIJE potvrđen: poslednji red u usage_ledger je 2026-10-28 14:57:31, a od tada su se promenili /api/chat, requireUser, limiti i RLS. Neviđeno na produkciji: blokada, CSV izvoz, promena podešavanja (sva tri 0 zapisa u audit_log), meni iz 2.5.9, reset lozinke za nalog sa MFA (Supabase možda traži aal2 za promenu lozinke, vidi „Poznato, za 2.5.4").
- Viđeno na produkciji: MFA (QR i kod), /admin pregled kao admin sa aal2, pregled naloga (admin_viewed_user 2), akcija poziva (user_invited).
- ODLUKE vlasnika: MFA ostaje opcion za advokate (opcija (a)); restriktivne polise na 6 tabela, NE na profiles; okidač beleži samo POTVRĐEN faktor i ne zaustavlja uklanjanje faktora kad upis audita padne; okidačka funkcija je u šemi private (izlaz ako okidač ne radi sa pravim Auth serverom: drop trigger i premestiti funkciju u public).
- Alati: tools/verify (probe aplikacije na pravom next start sa lažnim Supabase-om, SQL harness na PGlite-u, runner za mutacije; npm install u tools/verify).

KORAK 0, pre ikakvog koda (veruj bazi, ne meni): preko Supabase MCP-a (read-only) pokreni
  select (select max(created_at) from public.usage_ledger) as poslednji_chat_red,
         (select count(*) from public.audit_log where action = 'audit_exported') as izvozi,
         (select count(*) from public.audit_log where action = 'settings_changed') as promene_podesavanja,
         (select count(*) from public.audit_log where action = 'admin_viewed_user') as pregledi_naloga,
         (select count(*) from public.audit_log where action in ('user_disabled', 'user_enabled')) as blokade,
         (select count(*) from public.audit_log where action = 'mfa_removed') as mfa_removed_zapisi,
         (select count(*) from public.audit_log where action = 'mfa_enrolled') as mfa_enrolled_zapisi,
         (select count(*) from public.profiles where disabled_at is not null) as blokirani,
         (select count(*) from pg_policies where schemaname = 'public' and permissive = 'RESTRICTIVE') as restriktivne_polise,
         (select count(*) from pg_trigger where tgname = 'on_mfa_factor_removed' and not tgisinternal) as okidac,
         (select to_jsonb(s) - 'updated_by' from public.office_settings s) as podesavanja;
i (bez email adresa): select u.invited_at, u.email_confirmed_at, u.last_sign_in_at, (u.encrypted_password is not null and u.encrypted_password <> '') as ima_lozinku, p.role, p.disabled_at, (select count(*) from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as faktori from auth.users u left join public.profiles p on p.id = u.id order by u.created_at;
Zatim git log i git status. Zatim query_logs (source 'edge_logs', poslednja 24 sata): (a) grupisano po log_attributes['request.path'], metodi i statusu, traži POST /rest/v1/rpc/reserve_usage, PUT /auth/v1/user, rpc/admin_update_settings, rpc/admin_set_disabled, DELETE /auth/v1/factors/*; (b) za GET i POST /auth/v1/verify ispiši request.search da vidiš KOJI link je kliknut (podrazumevani ?token=… ili naš token_hash).
Javi mi u par redova šta je potvrđeno, a šta nije.
- Ako je poslednji_chat_red i dalje 2026-10-28 14:57:31 (ili stariji), chat NIJE potvrđen: reci mi da pošaljem jednu poruku i proveri novi red. Ako chat vrati grešku (401 mfa_required, 403, 503), to je prioritet nad svim ostalim (superpowers:systematic-debugging).
- Ono što ne vidiš iz baze (izgled u browseru, stiže li mejl, Excel) pitaj me samo ako nije popunjeno ispod. Sve što ovde ne piše kao urađeno smatraj neurađenim, uključujući Dashboard stavke B2 do B9 iz next-steps.md.

DOPUNA OD MENE (popunjavam ono što znam; prazno = nisam probao)
- Hash commit-a 2.5.11 i da li je Production „Ready": ____
- Pet SQL testova na pravoj bazi (ispis ako neki puca): ____   Advisors posle migracije: ____
- Proba okidača (uključi pa ukloni probni MFA faktor, nalog bez podataka; zapis mfa_removed): ____
- C6 (aal1 token vraća [] za audit_log, aal2 vraća zapise): ____   C8 (blokiran nalog sa važećim tokenom vraća [] za chats, profil čitljiv): ____
- Chat poruka na produkciji poslata (odgovor stigao, bez greške): ____
- Dashboard: B2 registracija OFF, B3 URL Configuration, B4 SMTP, B8 email šabloni (Invite user i Reset password) primenjeni, B9 minimalna lozinka 12: ____
- Poziv advokata posle B8: mejl, link vodi na „Postavite lozinku", lozinka postavljena, prijava radi: ____
- Reset lozinke za nalog sa MFA (/forgot-password → mejl → kod → nova lozinka): ____
- Ručne tačke iz „Rezultat 2.5.10": admin bez koda ne ulazi u /admin; advokat dobija 404 i 42501; podešavanja (limit 2 pa 429, vraćeno na 100); CSV u Excel-u (slova i 11 kolona razdvojeno, ili sve u jednoj koloni); meni iz 2.5.9 (admin vidi „Admin panel", advokat ne, telefon): ____
- Env granice na Vercel-u (DAILY_MESSAGE_LIMIT i ostale; vrednosti): ____
- Ostalo: ____

ZADATAK OVOG ČETA (redom; grane zavise od Dopune i Koraka 0)
1. 2.5.11 na pravoj bazi: upiši ishod (okidač, C6, C7, C8, Advisors) u docs/admin-panel-plan.md i CLAUDE.md. Ako okidač ne radi ili neki SQL test puca: superpowers:systematic-debugging, ispravka test-prvo kroz SQL harness (izlaz za okidač: premesti private.audit_mfa_removed() u public, ponovi harness i mutacije; vlasnik primenjuje novu migraciju). Ako ništa od toga nije probano, samo me podseti i ne radi ništa novo oko migracije.
2. Poziv advokata: ako B8 nije urađen, ne piši kod; podseti me na docs/email-templates.md i objasni nalaz. Ako je urađen, u logu proveri tok (GET /auth/confirm na našem sajtu, POST /auth/v1/verify, PUT /auth/v1/user) i upiši ishod. Ako tok puca, superpowers:systematic-debugging, ispravka test-prvo (lib/auth-confirm.ts, app/auth/confirm/route.ts, probe u tools/verify). Isto za reset lozinke naloga sa MFA.
3. Zatvaranje Faze 2.5: kad su ručne tačke 1 do 6 potvrđene, Faza 2.5 postaje [x] u CLAUDE.md, uz kratak spisak šta je i kako potvrđeno. Ako nisu, ostaje [ ] sa tačnim spiskom šta fali.
4. FAZA 3 (bezbednost PDF i Word fajlova), SAMO PLAN, BEZ KODA: postavi mi PRVO PITANJE (ispod) i sačekaj odgovor. Posle odgovora postavi preostala pitanja (najviše 6, jedno po jedno ako zavise od prethodnog), pa upiši dogovoren plan u docs/file-security-plan.md i u CLAUDE.md („FAZA 3"), isto kao za Fazu 2 i 2.5. Kod tek posle potvrde plana. Ne čekaj na tačke 2 i 3 da bi počeo pitanja.

   Činjenice o današnjem stanju (proverene čitanjem koda 2026-10-29, ne istražuj ponovo osim ako sumnjaš):
   - PDF ide na POST /api/ingest (app/api/ingest/route.ts), parsira se na serveru bibliotekom unpdf (pdf.js) u istom procesu kao ostatak aplikacije. Zod (lib/validation.ts) proverava samo f.type === 'application/pdf' ILI ime završava na .pdf, i do 4MB. Nema provere magičnih bajtova (%PDF-), nema ograničenja broja stranica ni dužine teksta pre parsiranja, nema timeout-a ni izolacije parsiranja (samo maxDuration = 60 cele funkcije). Neuspelo parsiranje je 400 invalid_pdf uz audit document_upload_blocked.
   - Word (.docx) NE ide na server kao fajl. Parsira se u pregledaču (mammoth, app/chat/page.tsx, handleFileAttachment: proverava samo file.name.endsWith('.docx'), bez ograničenja veličine), a izvučen tekst se lepi u pitanje za POST /api/chat. Server nikad ne vidi originalni .docx, pa ga ne može ni skenirati. Word se ne indeksira u bazu znanja.
   - Nema antivirusa ni provere aktivnog sadržaja (PDF: /JavaScript, /Launch, /EmbeddedFile; DOCX: vbaProject.bin, makroi, OLE, spoljni odnosi, zip bomba). Hosting je Vercel (serverless): nema stalnog procesa za ClamAV. Spoljni AI servisi (Voyage, Claude) već primaju tekst dokumenata.
   - Već postoje: audit document_upload_blocked (razlozi unreadable_pdf, no_text, too_many_chunks), dvostepeno upozorenje 409 za sumnjiv sadržaj (prompt injection) pri otpremanju, ledger rezervacija, IP burst, restriktivne RLS polise.

   PRVO PITANJE: „Smeju li dokumenti klijenata da napuste naš sistem radi skeniranja na viruse (spoljni servis kao VirusTotal ili cloud skener, uz DPA i zero-retention), ili skeniranje mora da ostane u našoj infrastrukturi? Moja preporuka: sada samo strukturna provera u našem kodu (magični bajtovi, aktivan sadržaj, ograničenja i timeout), a pravi antivirus (ClamAV) kao poseban servis po kancelariji tek u Fazi 4 (silo)."
   Kratak plan koji treba predložiti posle odgovora (menja se prema odgovorima): 3.1 provera tipa po sadržaju (magični bajtovi %PDF- i ZIP za docx) umesto po imenu i MIME-u; 3.2 detekcija aktivnog sadržaja u PDF i DOCX, odluka odbij ili upozori (kao sumnjiv sadržaj, dvostepeno); 3.3 granice pre parsiranja (broj stranica, dužina teksta, odnos raspakovanja za zip bombu) i timeout ili izolacija parsiranja; 3.4 Word: ostaje u pregledaču (bez skeniranja) ili ide na server; 3.5 antivirus prema odgovoru na prvo pitanje; 3.6 novi razlozi u auditu (not_pdf, active_content, archive_bomb, parse_timeout) vidljivi u /admin/activity; 3.7 testovi: generisani uzorci (PDF sa /JavaScript, docx sa vbaProject.bin, zip bomba, EICAR niska za putanju antivirusa), mutacije, probe.

MOJE ODLUKE (važe osim ako ispod dopišem drugačije)
- C1 do C5 kako su predložene u next-steps.md (CSV ';', mesečni budžet ≥ dnevni, ime bez < i >, MFA kapija za naloge sa uključenim MFA, izgubljen telefon = ja uklanjam faktor u Dashboard-u; to sada ostavlja zapis mfa_removed). Ako CSV u Excel-u ispadne u jednoj koloni, javiću: tada se menja CSV_DELIMITER.
- C6, C7, C8: urađeno u 2.5.11, opcija (a): MFA ostaje opcion za advokate.
- Radi se samo na main, bez novih grana.

PRAVILA (uvek)
- Test-prvo (superpowers:test-driven-development): vidi test ili probu kako pada iz pravog razloga, pa piši kod; posle toga namerne greške (mutacije) u novom kodu. Za SQL: migracija ide kroz SQL harness (node tools/verify/run-sql-tests.mjs; svih pet testova mora da prođe pre i posle) i mutacije u memoriji; test koji prođe iz prve ne dokazuje ništa dok mutacije ne padnu. Pre izveštaja superpowers:verification-before-completion.
- BEZ commit-a i push-a (radim ja). Pre dodavanja alata, biblioteka ili fajlova van plana reci mi u dve rečenice šta dodaješ. Postojeće SQL testove menjaj samo uz razlog koji ćeš mi javiti (moram da pokrenem izmenjene fajlove).
- Svaka stranica u app/admin zove requireAdminPage(next), svaka server akcija requireAdminAction(), svaka admin ruta requireAdmin() i proverava mfa === 'ok' (lib/admin-guards.test.ts to proverava). Stranice u app/admin NEMAJU metadata (naslov taba otkriva panel). Čitanja idu preko korisničkog klijenta, supabaseAdmin samo za upise i Auth Admin API (trajna pravila 1 do 7 u CLAUDE.md).
- Migracija: fajl u supabase/migrations + SQL test; ja je primenjujem PRE push-a; posle toga SQL testovi i Advisors. Supabase se često menja: pre rada sa Auth ili novim funkcijama proveri dokumentaciju preko MCP search_docs, ne iz sećanja.
- Pre pisanja Next koda pročitaj relevantne strane u node_modules/next/dist/docs/ (AGENTS.md: ovo nije Next.js koji znaš).
- Pre izveštaja: npm test, tsc, lint, next build (sa NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 i NEXT_PUBLIC_SUPABASE_ANON_KEY=fake-anon-key), npm audit --omit=dev i probe iz tools/verify na pravom next start. Izveštaj pošten: „viđeno" odvojeno od „nije proveravano".
- Zamke koje su već plaćene (tools/verify/README.md i memorija): fajlove piši alatima Write i Edit, ne bash heredoc-om ni node -e sa regularnim izrazima ili \r (prošli čet je opet upao u tu zamku); CLAUDE.md je CRLF (menjaj ga jednoredno, proveri Node-om skriptom iz Write, ne grep-om); layout se izvršava pre stranice, pa admin bez MFA uvek ide na next=/admin; Response.text() odbacuje BOM; polja server akcije idu sa prefiksom _1_; ne pokreći mutacije, build ni npm test dok menjaš iste fajlove; pre mutacija na necommit-ovanom kodu napravi kopiju fajlova u scratchpad i posle uporedi; izlaz grešaka PGlite-a ume da ispiše minifikovan izvorni kod, pa uvek pipe kroz cut -c1-300 | head.

KRAJ ČETA: upiši rezultat u docs/admin-panel-plan.md (ili docs/file-security-plan.md za Fazu 3), CLAUDE.md i docs/next-steps.md; napiši „Tvoj deo" (SQL, Dashboard, ručni testovi); u docs/next-steps.md zameni odeljak 5 novim promptom za sledeći čet; ažuriraj memoriju ako si naučio nešto što ne piše u receptu.
```
