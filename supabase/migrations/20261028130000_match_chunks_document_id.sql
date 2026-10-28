-- FAZA 2.3: match_document_chunks vraća i document_id, da audit log (question_asked) može da zapiše
-- KOJI su dokumenti korišćeni kao izvori ("ko je pročitao koji dokument"), a ne samo njihove nazive
-- (naziv nije jedinstven).
--
-- Menja se samo skup povratnih kolona: document_id se dodaje ispred postojećih. Telo, bezbednosna
-- svojstva (security invoker, RLS preko auth.uid()) i grantovi ostaju isti kao u Fazi 1. Kod koji čita
-- document_title i content radi i pre i posle migracije, pa se migracija primenjuje PRE deploy-a.
-- Sve ili ništa: ako bilo koji korak padne, baza ostaje netaknuta.
begin;

-- Povratni tip se ne može menjati preko create or replace, pa se funkcija ukida i pravi ponovo.
do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
           where proname = 'match_document_chunks' and pronamespace = 'public'::regnamespace
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

create function public.match_document_chunks(
  query_embedding vector(1024),
  match_count integer default 8
)
returns table (document_id uuid, document_title text, content text, similarity double precision)
language sql
stable
security invoker
set search_path = public, extensions
-- pgvector 0.8.x: bez ovoga HNSW + filter po user_id može da vrati manje od match_count redova.
set hnsw.iterative_scan = 'strict_order'
as $$
  select d.id,
         d.title::text,
         c.content::text,
         1 - (c.embedding <=> query_embedding)
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.user_id = (select auth.uid())
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

-- Ukidanjem funkcije nestaju i grantovi: ponovo isti kao u Fazi 1 (anon nema ništa).
revoke execute on function public.match_document_chunks(vector, integer) from public, anon, authenticated;
grant execute on function public.match_document_chunks(vector, integer) to authenticated;

commit;
