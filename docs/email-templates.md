# Email šabloni (Supabase Dashboard → Authentication → Email Templates)

Radi vlasnik projekta. **Redosled je bitan: prvo deploy koda iz 2.5.4 na produkciju, TEK ONDA menjaš šablone.** Novi linkovi vode na `/auth/confirm`, koje do tada ne postoji, pa bi reset lozinke prestao da radi.

Preduslovi (`docs/next-steps.md`, odeljak B): Site URL i Redirect URLs (B3) i sopstveni SMTP (B4). Sa podrazumevanim SMTP-om Supabase šalje samo članovima tvoje Supabase organizacije (greška `email_address_not_authorized`), pa pozivnica na tuđu adresu ne stiže.

Promenljive `{{ .SiteURL }}` i `{{ .TokenHash }}` su Supabase-ove i ostaju tačno ovako. Ne dodaj `{{ .ConfirmationURL }}`: taj link ide drugim tokom (PKCE) i ne radi kad se mejl otvori u drugom pregledaču ili na drugom uređaju, a pozvan advokat upravo to radi.

## 1. „Invite user" (pozivnica)

**Subject:** `Poziv u Pravni asistent`

**Message body (HTML):**

```html
<h2>Poziv u Pravni asistent</h2>
<p>Administrator vaše kancelarije otvorio vam je nalog.</p>
<p>Da biste postavili lozinku i prijavili se, otvorite link:</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/set-password">Postavite lozinku</a></p>
<p>Link važi kratko i može se upotrebiti samo jednom. Ako je istekao, zatražite novi poziv od administratora.</p>
<p>Ako ne očekujete ovaj poziv, slobodno ignorišite poruku.</p>
```

## 2. „Reset password" (zaboravljena lozinka)

**Subject:** `Reset lozinke`

**Message body (HTML):**

```html
<h2>Reset lozinke</h2>
<p>Zatražena je promena lozinke za vaš nalog.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Izaberite novu lozinku</a></p>
<p>Link važi kratko i može se upotrebiti samo jednom. Ako nalog ima dvostepenu prijavu, biće potreban i kod iz aplikacije za autentifikaciju.</p>
<p>Ako promenu niste tražili vi, ignorišite poruku: lozinka ostaje ista.</p>
```

## Provera posle izmene

1. **Reset:** `/forgot-password` → mejl stiže → link otvara „Nova lozinka" (traži najmanje 12 znakova) → posle čuvanja si u `/chat`.
2. **Poziv:** `/admin/users` → forma za poziv, **na adresu koja još nema nalog** → link otvara „Postavite lozinku" → posle čuvanja si u `/chat`. U SQL Editoru: `select email, role from public.profiles where email = '…';` mora da vrati red sa ulogom `lawyer`. Pre izmene šablona jedan probni poziv (2026-10-29) je otvoren preko podrazumevanog Supabase linka. Taj nalog je potvrđen, ali nema lozinku, pa „Pošalji ponovo" za njega ne radi. Za probu uzmi novu adresu, a taj nalog blokiraj ili mu postavi lozinku preko `/forgot-password`.
3. **Isti link drugi put:** mora da otvori „Link nije važeći" (jednokratan je).

## Poznati rizik: mejl skeneri

Neki mejl sistemi (npr. Microsoft Defender „Safe Links" u Microsoft 365, česti u kancelarijama) otvaraju linkove iz mejla pre korisnika, čime se jednokratni link potroši, pa advokat vidi „Link nije važeći" iako ga nikad nije otvorio. Ako se to desi u pilotu, rešenje je da `/auth/confirm` prvo prikaže stranicu sa dugmetom „Nastavi", a da `verifyOtp` radi tek posle klika (skeneri ne klikću). **Adresa linka se time ne menja, pa se šabloni ne diraju.** Nije rađeno dok se problem ne pojavi.
