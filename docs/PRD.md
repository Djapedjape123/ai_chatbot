# Product Requirements Document (PRD) - Pravni Asistent

## 1. Project Overview
Pravni Asistent je RAG (Retrieval-Augmented Generation) web aplikacija dizajnirana za advokatske pripravnike. Aplikacija omogućava korisniku da postavlja složena pravna pitanja nad sopstvenom bazom znanja (20+ pravnih knjiga i skripti) i dobija visoko-detaljne, tačne odgovore sa citiranim članovima zakona.

## 2. Primary Goal
Napraviti brz, pouzdan i elegantan alat koji pretražuje specifičnu pravnu literaturu i eliminiše "halucinacije" standardnih AI modela, sa vizuelnim identitetom koji podseća na klasičnu pravnu literaturu.

## 3. Core Features in Scope

### 3.1 Upravljanje dokumentima (Ingestion)
- Korisnik može direktno kroz chat interfejs da otpremi PDF/Word dokumente.
- Sistem automatski procesira dokumente, deli ih na logične celine (chunks) i smešta u vektorsku bazu.

### 3.2 Chat Interfejs
- Prikaz istorije chatova u levom bočnom panelu (Sidebar).
- Unos pitanja sa ponašanjem: `Enter` pravi novi red, klik na dugme šalje poruku.
- Tokom generisanja odgovora prikazuje se vizuelni indikator učitavanja (nema kucanja slovo-po-slovo / streaminga).
- Odgovor se prikazuje u celosti odjednom.
- Ispod svake AI poruke nalazi se dugme "Kopiraj tekst".

### 3.3 AI Ponašanje i Logika
- **Ton:** Kolegijalan, asistentkinjski i visoko detaljan.
- Ako informacija ne postoji u literaturi, AI koristi svoje opšte pravno znanje uz jasnu napomenu.
- Fiksno upozorenje na dnu ekrana o mogućim AI greškama (halucinacijama).

### 3.4 UI/UX Pravila
- **Tema:** Elegantna (krem pozadina, teget detalji).
- **Tipografija:** Serifni fontovi za odgovore (podseća na pravne knjige).
- Obaveštenja o greškama na mreži prikazuju se kao crvene `toast` notifikacije.

## 4. Out of Scope (Trenutno)
- Sistem naplate (Stripe) i višestruki korisnički nalozi (Auth), ali se arhitektura postavlja tako da ovo lako može postati SaaS u budućnosti.