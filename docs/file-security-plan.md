# FAZA 3: Bezbednost PDF i Word fajlova (plan)

Plan je usaglašen sa vlasnikom 2026-10-30, kroz 6 pitanja. Kod se piše tek kad vlasnik potvrdi ovaj plan. Radi se samo na `main`, bez novih grana.

## Stanje pre Faze 3 (provereno čitanjem koda 2026-10-29 i 2026-10-30)

| Šta | Danas | Gde |
|---|---|---|
| Prepoznavanje PDF-a | Samo `f.type === 'application/pdf'` ili ime na `.pdf`. Nema provere magičnih bajtova. | `lib/validation.ts` (`ingestFormSchema`) |
| Čitanje PDF-a | `unpdf` (pdf.js) u istom procesu kao ruta. Nema ograničenja broja strana, nema timeout-a za čitanje (postoji samo `maxDuration = 60` za celu funkciju). | `app/api/ingest/route.ts:36-37` |
| Word | Čita se u pregledaču (`mammoth`), proverava se samo ime `.docx`, a veličina se ne proverava. Izvučen tekst se lepi u pitanje. Server nikad ne vidi fajl, a Word se ne indeksira. | `app/chat/page.tsx` (`handleFileAttachment`) |
| Antivirus, aktivan sadržaj | Ne postoje. Vercel serverless nema stalan proces za ClamAV. | |
| Već postoji | Audit `document_upload_blocked` (razlozi `unreadable_pdf`, `no_text`, `too_many_chunks`; razlog je u `metadata`, a ne u CHECK listi, pa novi razlozi **ne traže migraciju**), dvostepeno upozorenje 409 za sumnjiv tekst, ledger, IP burst, restriktivne RLS polise. | `app/api/ingest/route.ts`, `lib/activity.ts` |

`jszip` je već u `node_modules`, ali samo kao zavisnost `mammoth`-a (nije direktna zavisnost).

## Odluke vlasnika (2026-10-30)

| # | Tema | Odluka |
|---|---|---|
| 1 | Skeniranje van sistema | **Ne.** Sada samo strukturna provera u našem kodu. Pravi antivirus (ClamAV) dolazi kao poseban servis po kancelariji u Fazi 4 (silo). Sistem ne napušta ništa osim teksta, koji već ide Voyage-u i Claude-u. |
| 2 | Word | **Ide na server**, gde se proverava i čita. |
| 3 | Aktivan sadržaj | **Odbija se uvek**, sa uputstvom šta korisnik treba da uradi, a razlog ide u audit. Nema opcije „Ipak dodaj". |
| 4 | Granice | **Umereno:** fajl do 4MB (kao danas), PDF najviše 300 strana, raspakovan Word najviše 50MB, čitanje najviše 20 s. |
| 5 | Upotreba Word-a | **Oba načina:** Word može u bazu znanja (kao PDF) i kao prilog uz pitanje. Prilog prolazi iste provere i ne čuva se. |
| 6 | Ostali tipovi | **Odbiti sa uputstvom:** stari `.doc` (OLE) i PDF zaštićen lozinkom. Skeniran PDF bez teksta ostaje odbijen kao danas (`no_text`). OCR nije u Fazi 3. |

## Koraci (redosled je bitan)

Posle svakog koraka: test-prvo (test mora da padne iz pravog razloga), pa mutacije novog koda, pa `npm test`, `tsc`, lint, `next build` i `npm audit --omit=dev`. Za rute se probe u `tools/verify` puštaju na pravom `next start`. Commit i push radi vlasnik.

**3.1 Prepoznavanje tipa po sadržaju (`lib/file-type.ts`, čist kod).** `detectFileType(bytes)` vraća `pdf`, `docx`, `legacy_doc`, `encrypted_office` ili `unknown`:
- `pdf`: bajtovi `%PDF-` u prvih 1024 (specifikacija dozvoljava smeće ispred zaglavlja);
- `docx`: ZIP (`PK\x03\x04`) koji u centralnom direktorijumu ima `[Content_Types].xml` i `word/document.xml`;
- `legacy_doc`: OLE potpis `D0 CF 11 E0 A1 B1 1A E1`. Šifrovan `.docx` je takođe OLE, pa poruka pokriva oba slučaja („sačuvajte kao .docx bez lozinke");
- ime fajla i MIME tip se više ne koriste za odluku.

`ingestFormSchema` prima i Word. Tip se određuje u ruti, posle čitanja bajtova (zod ne čita sadržaj).

**3.2 Word: provera ZIP-a pre raspakivanja (`lib/docx-inspect.ts`, čist kod).** Čita se samo centralni direktorijum ZIP-a, bez raspakivanja:
- zbir `uncompressedSize` mora biti do 50MB, broj stavki do 2.000, a odnos raspakovano/spakovano po stavci do 100 (zip bomba);
- odbija se ako postoji `word/vbaProject.bin`, `*.bin` u `word/embeddings/`, `oleObject`, `activeX`, ili `[Content_Types].xml` deklariše `macroEnabled` (`.docm` preimenovan u `.docx`);
- odbija se ako `word/_rels/*.rels` ima `TargetMode="External"` za tip `attachedTemplate`, `oleObject` ili `frame` (učitavanje udaljenog šablona). Obične spoljne veze (hyperlink) su dozvoljene.

**Odluka za korak 3.2:** sopstveni čitač centralnog direktorijuma (oko 80 linija, testiran) ILI `jszip` kao direktna zavisnost. Predlog je sopstveni čitač, jer `jszip` ne daje javno `uncompressedSize` pre raspakivanja. Pre koda javljam vlasniku u dve rečenice šta dodajem.

Tek posle provere `mammoth.extractRawText` na serveru čita tekst.

**3.3 PDF: aktivan sadržaj, šifrovanje i granice (`lib/pdf-inspect.ts` + ruta).**
- Šifrovan PDF: pdf.js baca `PasswordException`, a mi ga odbijamo kao `encrypted_pdf`. PDF koji ima samo vlasničku lozinku (otvara se bez lozinke) prolazi, jer se tekst može pročitati.
- Aktivan sadržaj, u dva sloja: (a) brza pretraga sirovih bajtova na `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/XFA`, `/SubmitForm`, `/ImportData`, uz normalizaciju `#xx` zapisa u imenima (`/J#61vaScript`); (b) pdf.js API posle otvaranja (`getJSActions`, `getAttachments`, `getOpenAction`), koji vidi i ono što je u kompresovanim tokovima objekata. Bilo koji pogodak znači `active_content`.
- Granice: `numPages` do 300 (provera pre `extractText`), a dužinu teksta i dalje čuva postojeća granica od 500 pasusa.

**3.4 Timeout i izolacija čitanja.** Čitanje PDF-a i Word-a ide u `worker_threads` (Node) sa `terminate()` posle 20 s, pa zaglavljen parser stvarno prestaje da troši CPU. **Mora se proveriti na Vercel preview-u** (bundling worker fajla u Next 16, pre koda pročitati `node_modules/next/dist/docs/`). Rezervni plan, ako worker ne radi na Vercelu: `Promise.race` sa 20 s (korisnik odmah dobija odgovor, ali CPU radi do `maxDuration`). Isti izbor važi za Word.

**3.5 Rute.**
- `/api/ingest`: prima PDF i Word. Redosled je IP burst → autentifikacija → zod → bajtovi → `detectFileType` → provera (3.2 ili 3.3) → čitanje u worker-u → pasusi → detekcija sumnjivog teksta (postojeća, 409) → rezervacija → upis. Odbijanja ne troše ledger.
- Nova `POST /api/attachments/docx`: ista provera i čitanje kao za Word u ingest-u, a vraća samo tekst (bez upisa u bazu, bez Voyage-a). Ima IP burst, autentifikaciju, audit `attachment_read` ili `document_upload_blocked` (bez sadržaja i naziva) i dnevni limit (predlog: brojanje kroz ledger kao `kind = 'attachment'` traži migraciju, zato se o tome odlučuje u koraku 3.5 pre koda). `app/chat/page.tsx` više ne uvozi `mammoth`; šalje fajl ovoj ruti, a tekst ide u pitanje kao danas.
- `PdfUploader.tsx` prima `.pdf,.docx` i proverava veličinu pre slanja.

**3.6 Audit i prikaz.** Novi razlozi u `document_upload_blocked`: `unsupported_type`, `legacy_doc`, `encrypted_pdf`, `encrypted_office`, `active_content` (u `metadata` ide vrsta nalaza, npr. `pdf_javascript` ili `docx_macro`, bez naziva fajla), `archive_bomb`, `too_many_pages`, `parse_timeout`. Opisi se dodaju u `lib/activity.ts` i vide se u `/activity` i `/admin/activity`. Migracija nije potrebna (razlog je u `metadata`). Proveriti da `metadata.file_kind` (`pdf`/`docx`) stoji uz `document_uploaded`.

**3.7 Testovi i uzorci.** Uzorci se generišu u testu (bez binarnih fajlova u repou, bez pravog malvera): PDF sa `/JavaScript` u običnom i u kompresovanom toku objekata, PDF sa `/J#61vaScript`, PDF sa ugrađenim fajlom, šifrovan PDF, PDF od 301 strane, `.docx` sa `vbaProject.bin`, `.docm` preimenovan u `.docx`, `.docx` sa spoljnim `attachedTemplate`, zip bomba (malo spakovano, mnogo raspakovano), OLE `.doc`, tekst preimenovan u `.pdf`, ispravni PDF i `.docx` koji MORAJU da prođu (lažno pozitivni). Mutacije za svaku proveru. Probe u `tools/verify` za obe rute. EICAR se ne koristi (nema antivirusa u ovoj fazi).

**3.8 Završna provera.** Preview, ručno: običan PDF i `.docx` u bazu znanja, `.docx` kao prilog, odbijanje `.docm`, `.doc`, šifrovanog PDF-a i PDF-a sa JavaScript-om (sa porukom i audit zapisom), vreme čitanja velikog ali ispravnog PDF-a (300 strana). Zatim ažurirati CLAUDE.md.

## Šta Faza 3 NE radi

- Nema antivirusa (ClamAV dolazi u Fazi 4, po kancelariji), pa malver koji ne koristi aktivan sadržaj (npr. eksploatacija čitača u pregledaču advokata) se ne hvata. Ublažava ga to što mi fajl ne čuvamo niti ga vraćamo korisniku: čuva se samo izvučen tekst.
- Nema OCR-a.
- Nema čišćenja (sanitizacije) fajla: fajl se ili prihvati (i od njega ostaje samo tekst) ili odbije.

## Rezultat 3.1 do 3.4 (2026-10-30, na `main`, NIJE commit-ovano)

Vlasnik je 2026-10-30 rekao „kreni po redu iz plana”, što je potvrda plana. Svaka jedinica je rađena test-prvo (test viđen kako pada iz pravog razloga), a zatim su pokrenute mutacije (namerne greške u kopiji koda): sve mutacije su ili uhvaćene ili dokazano ekvivalentne (razlog je u mutacionom fajlu).

**Novi fajlovi (lib/):** `zip-directory.ts` (čitač centralnog direktorijuma ZIP-a), `file-type.ts` (3.1), `docx-inspect.ts` (3.2), `docx-read.ts`, `pdf-inspect.ts` i `pdf-read.ts` (3.3), `file-read.ts` i `file-worker.ts` (3.4). **Samo za testove:** `lib/test-support/zip-builder.ts` (pravi ZIP/.docx uzorke, ume da laže u zaglavljima), `pdf-builder.ts` (pravi PDF uzorke: običan, kompresovan tok objekata PDF 1.5, šifrovan RC4 40-bit, sa aktivnim sadržajem), `hang-worker.ts`. U repou nema binarnih uzoraka ni pravog malvera. **Mutacioni fajlovi:** `tools/verify/mutations-lib-3-1.mjs` (83 mutacije: 75 uhvaćeno, 8 ekvivalentnih), `mutations-lib-3-3.mjs` (68: 59 / 9), `mutations-lib-3-4.mjs` (20: 19 uhvaćeno, 1 se ne pušta jer bi trošila memoriju računara). Svi se pokreću iz korena: `node tools/verify/mutations-lib-3-X.mjs [deo imena]`.

**Izmena postojećeg:** `ingestFormSchema` više ne proverava MIME ni ekstenziju (poruka „Niste poslali fajl.”); tip određuje ruta po sadržaju (`detectFileType`). **Ruta još NIJE prepravljena (to je 3.5)**, pa se do tada u `/api/ingest` svaki fajl koji nije PDF završava kao 400 `invalid_pdf`.

**Odluke koje sam doneo (Ruling: šta / zašto / cena ako je pogrešno):**
1. **Sopstveni čitač ZIP direktorijuma, bez nove zavisnosti** (predlog iz plana). Strog je: direktorijum mora da se završava tačno na EOCD-u, bez smeća ispred arhive, bez razmaka, bez ZIP64, jer bi inače naš čitač mogao da vidi drugačiji direktorijum nego mammoth (jszip). Cena: legitiman .docx sa neobičnim zapisom bi se odbio (Word i LibreOffice ovako ne pišu).
2. **Deklarisane veličine u ZIP-u mogu da lažu**, pa se pored pregleda direktorijuma svaka stavka STVARNO raspakuje, ali ograničeno (`inflateRawSync` sa `maxOutputLength` = deklarisana veličina). Veće ili manje od deklarisanog je `archive_bomb` / `zip_size_mismatch`. Plan je tražio samo direktorijum; to bi dozvolilo bombu sa malim zaglavljem (jszip bi je raspakovao). Cena: do 50MB raspakivanja po otpremanju (~100 ms).
3. **Odnos raspakovano/spakovano (100) se proverava samo za stavke od 64KB naviše.** Male stavke ne mogu da naškode (zbir je ograničen na 50MB), a daju lažno pozitivne (nule, ponovljen tekst). Cena: mala stavka sa visokim odnosom prolazi (bezopasno).
4. **Novi razlog `unreadable_docx`** (oštećen Word, simetrično sa `unreadable_pdf`), uz `finding` u metadata. Dodaje se u 3.6.
5. **`encrypted_office` se prepoznaje po toku `EncryptedPackage` (UTF-16LE) u OLE fajlu**, a ostali OLE je `legacy_doc`. Plan je navodio oba tipa, ali samo potpis OLE-a; razlika daje tačniju poruku.
6. **ZIP sa `%PDF-` u prvih 1024 bajta ostaje ZIP, nikad PDF** (jedan tip = jedan parser). Cena: PDF koji počinje sa `PK\x03\x04` (poliglot) se ne prihvata kao PDF.
7. **U `word/embeddings/` se odbijaju samo `.bin` objekti (i svaki `oleObject*`)**, kako stoji u planu. Ugrađena Excel tabela (`.xlsx`) prolazi: mammoth je ne čita, a fajl se ne čuva. Cena: ugrađen .xlsm prolazi; nije aktivan u našem toku.
8. **PDF, sloj (a) nije pretraga bajtova nego čitač strukture** (preskače stringove, komentare i tokove). Razlog: u slikama bi `/JS` slučajno nastao sa ~1% verovatnoće na 4MB, a nema „Ipak dodaj”. Poređenje imena je tačno (`/JavaScripts`, `/LaunchPad` nisu pogodak), `#xx` zapis se normalizuje.
9. **pdf.js ne prijavljuje JavaScript akciju na link anotaciji** (u izvornom kodu je preskače bez traga), pa sloj (b) iz plana sam ne bi bio dovoljan. Zato sloj (a) raspakuje i skenira tokove objekata (`ObjStm`), gde moderni PDF-ovi drže akcije (zbir raspakovanog ograničen na 50MB). Mutaciona provera je otkrila stvarnu rupu u mom prvom kodu: **`ObjStm` bez ikakvog filtera** (običan tekst) se preskakao. Ispravljeno (test pao pa prošao).
10. **Poznata praznina (dokumentovana testom `ZNANA PRAZNINA` i napomenom u `pdf-inspect.ts`):** akcija na linku sakrivena u `ObjStm`-u **šifrovanog** PDF-a (samo vlasnička lozinka) ili u `ObjStm`-u sa filterom koji nije Flate (LZW, ASCII85) nije vidljiva nijednom sloju. Sloj (b) i dalje hvata JavaScript dokumenta, polja, priloge i RichMedia (probano i za šifrovan kompresovan PDF). Cena: retko, namerno prerušen PDF prolazi; tekst se ionako izvlači bez izvršavanja ičega.
11. **PDF granica od 300 strana je PRE izvlačenja teksta**, a pdf.js dobija KOPIJU bajtova (inače prazni pozivaočev bafer).
12. **Worker (3.4): `new Worker(new URL('./file-worker.ts', import.meta.url))` mora da bude doslovan izraz.** Sa promenljivom umesto njega Turbopack povlači ceo projekat (čak i `eslint.config.mjs`) i build pada (to se desilo pri prvom pokušaju). Zamena radnika za testove ide preko `createWorker` fabrike. Prekid vraća `parse_timeout`, pad `worker_failed`, nestanak memorije (`resourceLimits` 512MB) `archive_bomb` / `worker_out_of_memory`.

**Proba bundlera i prekida na pravom `next start` (privremena ruta, obrisana):** build prolazi, Turbopack pravi poseban chunk `[worker thread]-lib_file-worker_ts_….js`. Probano: običan PDF (~0,6 s), .docx (~0,4 s), PDF sa JavaScript-om i .docx sa makroom odbijeni, 300 strana PDF-a ~1,1 s, tajmer od 150 do 200 ms vraća `parse_timeout` u roku od ~tajmer, server posle toga čita normalno, CPU u mirovanju 0 ms za 4 s i broj niti se ne menja (20/20). U trace fajlu rute su samo `next` i `@swc/helpers`: `mammoth` i `unpdf` su spakovani u chunk-ove, pa funkcija na Vercelu ne traži `node_modules` u runtime-u. **Nije viđeno: Vercel** (da li `worker_threads` i taj chunk rade u njihovoj funkciji; to je tačka za preview u 3.8, rezervni plan `Promise.race` je opisan u koraku 3.4).

**Provere:** `npm test` (zeleno, vidi kraj), `tsc` čist, lint čist.

## Šta radi vlasnik: korak 3.8 (ručna provera na Vercelu)

Radi se samo na `main`, pa push znači produkciju (nema preview grane). Zato: **proveri odmah posle deploy-a, a ako worker na Vercelu ne radi, vrati prethodni deploy** (Vercel → Deployments → prethodni → „Instant Rollback”). Šta se tada dešava ako worker ne radi: otpremanje dokumenta i Word prilog vraćaju grešku „Došlo je do greške pri obradi fajla” (`worker_failed`, HTTP 500), a ništa ne ulazi u bazu i ne troši limit. Dakle kvar je zatvoren, ne otvoren. Chat bez priloga i dalje radi.

**Migracija nije potrebna** (razlozi odbijanja su u `metadata`, a nove akcije u audit logu nema). **Nove env varijable nema.**

**1. Napravi probne fajlove** (bezopasni, bez pravog malvera):

```
node --experimental-strip-types --disable-warning=ExperimentalWarning tools/verify/make-sample-files.mjs C:\Users\Pedja\Desktop\probni-fajlovi
```

Ispisuje 13 fajlova i šta se od svakog očekuje.

**2. Tabela provere** (upiši rezultat; „ODBIJEN” znači poruka na srpskom sa uputstvom i zapis „Blokirano otpremanje” u `/activity`):

| Fajl | Gde | Očekuješ |
|---|---|---|
| `01-ispravan.pdf` | „Dodaj pravnu literaturu” | uspeh, dokument se vidi u listi |
| `02-ispravan.docx` | „Dodaj pravnu literaturu” | uspeh; u `/activity` piše „Vrsta fajla: Word (.docx)” |
| `02-ispravan.docx` | spajalica u chatu (prilog) | tekst se učitava, pitanje sa prilogom daje odgovor |
| `03-pdf-300-strana.pdf` | „Dodaj pravnu literaturu” | uspeh; **zabeleži koliko traje** (granica je 20 s) |
| `10-pdf-301-strana.pdf` | isto | ODBIJEN: „PDF ima 301 strana, a najviše je 300” |
| `11-pdf-sa-javascript.pdf` | isto | ODBIJEN: aktivan sadržaj (JavaScript u PDF-u) |
| `12-pdf-sa-lozinkom.pdf` | isto | ODBIJEN: zaštićen lozinkom |
| `13-pdf-bez-teksta.pdf` | isto | ODBIJEN: nema teksta |
| `14-docx-sa-makroom.docx` | isto, i kao prilog | ODBIJEN: aktivan sadržaj (makroi) |
| `15-docx-udaljeni-sablon.docx` | isto | ODBIJEN: šablon koji se učitava sa interneta |
| `16-docx-bomba.docx` | isto | ODBIJEN: neobično velik kad se raspakuje |
| `17-stari-word.doc` | isto | ODBIJEN: stari .doc, uputstvo „Sačuvaj kao .docx” |
| `18-word-sa-lozinkom.docx` | isto | ODBIJEN: Word zaštićen lozinkom |
| `19-tekst-kao-pdf.pdf` | isto | ODBIJEN: tip fajla nije podržan |
| `.docx` iz Worda (pravi dokument, ako imaš sa tabelama, fusnotama i slikama) | baza znanja i prilog | uspeh (provera lažno pozitivnih: pravi Word fajl NE sme da bude odbijen) |
| Pravi PDF iz prakse (sa i bez slika, ako imaš i jedan sa popunjivim poljima) | baza znanja | uspeh |

**3. Posle toga:** u `/activity` (kao advokat) proveri da se vide razlozi bez internih oznaka i bez naziva fajla. U Vercel logovima proveri da nema `File worker` grešaka (osim očekivanih za odbijene fajlove: njih nema, odbijanje nije greška servera).

**4. Javi mi:** koji su redovi pali, vreme za 300 strana i bilo koji pravi dokument koji je pogrešno odbijen (to je lažno pozitivan rezultat i traži izmenu pravila, jer nema „Ipak dodaj”).

**Ako worker na Vercelu ne radi:** rezervni plan iz koraka 3.4 (`Promise.race` sa 20 s u istom procesu; korisnik odmah dobija odgovor, ali parser troši CPU do kraja funkcije). Cena je jedna izmena u `lib/file-read.ts`, testovi i proba ostaju.

## Rezultat 3.5 do 3.7 (2026-10-30, na `main`, NIJE commit-ovano) i odakle se nastavlja

**Urađeno:**
- **3.5 rute:** `/api/ingest` prima PDF i Word (tip po sadržaju, čitanje u worker niti, odbijanje sa uputstvom i audit razlogom, `file_kind` u auditu). Nova `POST /api/attachments/docx` vraća samo tekst Word priloga, bez ikakvog upisa i bez rezervacije u ledger-u. `PdfUploader.tsx` prima `.pdf,.docx`; chat stranica više ne parsira Word u pregledaču (nema `mammoth` u klijentskom kodu). Novo: `lib/upload-rejection.ts` (razlog odbijanja → HTTP status, kod, poruka, audit metapodaci), `lib/active-content-labels.ts`, `attachmentFormSchema` u `lib/validation.ts`.
- **3.6 audit i prikaz:** `lib/activity.ts` opisuje nove razloge (`unsupported_type`, `legacy_doc`, `encrypted_pdf`, `encrypted_office`, `active_content`, `archive_bomb`, `too_many_pages`, `parse_timeout`, `unreadable_docx`), vrstu nalaza, vrstu fajla, broj strana i oznaku „prilog uz pitanje”. Popravljen je i stari propust: `BLOCK_REASONS['constructor']` je vraćao funkciju iz prototipa. Migracija nije potrebna.
- **3.7 provere:** `lib/file-guards.test.ts` (13 statičkih provera pravila: nijedna ruta ne uvozi `unpdf`/`mammoth`, tip po sadržaju, redosled IP burst → prijava → čitanje, čitanje pre rezervacije, audit bez naziva fajla, doslovan `new Worker(new URL(...))`); `tools/verify/probe-file-security.mjs` (proba na pravom `next start` sa lažnim Supabase-om: **122 provere, 0 palo**, 12 s); `tools/verify/make-sample-files.mjs` (13 bezopasnih probnih fajlova za ručnu proveru); `tools/verify/mutations-app-3-5.mjs`.

**Odluke (Ruling) za 3.5:**
13. **Nema `attachment_read` u audit logu.** CHECK lista akcija u bazi ga ne sadrži, pa bi tražio migraciju. Uspešan prilog se ne beleži; odbijeni idu kao `document_upload_blocked` sa `metadata.context = 'attachment'`. Cena: ne vidi se ko je koliko priloga pročitao. Ako to zatreba: nova migracija (akcija u CHECK listi) pa jedan `logAudit`.
14. **Prilog nema dnevni limit u ledger-u** (to bi tražilo migraciju za `kind = 'attachment'`). Ne troši spoljni servis (nema Voyage ni Claude poziva, tekst ide u pitanje koje ima svoj limit), a od poplave štiti IP burst, ograničenje od 4MB i 20 s. Cena: CPU do granica; ako zatreba, migracija.
15. **Greška worker-a (`worker_failed`) je HTTP 500 i NE upisuje se kao „blokirano otpremanje”** (nije krivica korisnikovog fajla); ide samo u log servera. Istek vremena je 422 `parse_timeout`.
16. **Poruka „Ovaj tip nije podržan” za prilog kaže „samo Word (.docx)”** (kontekst `attachment` u `describeRejection`).

**Mutacije povezivanja 3.5** (`node tools/verify/mutations-app-3-5.mjs [static|probe] [deo imena]`): statički sloj **8/8 uhvaćeno**. Sloj sa pravim serverom (19 mutacija, ~70 s po mutaciji): do trenutka pisanja svih uhvaćenih 11 koje su se izvršile (Word kao PDF, audit bez vrste fajla, bez upisa audita, poruka za prazan Word, prazan tekst prolazi, PDF kao prilog, poruka za prilog, skraćen tekst, prazan prilog, stari .doc kod priloga, audit priloga bez vrste fajla). **Tri su neizvršene i treba ih ponovo pustiti:** (a) „ingest: nepoznat tip se prijavljuje kao oštećen Word”, (b) „ingest: stari .doc i šifrovan Word se prijavljuju kao nepodržan tip” (obe prvobitne varijante, uklanjanje ranih `return`-ova, nisu se prevodile jer TypeScript ne pušta `'unknown'` do `readFileInWorker`; zamenjene su prevodivim), (c) „prilog: audit bez oznake konteksta” (izraz se pojavljivao dvaput, ispravljen). Plus poslednja u seriji „prilog: blokiran nalog dobija tekst” i kontrolni build/proba, čije rezultate nisam video kad je pisan ovaj odeljak.

**Ostaje (u sledećem ćetu, redom):**
1. Proveriti da su izvorni fajlovi vraćeni posle mutacija (`cmp` sa rezervnim kopijama u scratchpad-u, ili `git diff` na `app/api/attachments/docx/route.ts`, koji mora da sadrži `if (!user) return errorResponse!;`, `context: 'attachment'`, `describeRejection(rejection, 'attachment')`).
2. Pustiti tri neizvršene mutacije: `node tools/verify/mutations-app-3-5.mjs probe "nepoznat tip"`, `... probe "stari .doc i šifrovan Word se prijavljuju"`, `... probe "audit bez oznake konteksta"` (svaka ~70 s, traži build; na kraju je kontrolni build i proba).
3. Završne provere: `npm test`, `npx tsc --noEmit`, `npx eslint app lib`, `npm run build` (sa `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=fake-anon-key`), `npm audit --omit=dev` (bilo 0), pa probu `node --experimental-strip-types --disable-warning=ExperimentalWarning tools/verify/probe-file-security.mjs`.
4. Ažurirati `CLAUDE.md` (status Faze 3; odluke 13 do 16; Faza 3 ostaje `[ ]` do tvoje potvrde 3.8). Linije u CLAUDE.md su CRLF: samo izmene jedne linije.
5. **Tvoj deo: commit i push, pa korak 3.8** (odeljak „Šta radi vlasnik” iznad).

**Ažuriranje (kraj serije mutacija 3.5):** pokrenuto 15 mutacija sloja sa pravim serverom, **12 uhvaćeno, 0 preživelo, 3 neprimenjene** (upravo tri iz tačke 2 iznad), a svi izvorni fajlovi su vraćeni (`cmp` sa rezervnim kopijama). Kontrolni build na vraćenim fajlovima prolazi, a kontrolna proba daje 122 provere prošlo, 0 palo (viđeno). Poslednja mutacija u seriji, „prilog: blokiran nalog dobija tekst”, takođe je uhvaćena. Tačka 3 u „Ostaje” i dalje traži `npm test`, `tsc`, lint i `npm audit` na konačnom stanju.

**Završeno 2026-10-30 (tačke 1 do 4 iz „Ostaje”):** izvorni fajlovi su vraćeni (`cmp` sa rezervnim kopijama). Tri preostale mutacije su uhvaćene: „nepoznat tip se prijavljuje kao oštećen Word” (4 provere pale), „stari .doc i šifrovan Word se prijavljuju kao nepodržan tip” (4 pale) i „prilog: audit bez oznake konteksta” (7 palo). **Ukupno sloj sa pravim serverom: 15 uhvaćeno, 0 preživelo; statički sloj 8/8.** Posle svake mutacije kontrolni build prolazi, a proba daje 122/122. Konačno stanje: `npm test` 525/525, `tsc` čist, lint 0 grešaka (2 stara upozorenja u `Sidebar.tsx`), `next build` prolazi, `npm audit --omit=dev` 0, `probe-file-security.mjs` 122 provere prošlo, 0 palo. Ostaje samo tačka 5 (commit, push i 3.8, radi vlasnik). Nezavisan pregled koda (drugi pregledač) nije rađen.
