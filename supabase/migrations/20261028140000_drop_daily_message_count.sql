-- FAZA 2 (zatvaranje): uklanja stari brojač poruka get_daily_message_count(uuid).
--
-- Brojač je radio nad tabelom messages, pa je korisnik koji obriše razgovor resetovao svoj dnevni limit
-- (nalaz iz revizije Faze 1). Zamenio ga je usage ledger (reserve_usage / close_usage, migracija
-- 20261028120000), a kod ga više ne poziva (lib/check-rate-limit.ts je obrisan u 2.3).
--
-- NE PRIMENJIVATI dok novi kod (2.3 i novije) nije u produkciji: stari kod i dalje poziva ovu funkciju,
-- pa bi chat prestao da radi. Provera pre primene: u Vercel produkciji je deploy sa commit-om e694a6d
-- ili novijim, a u Supabase-u su primenjene migracije 20261028120000 i 20261028130000.
--
-- Briše se svaki potpis funkcije, bez CASCADE: ako nešto od nje zavisi (pogled, polisa, drugi objekat),
-- migracija puca i ništa se ne menja. Sve ili ništa.
begin;

do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
           where proname = 'get_daily_message_count' and pronamespace = 'public'::regnamespace
  loop
    execute format('drop function %s', r.sig);
  end loop;

  if exists (select 1 from pg_proc
             where proname = 'get_daily_message_count' and pronamespace = 'public'::regnamespace) then
    raise exception 'get_daily_message_count i dalje postoji posle brisanja';
  end if;
end $$;

commit;
