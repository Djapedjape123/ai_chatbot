# Database Schema (Supabase)

Baza koristi PostgreSQL sa omogućenom `pgvector` ekstenzijom za semantičku pretragu.

## Ekstenzije
```sql
CREATE EXTENSION IF NOT EXISTS vector;
Tabele
1. documents

Čuva metapodatke o otpremljenim knjigama i skriptama.

    id (uuid, primary key)

    title (text, naziv dokumenta)

    created_at (timestamp, default now())

2. document_chunks

Čuva iseckane pasuse iz dokumenata i njihove vektore.

    id (uuid, primary key)

    document_id (uuid, foreign key na documents.id)

    content (text, stvarni tekst pasusa)

    embedding (vector(1024), Voyage AI voyage-law-2 vraća niz od 1024 brojeva)

    created_at (timestamp, default now())

3. chats

Upravlja sesijama razgovora za bočni panel (Sidebar).

    id (uuid, primary key)

    title (text, kratak naslov generisan na osnovu prvog pitanja)

    created_at (timestamp, default now())

    updated_at (timestamp, default now())

4. messages

Čuva pojedinačne poruke unutar svakog chata (Istorija poruka za kontekst).

    id (uuid, primary key)

    chat_id (uuid, foreign key na chats.id)

    role (text, vrednosti: 'user' ili 'assistant')

    content (text, tekst poruke)

    created_at (timestamp, default now())