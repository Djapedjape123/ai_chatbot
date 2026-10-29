// Namerne greške (mutacije) u migraciji 2.5.11: svaka kvari jedan izraz u MEMORIJI (fajl na disku se ne dira), primenjuje
// pokvarenu migraciju na bazu koja je u stanju PRE nje i pušta svih pet SQL testova. Mutacija je "uhvaćena" ako bar
// jedan test padne. Kontrola: neizmenjena migracija mora da prođe svih pet.
//
//   node tools/verify/mutations-sql-2-5-11.mjs          # sve mutacije
//   node tools/verify/mutations-sql-2-5-11.mjs --only=M07
//
// Kod izlaza je 1 ako je neka mutacija preživela (svi testovi prošli) ili migracija nije mogla da se primeni.
import { applyBaseline, applyMigrations, createDb, listMigrations, runAllTests, snapshot } from './lib/pglite-db.mjs';

const NAME = '20261029110000_phase2511_hard_rls.sql';
const BEFORE = '20261029100000';
const original = listMigrations().find((m) => m.name === NAME)?.sql;
if (!original) throw new Error(`nema migracije ${NAME}`);

const GATE = 'as restrictive for all to authenticated\n  using ((select private.mfa_satisfied()) and (select private.account_active()));';

// [oznaka, opis, staro, novo]; staro mora da postoji tačno u migraciji (inače je greška u mutaciji, ne u kodu).
const mutations = [
  // --- private.mfa_satisfied()
  ['M01', "aal1 umesto aal2", "= 'aal2'", "= 'aal1'"],
  ['M02', 'uslov aal2 uklonjen (uvek tačno)', "coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'", 'true'],
  ['M03', 'nalog bez faktora gubi pristup (uslov "nema faktora" uklonjen)', "and f.status = 'verified'));", 'and false));'],
  ['M04', 'nepotvrđen faktor se računa kao faktor', "f.status = 'verified'", 'f.status is not null'],
  ['M05', 'obrnut uslov faktora (not exists -> exists)', 'or not exists (select 1 from auth.mfa_factors f', 'or exists (select 1 from auth.mfa_factors f'],
  ['M06', 'tuđ faktor se računa (bez f.user_id)', "where f.user_id = (select auth.uid()) and f.status = 'verified'", "where f.status = 'verified'"],
  ['M07', 'bez provere da je korisnik prijavljen', 'select (select auth.uid()) is not null\n     and (coalesce(', 'select (coalesce('],
  // --- private.account_active()
  ['M08', 'banned_until se ne proverava', '(u.banned_until is null or u.banned_until <= now())', 'true'],
  ['M09', 'banned_until obrnut (>= umesto <=)', 'u.banned_until <= now())', 'u.banned_until >= now())'],
  ['M10', 'disabled_at se ne proverava', 'p.disabled_at is not null', 'false'],
  ['M11', 'obrnut uslov profila (not exists -> exists)', 'and not exists (select 1 from public.profiles p', 'and exists (select 1 from public.profiles p'],
  ['M12', 'bilo koji nalog u auth.users (bez u.id = uid)', 'where u.id = (select auth.uid())\n                   and (u.banned', 'where true\n                   and (u.banned'],
  // --- restriktivne polise
  ['M13', 'documents: permissive umesto restrictive', 'create policy documents_hard_gate on public.documents\n  as restrictive', 'create policy documents_hard_gate on public.documents\n  as permissive'],
  ['M14', 'audit_log: polisa izostavljena', `create policy audit_log_hard_gate on public.audit_log\n  ${GATE}`, ''],
  ['M15', 'documents: for select umesto for all', 'create policy documents_hard_gate on public.documents\n  as restrictive for all', 'create policy documents_hard_gate on public.documents\n  as restrictive for select'],
  ['M16', 'messages: for select umesto for all', 'create policy messages_hard_gate on public.messages\n  as restrictive for all', 'create policy messages_hard_gate on public.messages\n  as restrictive for select'],
  ['M17', 'chats: bez uslova blokade', `create policy chats_hard_gate on public.chats\n  ${GATE}`, 'create policy chats_hard_gate on public.chats\n  as restrictive for all to authenticated\n  using ((select private.mfa_satisfied()));'],
  ['M18', 'usage_ledger: bez uslova aal2', `create policy usage_ledger_hard_gate on public.usage_ledger\n  ${GATE}`, 'create policy usage_ledger_hard_gate on public.usage_ledger\n  as restrictive for all to authenticated\n  using ((select private.account_active()));'],
  ['M19', 'document_chunks: za public umesto authenticated', 'create policy document_chunks_hard_gate on public.document_chunks\n  as restrictive for all to authenticated', 'create policy document_chunks_hard_gate on public.document_chunks\n  as restrictive for all to public'],
  ['M20', 'dodatna restriktivna polisa na profiles', `create policy audit_log_hard_gate on public.audit_log\n  ${GATE}`, `create policy audit_log_hard_gate on public.audit_log\n  ${GATE}\ncreate policy profiles_hard_gate on public.profiles\n  as restrictive for all to authenticated\n  using ((select private.account_active()));`],
  ['M21', 'documents: poziv funkcija bez (select ...)', `create policy documents_hard_gate on public.documents\n  ${GATE}`, 'create policy documents_hard_gate on public.documents\n  as restrictive for all to authenticated\n  using (private.mfa_satisfied() and private.account_active());'],
  ['M22', 'document_chunks: polisa izostavljena', `create policy document_chunks_hard_gate on public.document_chunks\n  ${GATE}`, ''],
  // --- svojstva funkcija
  ['M23', 'mfa_satisfied: security invoker', 'security definer\nset search_path = \'\'\nas $$\n  select (select auth.uid()) is not null', 'security invoker\nset search_path = \'\'\nas $$\n  select (select auth.uid()) is not null'],
  ['M24', 'mfa_satisfied: bez set search_path', 'set search_path = \'\'\nas $$\n  select (select auth.uid()) is not null', 'as $$\n  select (select auth.uid()) is not null'],
  ['M25', 'mfa_satisfied: execute i za anon', 'grant  execute on function private.account_active() to authenticated;', 'grant  execute on function private.account_active() to authenticated;\ngrant  execute on function private.mfa_satisfied() to anon;'],
  ['M26', 'account_active: volatile', 'stable\nsecurity definer\nset search_path = \'\'\nas $$\n  select exists (select 1 from auth.users u', 'volatile\nsecurity definer\nset search_path = \'\'\nas $$\n  select exists (select 1 from auth.users u'],
  ['M27', 'account_active: authenticated nema execute', 'grant  execute on function private.account_active() to authenticated;', ''],
  // EKVIVALENTNA: authenticated nema EXECUTE ni bez ove naredbe, jer podrazumevane privilegije iz Faze 1 (alter default
  // privileges ... revoke execute on functions) već skidaju pravo funkcijama; revoke je dodatni pojas. Test svojstvo
  // (authenticated ne sme da izvrši okidačku funkciju) proverava direktno, i ono važi i u mutiranoj bazi.
  ['M28', 'okidačka funkcija: revoke od authenticated izostavljen', 'revoke execute on function private.audit_mfa_removed() from public, anon, authenticated;', 'revoke execute on function private.audit_mfa_removed() from public, anon;', true],
  // --- lista akcija
  ['M29', "mfa_removed izostavljen iz liste akcija", "'mfa_enrolled', 'mfa_removed'));", "'mfa_enrolled'));"],
  // --- okidač
  ['M30', 'okidač: AFTER UPDATE OR DELETE', 'after delete on auth.mfa_factors', 'after update or delete on auth.mfa_factors'],
  ['M31', 'okidač: for each statement', 'for each row\n  execute function private.audit_mfa_removed();', 'for each statement\n  execute function private.audit_mfa_removed();'],
  ['M32', 'okidač beleži i nepotvrđene faktore', "if old.status::text = 'verified'\n     and exists", 'if exists'],
  ['M33', 'okidač bez provere da nalog postoji', 'and exists (select 1 from auth.users u where u.id = old.user_id) then', 'then'],
  ['M34', 'okidač: greška upisa zaustavlja uklanjanje (fail-closed)', "raise warning 'audit mfa_removed nije upisan: %', sqlerrm;", 'raise;'],
  ['M35', 'okidač: pogrešna akcija (mfa_enrolled)', "'mfa_removed', 'user', old.user_id,", "'mfa_enrolled', 'user', old.user_id,"],
  ['M36', 'okidač: u metadata ulazi i ID faktora', "jsonb_build_object('factor_type', old.factor_type::text, 'status', old.status::text)", "jsonb_build_object('factor_type', old.factor_type::text, 'status', old.status::text, 'factor_id', old.id)"],
  ['M37', 'okidač: resource_id je NULL', "'mfa_removed', 'user', old.user_id,", "'mfa_removed', 'user', null,"],
  ['M38', 'okidač: funkcija security invoker', 'returns trigger\nlanguage plpgsql\nsecurity definer', 'returns trigger\nlanguage plpgsql\nsecurity invoker'],
  ['M39', 'okidač: actor_email nije upisan', "(select u.email::text from auth.users u where u.id = old.user_id),\n              'mfa_removed'", "null,\n              'mfa_removed'"],
];

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

console.log('osnova + migracije do 2.5.6, snimak stanja...');
const base = await createDb();
await applyBaseline(base);
await applyMigrations(base, { upto: BEFORE });
const blob = await snapshot(base);
await base.close();

async function run(sql) {
  const db = await createDb(blob);
  try {
    try {
      await applyMigrations(db, { only: [NAME], overrides: { [NAME]: sql } });
    } catch (e) {
      return { applied: false, message: e.message.split('\n')[0] };
    }
    return { applied: true, results: await runAllTests(db) };
  } finally {
    await db.close();
  }
}

let bad = 0;
const control = await run(original);
if (!control.applied || control.results.some((r) => !r.ok)) {
  console.log('FAIL kontrola (neizmenjena migracija):', control.applied ? control.results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.message}`).join(' | ') : control.message);
  process.exit(1);
}
console.log(`ok   kontrola: neizmenjena migracija prolazi svih ${control.results.length} testova`);

for (const [id, label, from, to, equivalent] of mutations) {
  if (only && id !== only) continue;
  if (!original.includes(from)) {
    console.log(`FAIL ${id} ${label}: tekst za zamenu ne postoji u migraciji (greška u mutaciji)`);
    bad++;
    continue;
  }
  const mutated = original.replace(from, () => to);
  const r = await run(mutated);
  if (!r.applied) {
    console.log(`PUKLA ${id} ${label}: migracija se ne primenjuje (${r.message.slice(0, 140)})`);
    bad++;
    continue;
  }
  const failed = r.results.filter((x) => !x.ok);
  if (failed.length === 0 && equivalent) {
    console.log(`ekv. ${id} ${label}: preživela, ali je ekvivalentna (vidi komentar uz mutaciju)`);
  } else if (failed.length === 0) {
    console.log(`PREŽIVELA ${id} ${label}: svih ${r.results.length} testova je prošlo`);
    bad++;
  } else {
    console.log(`ok   ${id} ${label} => ${failed[0].name.replace('_test.sql', '')}: ${failed[0].message.slice(0, 110)}`);
  }
}
console.log(bad === 0 ? 'sve mutacije uhvaćene' : `${bad} mutacija nije uhvaćeno ili se ne primenjuje`);
process.exit(bad ? 1 : 0);
