# Plan prodaje: partnerstvo sa agencijom, pa srednje kancelarije u Srbiji

Usaglašen 2026-11-06 kroz 20 pitanja. Osnova je za `docs/plan-agencija.md` (kako se sve ovo objašnjava agenciji). Cene i troškovi su predlog koji se proverava sa agencijom i prvim kancelarijama.

## Odgovori vlasnika (20 pitanja, 2026-11-06)

| Tema | Odluka |
|---|---|
| Agencija | Marketing, pravi sajtove i web aplikacije. Vlasnik već radi sa njima kao frilenser. |
| Cilj | Partnerstvo sa podelom zarade, **60/40 u korist vlasnika** |
| Vlasništvo | **Kod ostaje vlasnikov**, agencija ima pravo prodaje |
| Uloge | Agencija: marketing, prodaja i **prva podrška**. Vlasnik: tehnika i druga podrška. |
| Fakturisanje | **Agencija fakturiše** kancelarijama |
| Rok | Dogovor u roku od mesec dana |
| Tržište i kupac | Samo Srbija, **srednje kancelarije (5 do 20 advokata)** |
| Glavni problemi | Traženje kroz spise, spori pripravnici, poverljivost |
| Baza znanja | Svaki advokat ima samo svoje dokumente, kao sada (bez novog razvoja) |
| Demo | Sastanak sa demonstracijom uživo |
| Zaštita | Bez NDA-a („verujem im”) |
| Pilot | Aplikaciju već koristi jedna pripravnica |
| Spremnost | Pokazuje se odmah, u trenutnom stanju |
| Cena, naplata, troškovi | „Predloži” (predlog je ispod) |

## 1. Šta aplikacija rešava

**Rečenica za pamćenje:** *„Paragraf zna zakone. Ova aplikacija zna vaše predmete.”*

| Ko | Problem | Šta dobija |
|---|---|---|
| **Vlasnik kancelarije** (on odlučuje i plaća) | Ne sme da dozvoli da spisi klijenata završe u ChatGPT-u. Ne zna ko je šta radio sa dokumentima. | Svaki advokat vidi samo svoje dokumente (to čuva baza). Vlasnik poziva i blokira naloge, postavlja limite i vidi dnevnik aktivnosti sa CSV izvozom. Admin ima obavezan MFA. |
| **Advokat** | Satima lista ugovore, presude i spise da nađe jednu odredbu ili rok. | Pita na srpskom i za nekoliko sekundi dobije odgovor sa nazivom dokumenta iz kog odgovor potiče. |
| **Pripravnik** | Sporo istražuje, a stariji kolege mu stalno objašnjavaju. | Sam pronalazi odredbe, rokove i stavove u spisima. Na sudu ili kod klijenta slika dokument telefonom i pita. |

## 2. Konkurencija i pozicija

| | Paragraf AI / Lex AI | ChatGPT i slični | Ova aplikacija |
|---|---|---|---|
| Nad čim radi | Paragraf baza (zakoni, sudska praksa, mišljenja, preko 500.000 dokumenata) | Opšte znanje i ono što korisnik zalepi | **Sopstveni spisi, ugovori i presude** kancelarije |
| Otpremanje sopstvenih dokumenata | Na njihovim stranicama se ne pominje | Da, ali bez kontrole kancelarije | Da, PDF, Word i slike sa telefona |
| Poverljivost i kontrola | Na stranicama ponude nije opisana | Kancelarija nema nikakvu kontrolu | Izolacija po advokatu, dnevnik aktivnosti, MFA, admin panel |
| Cena | Oko 85 do 155 RSD po pitanju (krediti, npr. 10.000 RSD za 100 pitanja, odnosno 12.900 do 18.500 RSD za 120) | Pretplata po osobi | Mesečni paušal po kancelariji (ispod) |

Paragraf nije neprijatelj, nego dokaz da su advokati u Srbiji već naučili da plaćaju AI. Kancelarija zadržava Paragraf za zakone, a ovu aplikaciju koristi za svoje predmete.

## 3. Cene i troškovi

**Troškovi:**
- **Claude** (`claude-sonnet-5`): $2 za milion ulaznih i $10 za milion izlaznih tokena. Pitanje troši oko 10.000 tokena, pa je to **oko 3 US centa (3 do 4 RSD) po pitanju**. Pri 10 pitanja dnevno, advokat mesečno košta **oko 6 €**.
- **Voyage** (`voyage-law-2`): $0.12 za milion tokena. PDF od 18 pasusa je imao 7.436 tokena, što je ispod 0,1 centa.
- **Server** (poseban sistem za svaku kancelariju, Faza 4): Supabase Pro je oko $25 mesečno, a Vercel Pro oko $20 po članu tima. Računati **oko 45 € mesečno po kancelariji** i proveriti pre prvog ugovora.

**Cenovnik za kancelarije (bez PDV-a; fakturiše agencija):**

| Paket | Naloga | Mesečno | Uključeno |
|---|---|---|---|
| Start | do 5 | **149 €** | Do 300 pitanja po advokatu mesečno |
| Kancelarija | do 10 | **249 €** | Isto |
| Plus | do 20 | **399 €** | Isto, plus prioritetna podrška |
| Podešavanje (jednokratno) | | **390 €** | Poseban sistem za kancelariju, prvi admin, obuka od 1 h |

- Godišnje plaćanje unapred: 2 meseca gratis.
- **Osnivačka ponuda za prve 3 kancelarije:** bez naknade za podešavanje i 50% popusta prva 3 meseca, u zamenu za izjavu ili preporuku.
- Limit od „300 pitanja” podešava se **postojećim** limitima (`DAILY_MESSAGE_LIMIT`, `MONTHLY_TOKEN_BUDGET` u env-u i `office_settings` u admin panelu, logika u `lib/usage.ts` → `effectiveLimits`). Trenutni podrazumevani mesečni budžet (20 miliona tokena po advokatu) je previsok za paušal i za svaku kancelariju se spušta u skladu sa paketom.

**Računica za paket „Kancelarija” (10 advokata, 249 €):** server ~45 € + AI ~60 € (pri 10 pitanja dnevno; najviše ~78 € na limitu) = ~105 € troškova. **Neto ~145 €: vlasniku ~87 €, agenciji ~58 € mesečno po kancelariji.**

**Novac:** kancelarija plaća agenciji. Servise (Anthropic, Voyage, Supabase, Vercel) plaća vlasnik sa svojih naloga. Agencija mu svakog meseca vraća stvarne troškove i isplaćuje 60% neto, uz izveštaj. Za način primanja ponavljajućeg prihoda vlasnik proverava kod knjigovođe; ovo nije pravni ni poreski savet.

## 4. Partnerstvo: ko šta radi

| Agencija | Vlasnik |
|---|---|
| Marketing (kampanje, sajt, LinkedIn, webinari) | Podizanje sistema za svaku kancelariju (Faza 4) |
| Pronalaženje kancelarija, demonstracije, ugovori, fakturisanje | Druga linija podrške: greške, limiti, nalozi u bazi |
| Prva podrška po priručniku | Razvoj, bezbednost, održavanje i novi zahtevi |
| Dodatna prodaja: svaka kancelarija je i potencijalni klijent za sajt i marketing | Mesečni izveštaj o radu sistema |

## 5. Tačke ugovora o partnerstvu (konkretan tekst piše advokat)

1. **Predmet:** agencija dobija pravo da prodaje uslugu u Srbiji. Kod i prava ostaju vlasnikovi, agencija ne dobija kod i ne pravi sopstvenu kopiju ni konkurentski proizvod dok traje ugovor i N meseci posle.
2. **Ekskluziva:** predlog je ekskluziva za Srbiju 6 meseci, uslovljena minimumom (npr. 3 kancelarije).
3. **Ime proizvoda:** odlučuje se na sastanku (vidi `docs/plan-agencija.md`, odeljak 3).
4. **Cene:** agencija ne prodaje ispod dogovorenog minimuma bez saglasnosti.
5. **Podela:** 60/40 od neta (posle stvarnih troškova servisa), obračun mesečno, rok za isplatu, mesečni izveštaj i pravo uvida. Ugovor određuje i ko snosi rizik ako kancelarija ne plati.
6. **Podrška:** prvu liniju drži agencija, drugu vlasnik, sa realnim rokovima odgovora.
7. **Podaci i odgovornost:** ugovor o obradi podataka sa kancelarijom, postupak pri incidentu i odricanje „AI ne daje pravni savet, advokat proverava”.
8. **Trajanje i izlaz:** otkazni rok i šta biva sa postojećim kancelarijama ako se partnerstvo raskine.
9. **Razvoj:** posebni zahtevi kancelarija naplaćuju se posebno.
10. **Opcija otkupa koda:** agencija ima pravo prvenstva da kasnije otkupi kod po unapred dogovorenoj formuli.

## 6. Rizici

- **Demonstracija pukne uživo:** proba dan ranije i snimak kao rezerva.
- **Faza 4 nije gotova kad agencija nađe prvu kancelariju:** dok nije gotova, ne prodaje se kancelarija bez pilota.
- **Kancelarija pita za prenos podataka u SAD i advokatsku tajnu:** list o odgovornosti i podacima, pregled tokova podataka (Faza 4). Pre ugovora sa kancelarijom proveriti sa pravnikom šta traži ZZPL.
- **Agencija zarađuje premalo da bi se trudila:** osnivačka ponuda, dodatna prodaja sajtova i jasna računica.
- **Sva tehnička podrška zavisi od jednog čoveka:** priručnik za prvu podršku i realni rokovi u ugovoru.
- **Paragraf doda otpremanje sopstvenih dokumenata:** brzina i fokus na poverljivost i kontrolu kancelarije.

## Izvori

- Claude cene: claude-api skill (cache 2026-10-06)
- [Voyage cenovnik](https://docs.voyageai.com/docs/pricing)
- [Paragraf AI asistent](https://www.paragraf.rs/paragraf-ai-kancelarko/ai-asistent-pravni-konsultant-kancelarko.html) i [Lex AI](https://www.paragraf.rs/marketplace-ai/prozone/Lex-ai-asistent-pravni-konsultant.html)
- Supabase i Vercel: [makerkit](https://makerkit.dev/blog/saas/supabase-pricing), [costbench](https://costbench.com/software/developer-tools/vercel/) (proveriti na zvaničnim stranicama)
