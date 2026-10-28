# FAZA 2.5: Admin panel za vlasnika kancelarije

Plan usaglašen sa korisnikom 2026-10-28, kroz 10 pitanja. Radi se **isključivo na grani `main`**, bez novih grana (odluka korisnika).

**Preduslov:** Faza 2 je završena i verifikovana. Na Supabase su primenjene migracija 2.1 (`profiles.role`, `usage_ledger`, `audit_log`) i kod 2.2-2.9 (rezervacija, audit upisi). Panel bez toga nema šta da prikaže.

## Odluke korisnika

| # | Tema | Odluka |
|---|---|---|
| 1 | Mesto u roadmap-u | Nova **Faza 2.5**, posle Faze 2, pre Faze 3. |
| 2 | Dodavanje advokata | **Poziv emailom iz panela.** Server (`service_role`) šalje Supabase pozivnicu, a advokat sam postavlja lozinku. Javna registracija ostaje isključena. |
| 3 | Odlazak advokata | **Blokada (ban).** Podaci ostaju zaključani i niko ih ne vidi. Trajno brisanje nije u panelu, to je posebna i svesna akcija van panela. |
| 4 | Šta admin vidi o tuđim podacima | **Nazive i datume, bez sadržaja.** Vidi nazive dokumenata i naslove razgovora, ali ne vidi pasuse ni poruke. Svaki takav pregled se beleži u audit log. |
| 5 | Limiti | **Admin ih podešava globalno za kancelariju.** Env varijable su gornja granica koju admin ne može da pređe. |
| 6 | Potrošnja | Tokeni, broj poruka i broj dokumenata po advokatu (danas i ovog meseca), plus procenat od limita. Bez cena u EUR. |
| 7 | Audit log | Pregled, filteri (advokat, akcija, period) i **CSV izvoz**. Sam izvoz se beleži u audit log. |
| 8 | Broj admina | **Više admina.** Admin može drugom da da ili oduzme ulogu, ali baza ne dozvoljava da ostane 0 admina. |
| 9 | Admin i chat | **Isti nalog.** Admin je i advokat, a u sidebar-u ima i link „Admin panel”. Njegovi dokumenti ostaju privatni kao i svima, a pretraga mu vraća samo njegove pasuse. |
| 10 | Zaštita prijave | **Obavezan MFA (TOTP) za admina.** Svaka admin akcija traži `aal2` u JWT-u, i u kodu i u bazi. Za advokate je MFA opcion. |

## Šta postoji, a šta nedostaje (pregled koda, 2026-10-28)

| Oblast | Stanje | Šta treba |
|---|---|---|
| Uloga | `profiles.role` (`admin`/`lawyer`) postoji u bazi (migracija 2.1 primenjena, provereno preko MCP-a 2026-10-28). Nalog bez profila nema ulogu, pa `update ... where email` za njega tiho menja 0 redova. | Pre početka 2.5 svaki nalog mora imati profil (Faza 2, korak 1 zatvaranja). |
| Provera uloge u kodu | `requireUser()` (`lib/require-user.ts`) ne vraća ulogu. `proxy.ts` proverava samo da li je korisnik prijavljen. | `lib/require-admin.ts` (DAL) i usmeravanje `/admin` u `proxy.ts`. |
| Admin čitanje audit loga | Polisa `audit_log_select_own_or_admin` daje adminu sve redove na osnovu uloge, bez MFA. | Admin grana polise dobija i `aal2`. |
| Admin pregled advokata | Pod RLS-om admin ne vidi tuđe profile, dokumente, razgovore ni ledger. Ne vidi ni `auth.users` (email, poslednja prijava, ban). | Uske RPC funkcije samo za admina (vidi „Model pristupa”). |
| Pozivanje | Ne postoji. Postoje `/register` (javna, `signUp` iz browsera) i `/auth/callback` (`exchangeCodeForSession`, sa open redirect-om koji popravlja 2.6). | Server action za `inviteUserByEmail`, ruta `/auth/confirm` (`token_hash`) i stranica `/set-password`. `/register` se briše. |
| Blokada | Ne postoji. `documents.user_id` i `chats.user_id` imaju `on delete restrict`, pa se nalog sa podacima ionako ne može obrisati. | `auth.admin.updateUserById(id, { ban_duration })` kroz `supabaseAdmin`. |
| Limiti | Faza 2 ih je preselila u env (`lib/limits.ts`: `DAILY_MESSAGE_LIMIT` i ostale), a `lib/usage.ts` ih prosleđuje funkciji `reserve_usage` kao parametre. `lib/check-rate-limit.ts` je obrisan. | Tabela `office_settings`. Važi `min(podešavanje, env)`. |
| MFA | Ne postoji. Prijava ide iz browsera direktno na Supabase Auth (`app/login/page.tsx`). | Prijava faktora, MFA korak posle prijave i provera `aal2`. |
| Email | Podrazumevani Supabase SMTP šalje malo emailova i nije za produkciju. | Sopstveni SMTP (npr. Resend), deo onboarding-a (Faza 4). |
| `forbidden()` | U Next 16 je i dalje eksperimentalan (`authInterrupts`). | Ne koristi se. Za neovlašćen pristup koriste se `notFound()` ili `redirect()`. |

## Model pristupa (najvažniji deo)

Pravila 1-4 iz CLAUDE.md i dalje važe. Admin **nije** superkorisnik nad podacima. On upravlja nalozima i vidi metapodatke.

1. **Bazne tabele se ne šire.** Na `documents`, `document_chunks`, `chats` i `messages` ne dodaje se nijedna admin polisa. Široka polisa za `documents` i `chats` bi promenila ponašanje postojećih upita, na primer proveru razgovora u `app/api/chat/route.ts:70-74`, koja se oslanja na to da RLS vraća samo korisnikove redove. Pasusi i poruke ostaju vidljivi samo vlasniku, bez izuzetka. `match_document_chunks` i dalje filtrira po `auth.uid()`.
2. **Admin čita preko uskih RPC funkcija** koje vraćaju samo dozvoljene kolone (ID, naziv, datum, brojeve). Ovo je **dokumentovan izuzetak od pravila 4**: funkcije su `security definer`, jer moraju da čitaju `auth.users` i tuđe redove. Svaka funkcija:
   - kao prvi korak proverava `private.is_admin()` (uloga `admin` **i** `aal = 'aal2'` u JWT-u) i u suprotnom baca `42501`;
   - ima `set search_path = ''` i sve nazive piše sa šemom;
   - ima `revoke execute ... from public, anon` i `grant execute ... to authenticated`;
   - **sama upisuje audit zapis** kada otkriva podatke drugog advokata. Admin funkciju može da pozove i direktno preko REST API-ja, pa beleženje u kodu aplikacije ne bi bilo dovoljno.
3. **Audit log admin čita preko postojeće RLS polise** (invoker), sa dodatim uslovom `aal2`.
4. **Promene nad nalozima** (poziv, blokada, deblokada) idu kroz Auth Admin API, dakle preko `supabaseAdmin` u server action-u. Pre toga uvek ide `requireAdmin()`. Audit zapis se upisuje odmah posle uspešnog poziva.
5. **Promena uloge i podešavanja** idu kroz RPC funkcije u bazi (`admin_set_role`, `admin_update_settings`). Provere i audit su tada atomski i ne mogu se zaobići direktnim pozivom.
6. **Odbrana u slojevima:** `proxy.ts` radi samo optimističko usmeravanje (uloga i `aal`). Stvarna provera je u `requireAdmin()` (layout, svaka stranica i svaki server action), a poslednja linija je baza (`private.is_admin()` u RPC funkcijama i polisama).

Supabase Advisors će za ove funkcije prijaviti „security definer function executable by authenticated”. To je očekivano, ali se proverava da nijedna druga funkcija nije na listi.

## Korak 2.5.0: Podešavanja van koda (radi vlasnik projekta)

- Authentication → Sign In / Providers → „Allow new users to sign up” = **OFF** (ako već nije, nasleđeno iz Faze 1). Pozivnice rade i kad je registracija isključena, jer idu preko Admin API-ja.
- Authentication → Multi-Factor → **TOTP uključen**.
- Authentication → SMTP → **sopstveni SMTP** (npr. Resend, EU region). Podrazumevani SMTP nije za produkciju.
- Authentication → Email Templates:
  - **Invite user:** `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/set-password`
  - **Reset password:** `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
  - **Redosled:** šabloni se menjaju TEK kad je 2.5.4 na produkciji. Novi link vodi na `/auth/confirm`, koje do tada ne postoji, pa bi reset lozinke prestao da radi (`docs/next-steps.md`, B8).
- Authentication → URL Configuration: Site URL je produkcioni domen, a u Redirect URLs su produkcija i preview.
- JWT expiry: 1h ili kraće. Blokiran korisnik zadržava važeći access token do isteka (vidi 2.5.10).

## Korak 2.5.1: Migracija `supabase/migrations/<ts>_phase25_admin.sql`

Jedna transakcija koja samo dodaje. Nacrt ključnih delova:

```sql
begin;

-- Pomoćne funkcije van API-ja (šema private nije izložena PostgREST-u).
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Admin = uloga admin I MFA u ovoj sesiji. Invoker: korisnik ionako vidi svoj profil.
create function private.is_admin()
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
     and exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.role = 'admin');
$$;
revoke execute on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

-- 1. Audit: nove akcije i tipovi resursa.
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in (
  'document_uploaded', 'document_upload_blocked', 'document_deleted',
  'chat_created', 'chat_deleted', 'question_asked',
  'limit_reached', 'suspicious_content_flagged',
  'user_invited', 'user_disabled', 'user_enabled', 'role_changed',
  'settings_changed', 'admin_viewed_user', 'audit_exported', 'mfa_enrolled'));
alter table public.audit_log drop constraint audit_log_resource_type_check;
alter table public.audit_log add constraint audit_log_resource_type_check
  check (resource_type in ('document', 'chat', 'user', 'settings'));

-- Admin vidi tuđe zapise samo sa MFA (aal2).
drop policy audit_log_select_own_or_admin on public.audit_log;
create policy audit_log_select_own_or_admin on public.audit_log
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

-- 2. Podešavanja kancelarije: jedan red. Čitaju svi prijavljeni (za upozorenje na 80%),
--    a menja samo admin_update_settings.
create table public.office_settings (
  id                    boolean primary key default true check (id),
  daily_message_limit   integer not null default 100 check (daily_message_limit between 1 and 10000),
  daily_document_limit  integer not null default 20  check (daily_document_limit between 1 and 1000),
  daily_token_budget    bigint  not null default 1000000  check (daily_token_budget > 0),
  monthly_token_budget  bigint  not null default 20000000 check (monthly_token_budget > 0),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users (id) on delete set null
);
insert into public.office_settings default values;
alter table public.office_settings enable row level security;
create policy office_settings_select on public.office_settings
  for select to authenticated using (true);
revoke all on public.office_settings from public, anon, authenticated, service_role;
grant select on public.office_settings to authenticated, service_role;

-- 3. Uvek bar jedan admin (štiti i od greške u SQL Editoru).
create function private.ensure_admin_remains() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('office:admins', 0));
  if not exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'Kancelarija mora imati bar jednog admina.' using errcode = '23514';
  end if;
  return null;
end $$;
-- Okida se samo kada je OLD bio admin (pre 2.5 nema admina, pa prvo postavljanje prolazi).
create trigger profiles_keep_one_admin
  after update of role or delete on public.profiles
  for each row when (old.role = 'admin') execute function private.ensure_admin_remains();

-- 4. RPC funkcije za admina (security definer, vidi „Model pristupa”).
--    admin_list_users(): id, email, full_name, role, created_at, invited_at, email_confirmed_at,
--      last_sign_in_at, banned_until, has_mfa, documents_count, chats_count,
--      daily_messages, daily_documents, daily_tokens, monthly_tokens
--      (iz auth.users, auth.mfa_factors, documents, chats i usage_ledger; dan/mesec po Europe/Belgrade).
--    admin_get_user(p_user_id): isti red plus liste {id, title, created_at, chunk_count} za dokumente
--      i {id, title, created_at, message_count} za razgovore. BEZ content kolona.
--      Upisuje 'admin_viewed_user' (resource_type 'user', resource_id = p_user_id).
--    admin_set_role(p_user_id, p_role): menja ulogu (trigger čuva poslednjeg admina), upisuje 'role_changed'.
--    admin_update_settings(...): menja office_settings, upisuje 'settings_changed' (staro/novo u metadata).
--    Svaka funkcija počinje sa:
--      if not private.is_admin() then raise exception 'Zabranjeno.' using errcode = '42501'; end if;

commit;
```

Napomene:
- `admin_get_user` vraća naslove razgovora, a to je prvih 50 znakova prvog pitanja (`app/api/chat/route.ts:84`). Korisnik je to prihvatio (odluka 4). Advokati se o tome obaveštavaju u uslovima korišćenja, jer naslov može sadržati ime klijenta.
- Nema `user_id` parametra koji označava pozivaoca. `p_user_id` je **cilj** admin akcije, a pozivalac je uvek `auth.uid()`, pa duh pravila 4 ostaje.
- `actor_email` u audit zapisu RPC funkcija čita iz `auth.users` za `auth.uid()`, a ne prima ga kao parametar.

**Rezultat 2.5.1 (2026-10-28, na `main`; migracija PRIMENJENA na Supabase-u 2026-10-28):** Na pravoj bazi prošli su `phase25_admin_test.sql` ("FAZA 2.5: svi admin testovi prošli") i `phase1_rls_test.sql`; Advisors Security pokazuje tačno 4 očekivana upozorenja za `admin_*` funkcije i nijedno novo; provera preko MCP-a: šema `private`, trigger i polisa postoje, `office_settings` ima 1 red sa podrazumevanim vrednostima, admina još nema. **Rezultat izmenjenog `phase2_rls_test.sql` nije potvrđen** (vlasnik ga još nije pokrenuo posle izmene).
- **Fajlovi:** `supabase/migrations/20261028150000_phase25_admin.sql` i `supabase/tests/phase25_admin_test.sql`. Pisano test-prvo: test je pao na praznoj funkcionalnosti (`ne postoji šema private`), pa tek onda je napisana migracija.
- **Šta migracija radi:** šema `private` (van API-ja) sa `is_admin()` (uloga `admin` **i** `aal2`; invoker) i `ensure_admin_remains()`; proširene CHECK liste `audit_log` (8 novih akcija, tipovi `user` i `settings`; nazivi ograničenja provereni na živoj bazi); polisa `audit_log_select_own_or_admin` sada koristi `is_admin()`; tabela `office_settings` (jedan red, samo SELECT za `authenticated` i `service_role`); trigger `profiles_keep_one_admin`; funkcije `admin_list_users`, `admin_get_user`, `admin_set_role`, `admin_update_settings`.
- **Odluke u implementaciji (odstupanja od nacrta u 2.5.1):** (1) `admin_get_user` za nepostojeći ID vraća 0 redova i NE upisuje audit; (2) `admin_list_users` ne upisuje audit (nazivi i brojevi samo), `admin_get_user` upisuje `admin_viewed_user` pri svakom pozivu; (3) `admin_set_role` sa istom ulogom ne radi ništa i ne upisuje audit; (4) kodovi grešaka: `42501` (nije admin ili nema `aal2`), `22023` (nepoznata uloga ili NULL podešavanje), `P0002` (korisnik ne postoji), `23514` (poslednji admin ili vrednost van opsega); (5) `admin_list_users` vraća `role` iz `profiles` bez podrazumevane vrednosti (nalog bez profila = NULL, vidljivo u panelu).
- **Test:** pokriva sve iz 2.5.10 i dodatno: admin sa `aal1` i bez `aal` u tokenu nije admin; advokat nije admin ni sa `aal2`; u `documents`, `document_chunks`, `chats`, `messages`, `usage_ledger` i `profiles` nema nijedne polise koja pominje admina; nijedna druga `security definer` funkcija u `public` nije dostupna `anon`/`authenticated`; izlaz admin funkcija ne sadrži tekst pasusa ni poruka, a ključevi u JSON listama su tačno `id/title/created_at/chunk_count`, odnosno `id/title/created_at/message_count`; poslednji admin je zaštićen i od `service_role` (bulk update, update, delete profila). Test sam svodi admine unutar svoje transakcije na dva test naloga, pa pravi admini ne smetaju (sve se poništava `rollback`-om).
- **Verifikacija (lokalno, PGlite + pgvector sa ne-superuser ulogama):** test crven bez migracije i zelen sa njom; **16 namernih mutacija migracije** (is_admin bez `aal2`, bez provere uloge, `ili` umesto `i`; pregled bez audita; curenje sadržaja; trigger bez efekta; polisa bez MFA; grant `update` na podešavanja; admin polisa na `documents`; bez validacije uloge; funkcija bez provere admina; `anon` execute; bez `search_path`; audit bez stare vrednosti; brojanje oslobođenih poruka; nepotvrđen MFA faktor) **svaka obara test**; `phase1`, `phase2` i `phase25` testovi prolaze i pre i posle migracije. Pretpostavke o živom Supabase-u provereni preko read-only MCP-a: kolone `auth.users` i `auth.mfa_factors` (uključujući obavezne kolone i vrednosti enum-a koje test upisuje), `postgres` sme da čita `auth.mfa_factors`, vlasnik tabela je `postgres`, šema `private` ne postoji.
- **Izmena postojećeg testa:** `phase2_rls_test.sql` (odeljak 4) predstavlja admina C sa `aal2`, jer admin bez MFA od ove migracije ne vidi tuđe audit zapise (to je namerno; proverava ga `phase25_admin_test.sql`).
- **Posledica za `/activity` (2.7):** admin bez MFA vidi samo svoje zapise, a sve tek u `/admin/activity` sa `aal2` (kao što plan kaže). U bazi još nema admina, pa danas nema vidljive promene.
- **Redosled primene (radi vlasnik, SQL Editor):** migracija `20261028150000_phase25_admin.sql`, pa `phase25_admin_test.sql`, `phase2_rls_test.sql` i `phase1_rls_test.sql` (svaki mora da ispiše „prošli”), pa Advisors → Security. **Očekivano:** 4 nova upozorenja „security definer function executable by authenticated” za `admin_*` funkcije; nijedna druga funkcija ne sme da se pojavi.
- **Poznato:** `has_mfa` broji samo potvrđene faktore (`status = 'verified'`); `unverified` faktor (započet, a nezavršen unos koda) se ne računa.

## Korak 2.5.2: Zajednički kod (`lib/`)

- **`lib/require-admin.ts`**: `requireAdmin()` prvo pozove `requireUser()`, pa pročita svoj profil preko korisničkog klijenta (`role`) i nivo preko `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`. Vraća `{ user, supabase, mfa: 'ok' | 'enroll' | 'challenge' }`, ili `null` ako korisnik nije admin. Stranice zovu `notFound()` (panel ne otkriva da postoji), a server action-i vraćaju `{ error }`.
- **`lib/validation.ts`** (proširenje): `inviteSchema` (email, ime 1-100 znakova), `roleSchema` (`admin` | `lawyer`), `settingsSchema` (celi brojevi u istim granicama kao CHECK), `auditFilterSchema` (`userId?`, `action?`, `from`/`to`, najviše 90 dana).
- **`lib/csv.ts`**: escape CSV-a (navodnici, prelomi) i **zaštita od CSV injection-a**: vrednost koja počinje sa `=`, `+`, `-`, `@`, tab ili CR dobija prefiks `'`.
- **`lib/usage.ts`** (iz Faze 2): limiti se čitaju iz `office_settings`, a važi `Math.min(podešavanje, env)`. Ako env nije postavljen, važi samo podešavanje.

**Rezultat 2.5.2 (2026-10-28, na `main`, commit-ovano u `2fd9840`):**
- **Novo (test-prvo; testovi su pali zbog nepostojećih modula/izvoza pre implementacije):** `lib/csv.ts` (+ test), `lib/admin-access.ts` (+ test; čista odluka `decideMfaStep` i `isAdminRole`), `lib/require-admin.ts`, proširenja `lib/validation.ts` (`inviteSchema`, `roleSchema`, `settingsSchema`, `settingsFormInput`, `SETTINGS_BOUNDS`), `lib/limits.ts` (`effectiveLimits`, `parseOfficeSettings`), `lib/audit.ts` (8 novih akcija) i `lib/activity.ts` (opisi novih akcija na srpskom; `ACTION_LABELS` je `Record<AuditAction, …>`, pa `tsc` ne bi prošao bez njih).
- **`requireAdmin()`** vraća `{ user, supabase, mfa }` ili `null`. Rola se čita preko korisničkog klijenta (RLS), nivo preko `mfa.getAuthenticatorAssuranceLevel()`. `mfa`: `ok` (aal2), `challenge` (aal1, faktor postoji), `enroll` (sve ostalo, uključujući nepoznate vrednosti). **Nijedna stranica je još ne koristi** (stiže u 2.5.5).
- **`lib/usage.ts`**: pri svakoj rezervaciji čita `office_settings` (jedan upit) i primenjuje `min(podešavanje, env)`; `reserveUsage` vraća i `limits` pa `/api/chat` koristi ISTE limite za upozorenje na 80% (ranije ih je čitao posebno iz env-a). Ako se podešavanja ne pročitaju, važe env i podrazumevane vrednosti (limit se ne gasi). **Posledica:** env više ne postavlja limit, već ga samo ograničava odozgo; dok admin ne promeni podešavanja važe podrazumevane vrednosti iz baze (100/20/1.000.000/20.000.000), pa env veći od njih nema efekta.
- **Odluke koje traže potvrdu vlasnika:** (1) CSV razdvajač je `;` (srpski Excel koristi `;` kao razdvajač liste, a zarez je decimalni znak; sa zarezom bi se sve otvorilo u jednoj koloni) — menja se jednom konstantom `CSV_DELIMITER`; (2) `mesečni budžet ne sme biti manji od dnevnog` je pravilo samo u aplikaciji (baza ga ne traži); (3) gornja granica tokena u formi je 10^12 (baza traži samo > 0); (4) ime advokata ne sme da sadrži `<`, `>`, kontrolne znake ni znakove za smer ispisa, jer ide u email pozivnice.
- **Odloženo:** `auditFilterSchema` (advokat, akcija, period od najviše 90 dana) ide u 2.5.7 uz stranicu Aktivnost, jer zavisi od beogradskih datuma koje koristi tek ona.
- **Verifikacija:** `npm test` 144/144 (+34), `tsc` čist, lint 0 grešaka (3 stara upozorenja), `next build` prolazi (lažni `NEXT_PUBLIC_SUPABASE_*`), `npm audit --omit=dev` 0. Mutacije novih modula: 11 od 12 uhvaćeno, preživela je ekvivalentna (minus u broju pada na proveri raspona, samo drugom porukom). **Izmena `/api/chat` i `lib/usage.ts` NIJE pokrenuta** (lokalno nema Supabase-a): na preview-u poslati poruku i proveriti da odgovor i dalje ima `usage`, a u `usage_ledger` novi red.

## Korak 2.5.3: MFA

- **`/account/security`** (svaki prijavljeni korisnik): `mfa.enroll({ factorType: 'totp' })` → QR kod → `mfa.challenge` + `mfa.verify`. Prikaz faktora i uklanjanje (samo sa `aal2`). Audit `mfa_enrolled`.
- **`/login/mfa`**: posle prijave, ako je `nextLevel = aal2` a `currentLevel = aal1`, korisnik unosi kod. `app/login/page.tsx` posle `signInWithPassword` proverava nivo i šalje ga ovde.
- **`proxy.ts`** (optimistički sloj) i **`requireUser()`** (stvarna provera): nalog sa potvrđenim faktorom, a sa sesijom `aal1`, ne koristi aplikaciju (odluka C4 iz `docs/next-steps.md`). Izvorni predlog (preusmerenje samo za `/admin/*`) zamenjen je opštom kapijom; ulogu i dalje proverava `requireAdmin()`, a ne proxy (vidi odluku 1 u „Rezultat 2.5.3”).

**Rezultat 2.5.3 (2026-10-28, na `main`, nije commit-ovano i NIJE puštano u produkciju):**
- **Pravilo (C4, vlasnik nije odgovorio pa važi preporuka):** nalog sa bar jednim potvrđenim faktorom (`status = 'verified'`) ne sme da koristi aplikaciju sa sesijom `aal1`. Važi za sve naloge, advokate i admine. Faktori stižu iz `getUser()` (Auth server ih vraća sveže), a nivo iz `aal` claim-a pristupnog tokena, koji se čita tek kad faktor postoji (token je upravo potvrdio `getUser()`). Sve nepoznato (nema `aal`, `aal3`, neispravan token) tretira se kao `aal1`.
- **Dva sloja:** (1) `proxy.ts`: stranice (GET/HEAD) se preusmeravaju na `/login/mfa?next=…`; API (`/api/*`) i sve što nije GET/HEAD (server akcije su POST na putanju stranice) dobijaju 401 `{ error, code: 'mfa_required' }`; izuzeci su samo `/login/mfa` i `/auth/*`. (2) `requireUser()` (`lib/require-user.ts`): isto pravilo, jer je proxy po dokumentaciji Next.js samo optimistički sloj, a Server Functions moraju same da proveravaju pristup. `requireUser({ allowMfaPending: true })` koriste samo `/login/mfa`, `/account/security`, `recordMfaEnrolled` i `requireAdmin()`. Na `requireUser()` su prebačeni i `/api/chat` (imao je sopstveni `getUser()`), `getUserDocuments`, `deleteDocument` i `/activity`. Poruka 401 je sada svuda „Niste prijavljeni ili je sesija istekla.”.
- **Odluke koje sam doneo (ruling):**
  1. Proxy NEMA poseban slučaj za `/admin/*` (plan i `next-steps.md` su ga predviđali). Bez upita u bazu proxy ne zna ulogu, a preusmerenje bi advokatu otkrilo da `/admin` postoji i protivrečilo bi E2E tački 2 (404). Admin bez faktora se usmerava iz `/admin` layout-a (`requireAdmin()` vraća `mfa`, 2.5.5), a admin sa faktorom i bez koda ionako završava na `/login/mfa` kroz opštu kapiju. Cena ako je pogrešno: jedno dodatno preusmerenje za admina.
  2. Nema zod šeme za 6-cifreni kod: kod ne stiže do našeg servera (pregledač ga šalje Supabase Auth-u). `normalizeMfaCode` (`lib/mfa-code.ts`, bez zavisnosti) služi klijentu i testovima i ne povećava bundle.
  3. `requireAdmin()` više ne koristi `mfa.getAuthenticatorAssuranceLevel()`: bez argumenta on na serveru čita `session.user.factors` iz kolačića (biblioteka to označava kao nesigurno i može da loguje upozorenje), a ne sveže faktore sa Auth servera. Sada koristi `assurance` iz `requireUser()`.
  4. Sva preusmerenja i odbijanja u proxy-ju nose osvežene kolačiće (`withSessionCookies`), kako traži Supabase SSR vodič: bez toga bi pregledač posle osvežavanja sesije zadržao refresh token koji je rotacijom već iskorišćen. Primenjeno i na postojeća pravila 1 i 3, istom funkcijom. Grešku na starom kodu nisam reprodukovao.
  5. Nema audita za uklanjanje faktora: lista u `audit_log_action_check` nema takvu akciju, a dodavanje traži novu migraciju. Uklanjanje ostaje nezabeleženo u našem logu (Supabase Auth log ga ima). Čeka odluku vlasnika.
  6. C5 (izgubljen telefon admina) nije kod, već procedura: vlasnik projekta uklanja faktor u Dashboard-u (`docs/next-steps.md`).
- **Fajlovi:** novi `lib/mfa-gate.ts`, `lib/mfa-code.ts` (+ testovi), `app/login/mfa/page.tsx` i `MfaChallengeForm.tsx`, `app/account/security/page.tsx`, `SecurityPanel.tsx` i `actions.ts`; izmenjeni `proxy.ts`, `lib/require-user.ts`, `lib/require-admin.ts`, `app/login/page.tsx`, `app/api/chat/route.ts`, `app/actions/documents.ts`, `app/activity/page.tsx`.
- **Tok:** uključivanje na `/account/security`: ukloni zaostale nepotvrđene faktore → `mfa.enroll` (TOTP, izdavalac „Pravni asistent”) → QR (SVG data URL; kodira se jer sirov `#` seče sliku) i tajni ključ za ručni unos → 6 cifara → `challengeAndVerify` → server akcija `recordMfaEnrolled` proverava da faktor postoji i potvrđen je (podaci sa Auth servera), pa upisuje `mfa_enrolled` (jednom po faktoru). Prijava: `/login` → posle lozinke `getAuthenticatorAssuranceLevel()` → `/login/mfa` → `challengeAndVerify` → `next` (kroz `safeRedirectPath`, uz zaštitu od petlje na `/login/mfa`). Uklanjanje faktora ima potvrdu u UI-ju, a Supabase ga dozvoljava samo sa `aal2`.
- **Testovi:** test-prvo. `lib/mfa-gate.test.ts` (26) i `lib/mfa-code.test.ts` (6) pali su zbog nepostojećih modula (`ERR_MODULE_NOT_FOUND`), a 3 testa za `mfaNextPath` zbog nepostojećeg izvoza. 19 mutacija na kopiji (fail-open na nepoznat nivo, uvek traži kod, API ili POST se ne odbija, prefiks `/auth` ili `/login/mfa`, nivo bez liste dozvoljenih, bez base64url, `next` bez kodiranja ili bez upita, 6 do 8 cifara, QR bez kodiranja ili bez provere prefiksa...) svaka obara bar jedan test. `npm test` 176/176, `tsc` čist, lint 0 grešaka (3 stara upozorenja), `next build` prolazi (`/login/mfa` i `/account/security` su dinamičke rute), `npm audit --omit=dev` 0. Na živoj bazi (read-only) proveren CHECK: `mfa_enrolled` i tip resursa `user` su dozvoljeni.
- **Proba kapije u Next-u (van repozitorijuma, skripta nije sačuvana):** lažni Supabase Auth server (`/auth/v1/user`, `/token`, REST) + pravi `next start` sa pravim `proxy.ts`: 50 provera, sve prolaze. Pokriveno: anonimno; nalog bez faktora (ponašanje isto kao pre); nalog sa faktorom i `aal1` (preusmerenja stranica sa `next`, 401 `mfa_required` za GET i POST API i za POST na stranicu); isti nalog sa `aal2` (sve radi, `next` se čisti od `//evil.com`, `@evil.com` i `/login/mfa`); token bez `aal` ili sa `aal3`; samo nepotvrđen faktor; drugi sloj (proxy propušta, a `requireUser()` blokira: 401 u ruti pre validacije tela, `/activity` na `/login`, `/account/security` na `/login/mfa`); istekao token (sesija se osvežava, a novi kolačić stiže i uz preusmerenje i uz odbijanje).
- **NIJE proveravano:** (1) klijentski tok u browseru (QR, unos koda, `enroll` / `verify` / `unenroll` prema pravom Supabase-u, server akcija `recordMfaEnrolled` i upis u `audit_log`); (2) ponašanje na Vercel-u; (3) izmena `/api/chat` (prelazak na `requireUser()`) i prethodna izmena iz 2.5.2 nisu potvrđene pravim pitanjem na produkciji.
- **Nalaz, traži odluku vlasnika: MFA štiti aplikaciju, ne i bazu.** Napadač sa ukradenom lozinkom i javnim anon ključem dobija `aal1` sesiju direktno od Supabase Auth-a i preko REST API-ja čita sve što RLS dozvoljava tom korisniku (dokumente, pasuse, razgovore, poruke, `match_document_chunks`), mimo Next.js kapije. RLS polise za advokate ne traže `aal2` (admin RPC funkcije i admin čitanje audit loga ga traže preko `private.is_admin()`). Predlog: posebna migracija sa restriktivnim polisama (`as restrictive`) na svim tabelama, koja traži `aal2` samo za naloge sa potvrđenim faktorom (pomoćna funkcija `security definer` čita `auth.mfa_factors`), uz proširenje SQL testova. To menja nivo Faze 1, pa traži odobrenje. Napomena: naloge bez uključenog MFA ovo ne štiti nikako, jer je MFA za advokate opcion.
- **Poznato, za 2.5.4:** (1) reset lozinke za nalog sa uključenim MFA: Supabase može da traži `aal2` za promenu lozinke, pa bi `/reset-password` mogla da prikaže opštu grešku. Tok `/auth/confirm` → kapija → `/login/mfa` → `/reset-password` rešava se i proverava u 2.5.4. (2) Već otvorena stranica čija sesija postane „na čekanju” (npr. MFA uključen na drugom uređaju) dobija 401 `mfa_required` na API pozive; osvežavanje stranice vodi na unos koda. Poruku koju UI tada prikazuje nisam proveravao.

## Korak 2.5.4: Pozivnica i postavljanje lozinke

- **`app/auth/confirm/route.ts`**: `verifyOtp({ type, token_hash })` preko server klijenta (primer iz Supabase dokumentacije za Next SSR). `type` mora biti `invite` ili `recovery` (zod), a `next` prolazi istu proveru protiv open redirect-a kao u 2.6 (počinje sa `/`, ne sa `//` ni `/\`).
- **`app/set-password/page.tsx`**: pozvani advokat postavlja lozinku (`auth.updateUser({ password })`, najmanje 12 znakova). Ako je u Dashboard-u uključena zaštita od procurelih lozinki, ona važi i ovde.
- **Briše se `app/register/page.tsx`**, link „Registrujte se” iz `app/login/page.tsx` i `/register` iz `proxy.ts`. Umesto linka ide tekst „Nalog vam otvara administrator kancelarije.”
- `app/forgot-password/page.tsx` i dalje radi, ali email sada vodi preko `/auth/confirm` (template iz 2.5.0).

**Rezultat 2.5.4 (2026-10-28, na `main`, commit-ovano u `4316a87` i na GitHub-u; da radi na produkciji nije potvrđeno):**
- **Šta je napravljeno:** `app/auth/confirm/route.ts` (spoj sa `verifyOtp`), `lib/auth-confirm.ts` (čista odluka: vrsta, odredište, neuspeh), `lib/password-policy.ts` (pravila i poruke), `lib/route-access.ts` (`isPublicPath`, pravilo 1 u `proxy.ts` više nije ručna lista), `app/set-password/page.tsx`, `app/link-expired/page.tsx`, zajednička forma `app/components/NewPasswordForm.tsx` (koriste je `/set-password` i `/reset-password`). Obrisan `app/register/page.tsx`, `/register` uklonjen iz `proxy.ts` i `lib/mfa-gate.ts`, link „Registrujte se" zamenjen tekstom „Nalog vam otvara administrator kancelarije." Tekst email šablona je u `docs/email-templates.md`.
- **Odluke koje sam doneo (ruling):**
  1. **Neuspeh potvrde vodi na novu javnu stranicu `/link-expired`.** Stari `/auth/callback` šalje na `/?error=…`, a početna stranica taj parametar nigde ne čita, pa bi korisnik sa isteklim linkom video samo reklamnu stranicu. Ne razlikuje se uzrok (istekao, iskorišćen, neispravan, nema mreže): korisniku treba novi link u svakom slučaju.
  2. **`next` se poštuje samo ako je putanja na ovom sajtu (`safeRedirectPath`), a podrazumevano odredište zavisi od vrste** (`invite` → `/set-password`, `recovery` → `/reset-password`). Pozivnica sa nevažećim `next` tako ne završi u `/chat` bez lozinke. Dozvoljene su samo vrste `invite` i `recovery` (`magiclink`, `signup`, `email_change` ne prolaze kroz ovu rutu).
  3. **Pravilo 1 u `proxy.ts` je tačno poređenje putanja** (`lib/route-access.ts`). Ranije je `/auth/callback` bio prefiks (`startsWith`). `/auth/confirm` mora biti javna: link otvara odjavljen korisnik. `/set-password` i `/login/mfa` NISU javne (traže sesiju).
  4. **Landing stranica (`Hero.tsx`, `Navbar.tsx`) je imala dva dugmeta ka `/register` („Isprobaj odmah", „Započni besplatno"), što plan nije pominjao.** Zamenjena su jednim dugmetom „Prijavite se" ka `/login` i tekstom o administratoru. Ovo je tvoja marketinška odluka (nema „probaj besplatno" kod B2B prodaje po kancelariji); reci ako želiš drugačiji tekst ili kontakt za prodaju.
  5. **Lozinka: najmanje 12 znakova, najviše 72 bajta** (bcrypt gleda bajtove, pa slova sa kvačicama zauzimaju po dva), lozinka samo od razmaka se odbija. **Ovo je pomoć u formi, a NE zaštita:** lozinka ide iz pregledača direktno Supabase Auth-u, pa ko ima sesiju može da zove `updateUser` mimo forme. Stvarnu donju granicu čuva samo Supabase podešavanje (`docs/next-steps.md`, B9). Zato nema zod šeme (kao ni za MFA kod: ne stiže do našeg servera).
  6. **`/reset-password` sada traži 12 znakova (bilo 6)** i posle čuvanja vodi na `/chat` (bilo `/`, što je za prijavljenog isto, jer ga `proxy.ts` šalje na `/chat`).
  7. **Poruke po kodu greške** (`describePasswordUpdateError`): `weak_password`, `same_password`, `insufficient_aal`, `reauthentication_needed`, `session_not_found`, `otp_expired`; sve ostalo je opšta poruka bez internog teksta Auth-a. Kodovi su provereni u Supabase dokumentaciji (spisak grešaka Auth-a). `reauthentication_needed` (podešavanje „Require reauthentication when changing password") namerno NE pominje kod iz aplikacije: to nije MFA. Nonce tok se ne podržava; sesija iz `/auth/confirm` je sveža (manje od 24 h), pa se to podešavanje ne okida, osim ako ga neko uključi i korisnik dugo ostavi otvorenu stranicu.
- **Verifikacija (test-prvo):** `lib/password-policy.test.ts` (14), `lib/auth-confirm.test.ts` (12) i `lib/route-access.test.ts` (5) su prvo pali (`ERR_MODULE_NOT_FOUND`), pa prošli. Test za `reauthentication_needed` je dodat posle nalaza u dokumentaciji, video sam ga kako pada, pa popravio poruku. **26 namernih grešaka na kopiji (dužina 8 ili 11, UTF-16 umesto znakova, bajtovi, razmaci, `magiclink` dozvoljen, bez gornje granice tokena, `next` bez provere, greška Auth-a se ignoriše, izuzetak vodi dalje, `/register` ili `/set-password` javne, bez normalizacije kose crte…) svaka obara bar jedan test;** prva serija je pustila jednu (`otp_expired`), jer je regex testa pogađao i opštu poruku; test je pojačan. `npm test` 207/207 (bilo 176), `tsc` čist, lint 0 grešaka (ista 3 stara upozorenja), `next build` prolazi, `npm audit --omit=dev` 0.
- **Proba na pravom `next start` sa lažnim Auth serverom (skripta van repozitorijuma, nije sačuvana): 29 provera, sve prolaze.** Poziv sa važećim tokenom: 307 na `/set-password` sa kolačićima sesije, a Auth dobija tačno `{type, token_hash}`; sa tim kolačićima `/set-password` se otvara (200), a `/login` šalje na `/chat`. Nevažeći token: `/link-expired`, bez kolačića. `magiclink`, `signup`, `email_change` i nepotpuni parametri: `/link-expired`, a Auth se uopšte ne zove. `next=//evil.com`, `@evil.com`, `https://evil.com`, `/\evil.com`: ostaje na ovom sajtu. Odjavljen: `/set-password`, `/register` i `/chat` vode na `/login`, a `/link-expired`, `/reset-password`, `/forgot-password` i `/auth/callback` su javne. Login i početna nemaju link ka `/register`.
- **NIJE proveravano:** (1) pravi Supabase: stvarni `verifyOtp` sa pravim `token_hash`, tačni kodovi grešaka iz pravog `updateUser`, dostava mejla i tvoji šabloni; (2) forma u browseru (unos, poruke, preusmerenje posle čuvanja); (3) tok reseta za nalog sa uključenim MFA (`/auth/confirm` → kapija → `/login/mfa` → `/reset-password`): kapija je pokrivena testovima iz 2.5.3, ali da li Supabase prihvata `updateUser` u toj sesiji nije viđeno; (4) Vercel. Koraci za proveru su u `docs/email-templates.md` i `docs/next-steps.md`.
- **Poznati rizik:** mejl skeneri (npr. Microsoft Safe Links) mogu da potroše jednokratan link pre advokata. Rešenje (stranica sa dugmetom „Nastavi", adresa linka ista, šabloni se ne menjaju) nije rađeno dok se ne pojavi; opisano u `docs/email-templates.md`.

## Korak 2.5.5: Admin layout i pregled

Rute su na engleskom, kao `/chat` i `/documents`, a tekst je na srpskom.

- **`app/admin/layout.tsx`** (server komponenta): `requireAdmin()`. Ako je rezultat `null`, poziva `notFound()`. Ako je `mfa !== 'ok'`, poziva `redirect`. Navigacija: Pregled · Advokati · Aktivnost · Podešavanja · Nazad na chat.
- **`app/admin/page.tsx` (Pregled)**: zbir za kancelariju (aktivni i blokirani nalozi, poruke danas, tokeni ovog meseca prema budžetu) i lista advokata koji su prešli 80% nekog limita.
- Server komponente zovu RPC preko korisničkog klijenta (pravilo 1), bez API ruta za čitanje.

**Rezultat 2.5.5 (2026-10-28, na `main`, nije commit-ovano i NIJE pušteno u produkciju):**
- **Šta je napravljeno:** `app/admin/layout.tsx` (okvir i navigacija), `app/admin/AdminNav.tsx` (klijentska komponenta: layout ne vidi trenutnu putanju), `app/admin/page.tsx` (Pregled), `lib/admin-page.ts` (`requireAdminPage(next)`), `lib/admin-overview.ts` (čista logika: parsiranje odgovora `admin_list_users`, status naloga, zbirovi, lista „blizu limita"), `adminMfaRedirect` u `lib/admin-access.ts`, `topKey` u `usageStatus` (`lib/limits.ts`; ne menja ono što dobija klijent). Pregled prikazuje naloge (ukupno, aktivni, pozvani, blokirani), potrošnju (poruke i dokumenti danas, obrada ovog meseca, najveći pojedinačni potrošač), važeće limite i listu advokata na 80% ili više bilo kog limita.
- **Odluke koje sam doneo (ruling):**
  1. **Pristup proverava i layout i SVAKA stranica** (`requireAdminPage`). Next dokumentacija upozorava da se layouti ne izvršavaju ponovo pri navigaciji (Partial Rendering), pa bi provera samo u layout-u važila samo pri ulasku u panel. Rezultat `requireAdmin()` se pamti u okviru zahteva (React `cache`), pa layout i stranica zajedno plaćaju jedan poziv Auth-u (proba: proxy + 1). `notFound()` i `redirect()` ostaju izvan keša.
  2. **Admin bez aal2:** sa potvrđenim faktorom ide na `/login/mfa?next=%2Fadmin`, bez faktora na `/account/security?next=%2Fadmin`. Layout ne vidi putanju, pa uvek šalje `/admin` (korisnik bez faktora koji je otvorio dublji link završi na `/admin` posle uključivanja; korisnik sa faktorom ionako dolazi kroz kapiju u `proxy.ts`, koja pamti pravu putanju).
  3. **Nema naslova taba za panel (nijedan `metadata` u `app/admin`).** Proba je pokazala da Next razrešava `metadata` i kad layout baci `notFound()`, pa je 404 za advokata sadržao `<title>Admin panel | Pravni Asistent</title>` i otkrivao da panel postoji (plan: „panel ne otkriva da postoji"). Uklonjeno; naslov je opšti naslov aplikacije. Pravilo važi i za buduće stranice panela (2.5.6 do 2.5.8): bez `metadata`.
  4. **Navigacija ima samo „Pregled".** Advokati, Aktivnost i Podešavanja se dodaju u `ITEMS` (`AdminNav.tsx`) kad stranice postoje, da meni nikad ne vodi na 404.
  5. **„Tokeni ovog meseca prema budžetu":** limiti važe PO ADVOKATU (`office_settings` je jedan skup limita za sve), pa zbir za kancelariju ne bi imao smisla prema jednom budžetu. Prikazuju se ukupna obrada kancelarije i najveći pojedinačni potrošač sa procentom od mesečnog budžeta.
  6. **Blokirani nalog:** njegova potrošnja ulazi u zbirove (potrošnja je potrošnja), ali se ne prijavljuje u „blizu limita" (ne može da troši).
  7. **Strogo parsiranje:** jedan neispravan red u odgovoru `admin_list_users` poništava ceo pregled (poruka o grešci), jer bi preskakanje reda tiho prikazalo manje naloga ili manju potrošnju. Interni tekst greške baze se ne prikazuje.
  8. **Bez audit zapisa za Pregled:** `admin_list_users` ne upisuje audit (odluka 2.5.1: nazivi i brojke), a upis `admin_viewed_user` je za pregled jednog advokata (2.5.6).
  9. **Ulaz u panel:** link u Sidebar-u stiže tek u 2.5.9. Do tada se `/admin` otvara upisom adrese.
- **Verifikacija (test-prvo):** `lib/admin-overview.test.ts` (19), 4 testa za `adminMfaRedirect` i 1 za `topKey` su prvo pali (modul ne postoji, izvoz ne postoji, `topKey` nedefinisan), pa prošli. **25 namernih grešaka na kopiji** (granica blokade `>=`, zbirovi, procenat od pogrešnog limita, blokirani u listi, obrnut poredak, prag različit od 80%, negativan brojač, preskakanje neispravnog reda, bigint kao tekst, pogrešan opis limita, zamenjeni koraci MFA, `next` bez kodiranja, `topKey` pri izjednačenju…) svaka obara bar jedan test. `npm test` 231/231 (bilo 207), `tsc` čist, lint 0 grešaka (ista 3 stara upozorenja), `next build` prolazi (`/admin` je dinamička ruta), `npm audit --omit=dev` 0.
- **Proba na pravom `next start` sa lažnim Auth i REST serverom (skripta van repozitorijuma, nije sačuvana): 27 provera, sve prolaze.** Odjavljen → `/login`. Advokat → 404 bez ijednog dela panela, a RPC se ne poziva. Admin bez faktora → `/account/security?next=%2Fadmin`. Admin sa faktorom bez koda → `/login/mfa?next=%2Fadmin` (kapija). Admin sa aal2 → 200 sa tačnim brojkama (4 naloga: 2 aktivna, 1 pozvan, 1 blokiran; 194 poruke; 6.500.000 obrade; najveći potrošač 25%; u „blizu limita" samo advokat sa 85 od 100, a blokirani sa 99 se ne pojavljuje). **Svi REST pozivi nose JWT admina, nijedan service ključ**, a pozivaju se samo `profiles`, `office_settings` i `admin_list_users` (nijedna tabela sa sadržajem). Greška RPC-a i neispravan red daju poruku o grešci, bez internog teksta. **Proba je pronašla otkrivanje panela preko naslova taba (odluka 3); pala je pre ispravke, prošla posle.**
- **NIJE proveravano:** (1) pravi Supabase: stvarni odgovor `admin_list_users` sa pravim JWT-om i `aal2` (lažni server vraća oblik iz migracije, a ne iz baze); (2) izgled u browseru (stranica nikad nije otvorena vizuelno); (3) pravi MFA tok do panela (QR, kod); (4) navigacija unutar panela sa više stranica (postoji samo jedna, pa ponašanje layout-a pri klijentskoj navigaciji nije viđeno); (5) Vercel.
- **Tvoj test (posle deploy-a):** `docs/next-steps.md`, odeljak 3 („Prvi admin"): postavi sebe za admina u SQL Editoru, uključi MFA na `/account/security`, prijavi se sa kodom i otvori `/admin`. Očekuješ: Ukupno 3, Aktivni 3, Pozvani 0, Blokirani 0 (u bazi su 3 naloga), poruke i dokumenti danas po tome koliko si danas koristio aplikaciju, i „Nijedan advokat nije blizu limita". Javi ako se brojke ne poklapaju sa onim što znaš iz baze.

## Korak 2.5.6: Advokati

- **`app/admin/users/page.tsx`**: tabela iz `admin_list_users()` sa kolonama ime, email, uloga, status (aktivan / pozvan / blokiran), MFA, poslednja prijava, dokumenti, razgovori i potrošnja danas i ovog meseca (traka sa procentom od limita).
- **`app/admin/users/[id]/page.tsx`**: `admin_get_user(id)` prikazuje nazive i datume dokumenata i razgovora. Na vrhu stoji napomena „Ovaj pregled je zabeležen u dnevniku aktivnosti.” ID se proverava sa `uuidSchema`, a neispravan ID daje `notFound()`.
- **`app/admin/actions.ts`** (server actions, svaki počinje sa `requireAdmin()` + zod):
  - `inviteLawyer(email, fullName)` → `supabaseAdmin.auth.admin.inviteUserByEmail(email, { data: { full_name }, redirectTo })`. Trigger `handle_new_user` pravi profil sa ulogom `lawyer`. Audit `user_invited`. Ograničenje od 20 pozivnica dnevno po kancelariji (broj iz `audit_log`) smanjuje štetu ako je admin nalog kompromitovan.
  - `disableLawyer(id)` → `updateUserById(id, { ban_duration: '876000h' })`. Zabranjeno je blokirati sebe i poslednjeg aktivnog admina. Audit `user_disabled`.
  - `enableLawyer(id)` → `ban_duration: 'none'`. Audit `user_enabled`.
  - `resendInvite(id)` za nalog koji još nije potvrđen.
  - `setRole(id, role)` → RPC `admin_set_role` (baza čuva poslednjeg admina).
- Svaka akcija ima potvrdu u UI-ju („Da li ste sigurni…”), kao brisanje u `app/documents/page.tsx`.

## Korak 2.5.7: Aktivnost (audit log)

- **`app/admin/activity/page.tsx`**: čita `audit_log` preko korisničkog klijenta (RLS + `aal2`). Filteri su advokat, akcija i period (podrazumevano 7 dana, najviše 90), sa paginacijom po ključu (`created_at`, `id`) po 50 redova. Akcije se prikazuju na srpskom („Otpremljen dokument”…), a `metadata` kao čitljiv opis, nikad kao sirov JSON.
- **`app/api/admin/audit/export/route.ts`** (`GET`): `requireAdmin()` + zod za filtere, CSV kroz `lib/csv.ts` (UTF-8 sa BOM-om, da Excel ispravno prikaže č/ć/š), `Content-Disposition: attachment`. Najviše 50.000 redova. Pre slanja upisuje `audit_exported` (filteri i broj redova u `metadata`).
- Stranica `/activity` za advokata (2.7) ostaje. Admin u njoj vidi samo svoje zapise, a sve vidi u `/admin/activity`.

## Korak 2.5.8: Podešavanja

- **`app/admin/settings/page.tsx`**: forma za četiri limita, sa trenutnim vrednostima i env gornjom granicom. Ako admin unese više od granice, ispod polja piše „Važi gornja granica ugovora: X”.
- Snimanje ide preko server action-a `updateSettings` → RPC `admin_update_settings`.
- `lib/usage.ts` čita `office_settings` pri svakoj rezervaciji (jedan mali upit), pa promena važi odmah.

## Korak 2.5.9: Ulaz u panel

- `app/components/Sidebar.tsx` dobija prop `isAdmin`. Link „Admin panel” se prikazuje samo adminu, dok je stvarnu zaštitu već obezbedio `requireAdmin()`. Uz to ide link „Bezbednost naloga” (`/account/security`) za sve korisnike.
- `app/chat/page.tsx` je klijentska komponenta, pa `isAdmin` dobija preko male API rute `GET /api/me` (`{ role }`, čitanje preko RLS-a) ili preko server layout-a za `/chat`.

## Korak 2.5.10: Testovi i verifikacija

**SQL (`supabase/tests/phase25_admin_test.sql`, sve se poništava sa `rollback`)** pravi admina A, advokata B i advokata C sa dokumentima, pasusima, razgovorima i porukama, pa proverava:
- B (`lawyer`) na `admin_list_users`, `admin_get_user`, `admin_set_role` i `admin_update_settings` dobija `42501`;
- A sa `aal1` (claim `aal` = `aal1`) dobija `42501` na svim admin RPC funkcijama i vidi samo svoje redove u `audit_log`;
- A sa `aal2`: `admin_get_user(B)` vraća nazive bez kolone sa sadržajem, a poziv upisuje `admin_viewed_user`;
- A sa `aal2` iz `document_chunks`, `messages`, `documents` i `chats` i dalje vidi **samo svoje redove**, a `match_document_chunks` vraća samo njegove naslove;
- uklanjanje uloge jedinom adminu pada sa `23514`, a sa dva admina prolazi;
- B ne može da menja `office_settings` (nema UPDATE grant);
- `anon` nema ništa (tabele, RPC, šema `private`).

**Jedinični testovi (`npm test`):** `lib/csv.ts` (injection, navodnici, prelomi), zod šeme za poziv, ulogu, podešavanja i filtere, i `min(podešavanje, env)`.

**Ručno (E2E):**
1. Admin bez MFA otvara `/admin`, pa ga sistem preusmerava na prijavu faktora. Posle prijave faktora panel radi.
2. Advokat otvara `/admin` i dobija 404. Isti advokat poziva `admin_list_users` direktno preko REST API-ja sa svojim JWT-om i dobija `42501`.
3. Poziv novog advokata: email stiže, link otvara `/set-password`, prijava radi, uloga je `lawyer`.
4. Blokada: blokiran advokat ne može da se prijavi. **Proveriti** da li `getUser()` (proxy, `requireUser`) odbija blokiranog korisnika dok mu access token još važi. Ako ga ne odbija, dodaje se kolona `profiles.disabled_at` (postavlja je `disableLawyer`), a `requireUser()` je proverava pri svakom zahtevu.
5. Podešavanja: spuštanje dnevnog limita na 2, pa treća poruka dobija 429. Podešavanje iznad env granice nema efekta.
6. CSV izvoz se otvara u Excel-u sa ispravnim slovima, a u logu se pojavljuje `audit_exported`.
7. Advisors → Security: nova su samo očekivana upozorenja za admin RPC funkcije (`security definer`).
8. `tsc`, lint, build, `npm test`, `npm audit --omit=dev`.

## Uticaj na druge faze

- **Faza 2:** stranica `/activity` (2.7) ostaje za advokate. `lib/usage.ts` čita `office_settings` tek od 2.5 (do tada env).
- **Faza 4 (onboarding checklista):** koraci iz 2.5.0 (SMTP, email template-i, MFA, redirect URL-ovi); prvi admin ide kroz `update public.profiles set role = 'admin' where email = '...'` u SQL Editoru, posle čega vlasnik prijavljuje MFA pri prvom ulasku u `/admin`; ostale advokate poziva sam vlasnik iz panela.
- **Van opsega (namerno):** trajno brisanje naloga i podataka, prenos dokumenata drugom advokatu, cene u EUR, PDF izveštaji, limiti po advokatu. Svaka od ovih stavki traži posebnu odluku.

## Fajlovi Faze 2.5

- **Novi:** `supabase/migrations/<ts>_phase25_admin.sql`, `supabase/tests/phase25_admin_test.sql`, `lib/require-admin.ts`, `lib/csv.ts` (+ test), `app/admin/layout.tsx`, `app/admin/page.tsx`, `app/admin/users/page.tsx`, `app/admin/users/[id]/page.tsx`, `app/admin/activity/page.tsx`, `app/admin/settings/page.tsx`, `app/admin/actions.ts`, `app/api/admin/audit/export/route.ts`, `app/auth/confirm/route.ts`, `app/set-password/page.tsx`, `app/account/security/page.tsx`, `app/login/mfa/page.tsx`, `app/api/me/route.ts`.
- **Menjaju se:** `proxy.ts`, `lib/validation.ts`, `lib/usage.ts`, `app/login/page.tsx`, `app/components/Sidebar.tsx`, `app/chat/page.tsx`, `CLAUDE.md` (status).
- **Brišu se:** `app/register/page.tsx`.
