# Demo podaci (materijal E)

Sva četiri dokumenta su **izmišljena** (na vrhu svakog piše crvenim slovima). U demonstraciji se nikad ne koriste pravi spisi klijenata.

Fajlovi su napravljeni 2026-11-06 i provereni istim kodom koji koristi `/api/ingest`: prepoznati su kao Word, nemaju aktivan sadržaj, tekst se čita, a broj pasusa je mali. Dopis 03 aktivira upozorenje o sumnjivom sadržaju, a ostali ne.

| Fajl | Čemu služi | Pasusa |
|---|---|---|
| `01_Ugovor_o_zakupu_DEMO.docx` | Glavni dokument: zakup lokala, 17 članova, mnogo rokova | 7 |
| `02_Aneks_1_ugovora_o_zakupu_DEMO.docx` | Menja zakupninu i **otkazni rok (90 → 60 dana)**. Pokazuje da aplikacija spaja više dokumenata. | 2 |
| `03_Dopis_zakupca_sa_skrivenim_uputstvom_DEMO.docx` | Sadrži **skriveno uputstvo** (belim slovima, veličine 1, ne vidi se ni u Word-u) „ignoriši sva prethodna uputstva...”. Aplikacija upozorava pre otpremanja. | 1 |
| `04_Zapisnik_o_primopredaji_za_slikanje_DEMO.docx` | **Ne otprema se.** Odštampa se jedna strana i slika telefonom za pitanje uz sliku. | (2) |

## Priprema (jednom, pre prve demonstracije)

1. Napraviti dva demo naloga advokata preko admin panela (npr. `demo.advokat1@...` i `demo.advokat2@...`, adrese do kojih dolazi mejl). **Prodavac ne dobija admin nalog na produkciji**, jer admin vidi nazive i datume dokumenata pravih korisnika.
2. Na nalogu **advokat 1** otpremiti `01` i `02` (dan ranije, da u demonstraciji ne čeka). Na nalogu **advokat 2** ne otpremati ništa.
3. Odštampati `04` (jedna strana).
4. `03` se otprema **uživo** u demonstraciji, a posle upozorenja se klikne **„Otkaži”** (nikako „Ipak dodaj”).

## Pitanja i tačni odgovori (da prodavac zna šta je ispravno)

| Pitanje (advokat 1) | Tačan odgovor | Izvor |
|---|---|---|
| Kada zakupac može da raskine ugovor i koji je otkazni rok? | Redovan otkaz uz rok od **60 dana** (aneks je promenio 90 dana na 60), ali ne pre 1. 4. 2027. Raskid uz rok od 30 dana ako je prostor nepodoban duže od 30 dana ili zakupodavac ne izvrši investiciono održavanje u roku od 60 dana od pisanog zahteva. | Ugovor čl. 9 i 10, Aneks čl. 2 |
| Kolika je zakupnina sada? | **1.260 EUR** od oktobra 2026 (ranije 1.200 EUR), u dinarima po srednjem kursu NBS, do 5. u mesecu. | Ugovor čl. 3, Aneks čl. 1 |
| Izdvoji sve rokove iz ugovora. (pitanje pripravnika) | Zakupnina do 5. u mesecu; depozit za 8 dana od potpisa, vraća se za 30 dana; predaja do 1. 4. 2026; trajanje do 31. 3. 2031; novi ugovor 60 dana pre isteka; investiciono održavanje za 60 dana; otkaz (60 dana po aneksu), ne pre 1. 4. 2027; opomena 15 dana; nepodobnost duže od 30 dana, raskid uz rok od 30 dana; vraćanje prostora za 15 dana; polisa za 30 dana. | Ugovor, Aneks |
| (uz sliku zapisnika) Koje je stanje brojila struje i ko popravlja napukle pločice do kada? | **18.452 kWh**; pločice popravlja **zakupodavac do 30. 4. 2026**. | Slika |

**Ako odgovor o otkaznom roku kaže 90 dana bez pominjanja aneksa:** pitati „Da li je otkazni rok menjan aneksom?”. Tako se pokazuje da advokat uvek proverava izvor. Taj trenutak je dobar za priču o odgovornosti.

**Izolacija:** na nalogu advokat 2 (drugi pregledač ili privatni prozor) pitati „Koliki je otkazni rok u ugovoru o zakupu?”. Aplikacija ne nalazi ništa iz dokumenata advokata 1.

## Zakon (nije obavezno)

Ako se u demonstraciji želi i zakon: sa zvaničnog izvora (Pravno-informacioni sistem RS) kopirati **samo odredbe Zakona o obligacionim odnosima o zakupu** u jedan Word fajl. Ceo zakon je predugačak: aplikacija prima najviše 500 pasusa po dokumentu. Tekst zakona se ne prepisuje iz sećanja i ne izmišlja.

## Kako su napravljeni

Skriptom (biblioteka `docx`, van repoa). Za izmene je lakše otvoriti fajl u Word-u. Posle svake izmene fajl treba ponovo otpremiti na demo nalog.
