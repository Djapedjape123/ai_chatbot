# Tech Architecture & Stack

## 1. Core Stack
- **Framework:** Next.js (App Router) sa TypeScript-om.
- **Styling:** Tailwind CSS.
- **UI Components:** `shadcn/ui` (obavezno korišćenje postojećih komponenti iz biblioteke pre pisanja custom koda).

## 2. AI & Data Pipeline
- **Baza podataka:** Supabase (PostgreSQL). Čuva istoriju chatova, metapodatke dokumenata i same vektore.
- **Vector Engine:** Supabase `pgvector` ekstenzija.
- **Embedding Model:** Voyage AI (`voyage-law-2`). Specijalizovan za parsiranje i semantičko razumevanje pravnih tekstova (generiše vektore dimenzije 1024).
- **LLM (Mozak):** Anthropic Claude Sonnet 5. Zadužen za logičko rezonovanje i formiranje finalnog odgovora na osnovu izvučenog teksta.
- **Keširanje:** Vercel KV (Redis) za prepoznavanje ponovljenih upita i instant serviranje prethodno generisanih odgovora radi uštede API kredita.

## 3. RAG Workflow (Retrieval-Augmented Generation)

### Ingestion Flow (Dodavanje knjiga):
1. Fajl se otprema preko Next.js API rute.
2. Parsiranje i seckanje teksta (Chunking).
3. Slanje chunk-ova na Voyage AI API za dobijanje vektora.
4. Upis tekstualnih chunk-ova i vektora u Supabase `document_chunks` tabelu.

### Query Flow (Postavljanje pitanja):
1. Korisnik šalje upit. Next.js proverava Vercel KV za keširani odgovor.
2. Ako nema keša, upit se šalje u Voyage AI da se pretvori u vektor.
3. Vektor se upoređuje sa Supabase `pgvector` bazom (Similarity Search).
4. Top 5-10 najrelevantnijih chunk-ova se prosleđuje u Claude Sonnet 5 uz sistemski prompt.
5. Claude vraća formatiran odgovor koji se čuva u istoriji (Supabase), kešira (Vercel KV) i prikazuje korisniku.