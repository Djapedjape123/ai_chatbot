# tools/verify: alati za proveru

Ovo NIJE deo aplikacije. Folder ima sopstveni `package.json` bez zavisnosti (samo Node 22) i nije u `tsconfig.json` ni u ESLint opsegu (`eslint.config.mjs` ga preskače), pa `npm run lint`, `tsc` i `next build` ne vide ništa odavde.

Zašto postoji: u repou nema lokalnog Supabase-a, a MCP je read-only. Svaki korak Faze 2.5 se zato proverava probom na **pravom `next start`** koji govori sa **lažnim Supabase-om** (Auth, REST i RPC). Ranije se ta skripta pravila iznova pri svakom koraku; sada se čuva.

## Šta proba dokazuje, a šta ne

Dokazuje: ŠTA aplikacija šalje (adrese, parametri, zaglavlja, telo), KO je pozivalac (JWT admina sa `aal2`, ili servisni ključ), redosled poziva (npr. audit zapis PRE slanja izvoza), kako reaguje na odgovore i greške, i kako se ponaša pravi Next (proxy, layout, stranice, server akcije, strimovanje).

Ne dokazuje: da pravi Supabase odgovara isto. Lažni server je namerno strog gde je ponašanje PostgREST-a poznato (npr. vrednost sa rezervisanim znakom `:` u `or=(...)` mora biti pod navodnicima, kursor se poredi u mikrosekundama, `max_rows` je 1000), a sve ostalo je minimum potreban za proveru. **Šta fali:** RLS je ugrađena u lažni server kao jedna funkcija (`isAdmin`), a ne pravi polise; tipovi kolona i izraz `count=exact` su pojednostavljeni; Auth je samo `GET /auth/v1/user`. Svaka stavka u izveštaju koja zavisi od pravog Supabase-a i Vercela mora ostati "nije proveravano" dok je vlasnik ne potvrdi.

## Pokretanje

1. Build sa adresom lažnog servera (`NEXT_PUBLIC_*` se ugrađuje pri build-u), iz korena repozitorijuma:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=fake-anon-key npm run build
   ```

2. Proba (pokreće lažni server na `127.0.0.1:54321` i `next start` na portu 3111; portovi moraju biti slobodni):

   ```bash
   node tools/verify/probe-admin-activity.mjs   # 2.5.7 i 2.5.8
   node tools/verify/probe-sidebar-entry.mjs    # 2.5.9 (isti build; traži Edge na računaru)
   ```

   Izlaz je jedna linija po proveri (`ok` / `FAIL`), kod izlaza je 1 ako je bilo koja pala. Ponovni build je potreban posle svake izmene koda aplikacije.

## Sadržaj

| Fajl | Čemu služi |
|---|---|
| `lib/fake-supabase.mjs` | Lažni Auth (`/auth/v1/user`), REST (`profiles`, `office_settings`, `documents`, `audit_log` sa filterima, `or=(...)`, redosledom, `limit`, `count=exact`) i RPC (`admin_list_users`, `admin_update_settings`). Beleži svaki zahtev (pozivalac, parametri, telo). Namerne greške preko `state.failures`. |
| `lib/app.mjs` | Pokreće pravi `next start`, pravi kolačić sesije, `get()`, `textOf()`/`hrefsOf()` za HTML, i `callFormAction()` koji poziva server akcije preko HTTP-a (ID iz `.next/server/server-reference-manifest.json`). |
| `probe-admin-activity.mjs` | Proba 2.5.7 (Aktivnost, CSV izvoz) i 2.5.8 (Podešavanja): pristup, filteri, beogradske granice, paginacija po kursoru, izvoz od 50.000+ redova kao strim, greške usred izvoza, snimanje podešavanja. |
| `probe-sidebar-entry.mjs` | Proba 2.5.9 (ulaz u panel): `GET /api/me` preko HTTP-a, HTML `/chat` sa servera i meni u PRAVOM pregledaču (Edge preko `playwright-core`): advokat nema vezu ni reč „Admin panel", admin je vidi i klik otvara pregled, admin bez MFA završava na `/account/security`, pad baze ne lomi meni, nema prefetch-a ka `/admin`. Lažni server ima i `chats`, grešku `select_profiles` i nalog bez profila (`noProfile`). |
| `lib/mutate.mjs` | Runner za namerne greške (mutacije): kvari jedan izraz, pokreće proveru, očekuje da PADNE; fajlovi se vraćaju u `finally` i pri izlasku, uz proveru heša. |
| `mutations-lib-2-5-7.mjs`, `mutations-app-2-5-7.mjs` | Mutacije 2.5.7 i 2.5.8 (čista logika; povezivanje stranica, rute izvoza i akcije). |
| `mutations-2-5-9.mjs` | Mutacije 2.5.9: sloj `static` (`npm test`, brzo) i sloj `probe` (build + `probe-sidebar-entry.mjs`, ~2 minuta po mutaciji). |

## Zamke koje su već plaćene

- `NEXT_PUBLIC_*` se ugrađuje pri build-u: build i `next start` moraju da koriste isti `http://127.0.0.1:54321`.
- Kolačić sesije se zove `sb-<prvi deo hosta>-auth-token`, za `127.0.0.1` to je `sb-127-auth-token`. Vrednost je `base64-` + base64url(JSON sesije). JWT-u treba samo čitljiv payload (`sub`, `aal`, daleko `exp`); važenje potvrđuje `getUser()` (lažni server).
- `Response.text()` sam odbacuje UTF-8 BOM: za proveru BOM-a čitaju se sirovi bajtovi (`get()` vraća `raw`).
- Server akcije: polja forme idu sa prefiksom `_1_`, a koren `0` = `[stanje, "$K1"]` mora biti POSLEDNJI deo multipart tela (busboy čita u toku, pa koren pre polja daje prazan `FormData`).
- `proxy.ts` zaustavlja admina sa faktorom a bez koda pre akcije. Da bi se proverila sama provera `aal2` u akciji, koristi se admin BEZ uključenog MFA (prolazi proxy).
- `Accept-Encoding: identity` pri proveri strimovanja: `next start` može da kompresuje odgovor, a to menja veličinu delova.
- Veći fajlovi se pišu alatom za pisanje fajlova, ne shell heredoc-om (dugačka komanda se seče).
- Klijentska stranica (npr. `/chat`) dobija podatke tek posle učitavanja: HTML sa servera NE pokazuje ono što stiže iz `fetch`-a u `useEffect`. Za to služi pravi pregledač (`probe-sidebar-entry.mjs`); odsustvo nečega proverava se uz "pozitivnu kontrolu" (isti tok za admina mora da ga prikaže), inače bi „nema ga" prolazilo i kad stranica nikad ne bi stigla do tog mesta.
- Runner za mutacije prepisuje izvorne fajlove: dok radi, IDE javlja da su se fajlovi „promenili na disku". Ne uređivati iste fajlove i ne pokretati build ili `npm test` u međuvremenu. Pre serije na NEcommit-ovanom kodu napraviti kopiju fajlova (heš se proverava na kraju).
- Shell na ovom računaru izbacuje `\r` iz `$'\r'`, pa `grep -c $'\r'` broji SVE redove. Završetke redova meriti Node-om (`/\r\n/g`). Samo `CLAUDE.md`, `lib/validation*.ts` i `eslint.config.mjs` su CRLF; `docs/*.md` i `tools/**` su LF.

## Kasnije

PGlite harness za SQL migracije i testove (`supabase/tests/*.sql`) se dodaje ovde kad sledeća migracija (2.5.11) to zatraži. Recept je u beleški "local-verification-recipe".

Proba u pregledaču (`probe-sidebar-entry.mjs`) koristi `playwright-core` iz `node_modules` (zavisnost `next`-a, bez nove instalacije) i Edge instaliran na računaru (`channel: 'msedge'`). Ako ga nema, proba pada na proveri "pregledač se pokreće", a ne prolazi tiho.
