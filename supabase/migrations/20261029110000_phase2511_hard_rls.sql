-- FAZA 2.5.11: tvrdi RLS u bazi (aal2 za naloge sa MFA, blokiran nalog) i audit uklanjanja MFA faktora.
-- Sve ili ništa: ako bilo koji korak padne, baza ostaje netaknuta.
--
-- Zašto: MFA i blokada su do sada čuvani samo u aplikaciji (proxy.ts, requireUser). Javni anon ključ i lozinka
-- ukradenog naloga daju Supabase sesiju bez koda (aal1) koja preko REST API-ja čita sve što RLS dozvoljava tom
-- nalogu, a blokiran nalog sa još važećim tokenom (do 1 sat) čita svoje redove do isteka tokena
-- (docs/next-steps.md, C6 i C8). Uklanjanje MFA faktora nije ostavljalo nikakav trag (C7).
--
-- Migracija SAMO DODAJE: dve pomoćne funkcije, jednu okidačku funkciju, šest restriktivnih polisa, jedan okidač i
-- jednu vrednost u listi akcija audit_log. NIJEDNA postojeća polisa se ne menja i ne briše. Restriktivna polisa se
-- uvek I-uje sa permissive polisama, pa nijedan red ne postaje vidljiviji nego pre.
--
-- Pravilo (varijanta (a), odluka vlasnika 2026-10-29: MFA ostaje opcion za advokate):
--   * nalog koji ima POTVRĐEN faktor vidi podatke samo sa tokenom aal2; nalog bez potvrđenog faktora radi kao pre;
--   * nalog sa profiles.disabled_at ili sa aktivnim auth.users.banned_until ne vidi ništa, ni sa važećim aal2.
--
-- NAMERNO BEZ restriktivne polise na public.profiles: requireUser() po profilu otkriva blokadu i ulogu, a "profil
-- se ne vidi" tumači kao "nalog nema profil, nije blokiran". Uslov "nije blokiran" na profilu bi sakrio disabled_at
-- od blokiranog naloga i blokada bi PROŠLA u aplikaciji; uslov aal2 bi sakrio ulogu adminu sa faktorom a bez koda.
-- Profil ima samo ime, e-mail, ulogu i oznaku blokade. public.office_settings (limiti) takođe ostaje kakav je.
--
-- Pokrivenost: match_document_chunks i get_usage_summary su security invoker, pa važe bez izmene. service_role zaobilazi
-- RLS (upisi servera se ne menjaju), a admin_* funkcije su security definer sa sopstvenom proverom private.is_admin().
--
-- POVRATAK (ako zatreba): drop policy documents_hard_gate on public.documents (isto za document_chunks, chats,
-- messages, usage_ledger, audit_log); drop trigger on_mfa_factor_removed on auth.mfa_factors;
-- drop function private.audit_mfa_removed(), private.account_active(), private.mfa_satisfied();
-- lista akcija u audit_log_action_check može da ostane (pre vraćanja liste obrisati zapise mfa_removed).
begin;

-- 1. Pomoćne funkcije. Security definer jer authenticated NE sme da čita auth.mfa_factors ni auth.users;
--    prazan search_path; stable, da se u polisi izračunaju jednom po upitu (initPlan), ne po redu.
--    Ne primaju korisnika kao parametar: uvek auth.uid() iz tokena (trajno pravilo 4).

-- Tačno ako token ima aal2 ILI nalog nema nijedan POTVRĐEN faktor (nepotvrđen = uključivanje u toku).
-- Bez prijavljenog korisnika (auth.uid() je NULL) nikad ne važi.
create function private.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
          or not exists (select 1 from auth.mfa_factors f
                         where f.user_id = (select auth.uid()) and f.status = 'verified'));
$$;

-- Tačno ako nalog postoji, nema oznaku blokade u profilu i nije blokiran u Auth-u (banned_until u budućnosti).
-- Nalog bez profila (stariji nalozi) nije blokiran, kao u requireUser().
create function private.account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users u
                 where u.id = (select auth.uid())
                   and (u.banned_until is null or u.banned_until <= now()))
     and not exists (select 1 from public.profiles p
                     where p.id = (select auth.uid()) and p.disabled_at is not null);
$$;

revoke execute on function private.mfa_satisfied()  from public, anon;
revoke execute on function private.account_active() from public, anon;
-- Polisa se izvršava kao pozivalac, pa authenticated mora da sme da izvrši obe funkcije.
grant  execute on function private.mfa_satisfied()  to authenticated;
grant  execute on function private.account_active() to authenticated;

-- 2. Restriktivne polise na tabele sa korisničkim podacima i evidencijom (6 tabela, NE profiles).
create policy documents_hard_gate on public.documents
  as restrictive for all to authenticated
  using ((select private.mfa_satisfied()) and (select private.account_active()));

create policy document_chunks_hard_gate on public.document_chunks
  as restrictive for all to authenticated
  using ((select private.mfa_satisfied()) and (select private.account_active()));

create policy chats_hard_gate on public.chats
  as restrictive for all to authenticated
  using ((select private.mfa_satisfied()) and (select private.account_active()));

create policy messages_hard_gate on public.messages
  as restrictive for all to authenticated
  using ((select private.mfa_satisfied()) and (select private.account_active()));

create policy usage_ledger_hard_gate on public.usage_ledger
  as restrictive for all to authenticated
  using ((select private.mfa_satisfied()) and (select private.account_active()));

create policy audit_log_hard_gate on public.audit_log
  as restrictive for all to authenticated
  using ((select private.mfa_satisfied()) and (select private.account_active()));

-- 3. Audit: nova akcija mfa_removed. Postojeći zapisi i dalje prolaze (resource_type 'user' već postoji).
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in (
  'document_uploaded', 'document_upload_blocked', 'document_deleted',
  'chat_created', 'chat_deleted', 'question_asked',
  'limit_reached', 'suspicious_content_flagged',
  'user_invited', 'user_disabled', 'user_enabled', 'role_changed',
  'settings_changed', 'admin_viewed_user', 'audit_exported', 'mfa_enrolled', 'mfa_removed'));

-- 4. Okidač: brisanje POTVRĐENOG faktora ostavlja zapis mfa_removed (ko je izvršilac, baza ne zna: Auth server briše
--    faktor sopstvenom ulogom, bez JWT-a korisnika; vlasnik naloga je u user_id i resource_id).
--    * Nepotvrđen faktor (napuštena prijava) se ne beleži: to nije gašenje MFA, a bio bi šum.
--    * Brisanje naloga kaskadno briše faktore. Tada naloga više nema, a audit_log.user_id ima FK na auth.users, pa bi
--      upis oborio brisanje naloga: zapis se pravi samo ako nalog još postoji.
--    * Greška pri upisu NE sme da zaustavi brisanje faktora (izgubljen telefon = vlasnik uklanja faktor; promena šeme
--      Auth servisa ne sme da blokira upravljanje nalozima): upozorenje u logu, uklanjanje prolazi. Test u
--      supabase/tests/phase2511_hard_rls_test.sql to proverava i posle svake veće promene treba ponoviti.
create function private.audit_mfa_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status::text = 'verified'
     and exists (select 1 from auth.users u where u.id = old.user_id) then
    begin
      insert into public.audit_log (user_id, actor_email, action, resource_type, resource_id, metadata)
      values (old.user_id,
              (select u.email::text from auth.users u where u.id = old.user_id),
              'mfa_removed', 'user', old.user_id,
              jsonb_build_object('factor_type', old.factor_type::text, 'status', old.status::text));
    exception when others then
      raise warning 'audit mfa_removed nije upisan: %', sqlerrm;
    end;
  end if;
  return null;
end;
$$;

-- Okidačka funkcija se ne poziva direktno; EXECUTE se za okidač proverava samo pri CREATE TRIGGER.
revoke execute on function private.audit_mfa_removed() from public, anon, authenticated;

create trigger on_mfa_factor_removed
  after delete on auth.mfa_factors
  for each row
  execute function private.audit_mfa_removed();

commit;
