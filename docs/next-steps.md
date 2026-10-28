# Šta dalje: Faza 2.5 (admin panel), korak po korak

Stanje na dan 2026-10-28. Ovaj fajl je namenjen tebi: odozgo nadole piše šta TI radiš, a šta radi Claude.
Za detalje i obrazloženja: `docs/admin-panel-plan.md` (plan) i `CLAUDE.md` (status faza).

## Gde smo

| Faza | Stanje |
|---|---|
| 1. Izolacija podataka (RLS) | Gotova |
| 2. Zaštita API ruta | Gotova (preostale stavke su dole, odeljak 1D) |
| 2.5.1 Migracija admin panela + SQL test | Primenjena na Supabase-u, testovi prošli |
| 2.5.2 Zajednički kod (`lib/`) | Napisan i commit-ovan (`2fd9840`); izmena `/api/chat` još nije potvrđena na produkciji |
| 2.5.3 MFA (kapija, `/login/mfa`, `/account/security`) | Kod napisan, `npm test` 176/176, kapija probana lokalno; **nije commit-ovan ni pušten, čeka tvoj test (odeljak 1A)** |
| 2.5.4 do 2.5.10 | Nije počelo: nema nijedne admin stranice, nijedan admin ne postoji |
| 3. Bezbednost fajlova | Posle 2.5 |
| 4. Isporuka kancelariji | Posle faze 3 |

## 1. Šta radiš TI (pre sledećeg ćaskanja)

### A. Odmah
Već urađeno: `phase2_rls_test.sql` je prošao (2026-10-28), a kod 2.5.1 i 2.5.2 plus dokumenti su commit-ovani i na GitHub-u (`83169e3`).

1. **Pre nego što pustiš 2.5.3: pošalji jednu poruku u chat na produkciji** (Vercel deploy mora biti „Ready"). U `usage_ledger` još nema
   nijednog reda posle izmene iz 2.5.2 (poslednji je iz 15:57, smoke test Faze 2). Javi Claude-u da proveri novi red. Razlog: 2.5.3 menja
   i `/api/chat` (prelazak na `requireUser()`), pa ako bi chat posle toga prestao da radi, ne bi se znalo koja je izmena kriva.
2. **Commit i push 2.5.3** (`git status` pokazuje šta je novo: `proxy.ts`, `lib/mfa-*`, `lib/require-*`, `app/login/`, `app/account/`, izmene
   `/api/chat`, `app/actions/documents.ts` i `app/activity/page.tsx`, plus dokumenti). Predlog poruke: `faza 2.5.3 mfa`.
   **Pažnja:** `main` je produkcija, pa ovo odmah menja pravu aplikaciju, uključujući `proxy.ts` (kapiju cele aplikacije).
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
| 6 | Zaštita od procurelih lozinki | Pre pilota | Authentication → Password security. Advisors je i dalje prijavljuje, pa nije uključena ili je tvoj plan ne dozvoljava |
| 7 | JWT expiry 1 sat ili kraće | Pre pilota | Blokiran nalog zadržava važeći token do isteka |
| 8 | **Email šabloni (Invite user i Reset password)** | **TEK kad je 2.5.4 na produkciji** | Tekst šablona će ti dati Claude u koraku 2.5.4. **Ne menjaj ih ranije:** novi link vodi na `/auth/confirm` koje još ne postoji, pa bi reset lozinke prestao da radi |

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

### 2.5.3 MFA — URAĐENO, čeka tvoj test (odeljak 1A)
Šta je napravljeno, koje su odluke donete umesto tebe i šta nije provereno: `docs/admin-panel-plan.md`, „Rezultat 2.5.3". Ukratko: kapija u
`proxy.ts` i `requireUser()` (nalog sa potvrđenim faktorom bez koda ne ulazi nigde osim na `/login/mfa`; API i server akcije dobijaju
401 `mfa_required`), stranice `/login/mfa` i `/account/security`, audit `mfa_enrolled` preko server akcije. Kapija je probana lokalno na pravom
`next start` sa lažnim Auth serverom (50 provera), ali QR i unos koda u browseru nisu probani: to je tvoj test.
Jedno odstupanje od ranijeg opisa: proxy nema poseban slučaj za `/admin/*` (ne zna ulogu bez upita u bazu); admin bez koda se usmerava iz
`/admin` layout-a u 2.5.5.

### 2.5.4 Pozivnica i postavljanje lozinke
- `app/auth/confirm/route.ts` (`verifyOtp`, tip samo `invite` ili `recovery`, `next` kroz `safeRedirectPath`), `app/set-password/page.tsx`
  (najmanje 12 znakova; ista dužina i na `/reset-password`, koja sad traži 6).
- Briše se `app/register/page.tsx`, link „Registrujte se" i `/register` u `proxy.ts`; umesto linka tekst „Nalog vam otvara administrator kancelarije."
- Claude ti daje tačan tekst oba email šablona. **Redosled:** prvo deploy ovog koda, TEK ONDA menjaš šablone (B8).
- Reset lozinke za nalog sa uključenim MFA: Supabase može da traži kod pre promene lozinke, pa se taj tok proverava i prilagođava ovde (vidi plan, „Rezultat 2.5.3", poznato).
- **Tvoj deo za test:** B3 i B4 (URL Configuration, SMTP), pa B8.

### 2.5.5 Admin okvir i pregled
`app/admin/layout.tsx` (`requireAdmin()`: `null` je `notFound()`, `mfa !== 'ok'` je `redirect`), navigacija (Pregled · Advokati · Aktivnost ·
Podešavanja · Nazad na chat), `app/admin/page.tsx` (zbirne brojke i lista advokata preko 80% nekog limita).

### 2.5.6 Advokati
`app/admin/users/page.tsx` (tabela iz `admin_list_users`: status aktivan/pozvan/blokiran, MFA, poslednja prijava, potrošnja sa trakom),
`app/admin/users/[id]/page.tsx` (`admin_get_user`: nazivi i datumi, bez sadržaja; napomena da je pregled zabeležen),
`app/admin/actions.ts`: `inviteLawyer` (najviše 20 poziva dnevno), `disableLawyer` (nikad sebe ni poslednjeg admina), `enableLawyer`, `resendInvite`, `setRole`.
Svaka radnja ima potvrdu u UI-ju i audit zapis. **Proverava se** da li blokiran korisnik sa još važećim tokenom prolazi `getUser()`;
ako prolazi, dodaje se `profiles.disabled_at` (nova migracija) i `requireUser()` ga odbija.

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
Kopiraj:
> Pročitaj `CLAUDE.md` i `docs/next-steps.md`. Završio sam sledeće iz odeljka 1: (nabroj A1, A2…). Evo ishoda: (rezultati/greške).
> Nastavi od koraka 2.5.4 (pozivnica i postavljanje lozinke).
