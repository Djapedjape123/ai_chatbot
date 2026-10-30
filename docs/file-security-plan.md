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
