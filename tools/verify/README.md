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
   node tools/verify/probe-admin-activity.mjs
   ```

   Izlaz je jedna linija po proveri (`ok` / `FAIL`), kod izlaza je 1 ako je bilo koja pala. Ponovni build je potreban posle svake izmene koda aplikacije.

## Sadržaj

| Fajl | Čemu služi |
|---|---|
| `lib/fake-supabase.mjs` | Lažni Auth (`/auth/v1/user`), REST (`profiles`, `office_settings`, `documents`, `audit_log` sa filterima, `or=(...)`, redosledom, `limit`, `count=exact`) i RPC (`admin_list_users`, `admin_update_settings`). Beleži svaki zahtev (pozivalac, parametri, telo). Namerne greške preko `state.failures`. |
| `lib/app.mjs` | Pokreće pravi `next start`, pravi kolačić sesije, `get()`, `textOf()`/`hrefsOf()` za HTML, i `callFormAction()` koji poziva server akcije preko HTTP-a (ID iz `.next/server/server-reference-manifest.json`). |
| `probe-admin-activity.mjs` | Proba 2.5.7 (Aktivnost, CSV izvoz) i 2.5.8 (Podešavanja): pristup, filteri, beogradske granice, paginacija po kursoru, izvoz od 50.000+ redova kao strim, greške usred izvoza, snimanje podešavanja. |

## Zamke koje su već plaćene

- `NEXT_PUBLIC_*` se ugrađuje pri build-u: build i `next start` moraju da koriste isti `http://127.0.0.1:54321`.
- Kolačić sesije se zove `sb-<prvi deo hosta>-auth-token`, za `127.0.0.1` to je `sb-127-auth-token`. Vrednost je `base64-` + base64url(JSON sesije). JWT-u treba samo čitljiv payload (`sub`, `aal`, daleko `exp`); važenje potvrđuje `getUser()` (lažni server).
- `Response.text()` sam odbacuje UTF-8 BOM: za proveru BOM-a čitaju se sirovi bajtovi (`get()` vraća `raw`).
- Server akcije: polja forme idu sa prefiksom `_1_`, a koren `0` = `[stanje, "$K1"]` mora biti POSLEDNJI deo multipart tela (busboy čita u toku, pa koren pre polja daje prazan `FormData`).
- `proxy.ts` zaustavlja admina sa faktorom a bez koda pre akcije. Da bi se proverila sama provera `aal2` u akciji, koristi se admin BEZ uključenog MFA (prolazi proxy).
- `Accept-Encoding: identity` pri proveri strimovanja: `next start` može da kompresuje odgovor, a to menja veličinu delova.
- Veći fajlovi se pišu alatom za pisanje fajlova, ne shell heredoc-om (dugačka komanda se seče).

## Kasnije

PGlite harness za SQL migracije i testove (`supabase/tests/*.sql`) se dodaje ovde kad sledeća migracija (2.5.11) to zatraži. Recept je u beleški "local-verification-recipe".
