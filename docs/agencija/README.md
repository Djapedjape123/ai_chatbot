# Materijali za agenciju

Plan: `docs/plan-agencija.md` (osnova: `docs/prodaja-plan.md`). Napravljeno 2026-11-06.

| # | Materijal | Gde | Za koga |
|---|---|---|---|
| A | Prezentacija za sastanak (19 slajdova, beleške za govornika, preuzima se kao PPTX ili PDF) | https://claude.ai/artifact/NfRh2cniTUWLHiVrcXziau, izvor u `prezentacija/project/` | Vlasnik agencije i prodavac |
| B + C | Vodič za prodavca: demo korak po korak, pitanja tokom demoa, odgovornost i podaci | https://claude.ai/artifact/FTG49epsgnZ8EUyUsdzU7B, izvor `vodic-za-prodavca.html` | Prodavac (B), vlasnik agencije (C) |
| D | Tačke pisma o namerama (Word, za advokata) | `D_Pismo_o_namerama_nacrt_tacaka.docx` | Obe strane i advokat |
| E | Demo podaci (4 izmišljena Word dokumenta + tačni odgovori) | `demo-podaci/` | Vlasnik, za demo naloge |

Obe stranice su privatne dok ih vlasnik ne podeli (meni Share na stranici).

**Pre slanja agenciji popuniti:** kontakt vlasnika u Vodiču za prodavca (deo „Ako nešto ne radi”) i polja `[ ]` u pismu o namerama.

**Pre sastanka (vlasnik):** napraviti demo naloge advokat 1 i advokat 2 i otpremiti 01 i 02 na nalog advokat 1 (`demo-podaci/README.md`), proći ceo scenario na produkciji i snimiti rezervni video. Ako su Word, PDF i kamera potvrđeni na produkciji (3.8 i 3.5.8), na slajdu „Iskreno: šta je gotovo” premestiti ih u prvu kolonu.

Svaka tvrdnja o aplikaciji je proverena u kodu: izvor uz svaki navod i napomena kad odgovor nije iz dokumenata (`lib/prompts.ts`), detekcija skrivenog uputstva (`lib/prompt-safety.ts`), originalni fajl se ne čuva (`lib/image-guards.test.ts`), admin vidi samo nazive i datume (Faza 2.5.6), dnevnik bez sadržaja, 90 dana (Faza 2.7). Demo dokumenti su propušteni kroz isti kod kao `/api/ingest`.
