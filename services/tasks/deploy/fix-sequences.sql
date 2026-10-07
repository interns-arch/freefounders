-- Re-sync every identity/serial sequence to its table's current maximum.
--
-- Needed after any pg_restore: pg_dump only emits setval() for sequences that
-- were actually advanced in the source, so a table whose rows were seeded with
-- explicit ids comes back with its sequence at zero and the very next insert
-- collides on the primary key. Only sequences that sit at or below their
-- table max are touched, so this never rewinds a healthy one and is safe to
-- run repeatedly.
do $$
declare r record; mx bigint; sv bigint; fixed int := 0; tot int := 0;
begin
  for r in
    select t.relname as tbl, a.attname as col, s.relname as seq
    from pg_depend d
    join pg_class s on s.oid = d.objid and s.relkind = 'S'
    join pg_class t on t.oid = d.refobjid
    join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
    where d.classid = 'pg_class'::regclass
      and d.refclassid = 'pg_class'::regclass
      and t.relnamespace = 'public'::regnamespace
  loop
    tot := tot + 1;
    execute format('select coalesce(max(%I),0) from public.%I', r.col, r.tbl) into mx;
    execute format('select pg_sequence_last_value(%L)', 'public.' || r.seq) into sv;
    if mx > 0 and (sv is null or sv < mx) then
      -- is_called=true so the NEXT value is mx+1, never mx itself
      execute format('select setval(%L, %s, true)', 'public.' || r.seq, mx);
      raise notice 'fixed %.% -> next id %', r.tbl, r.col, mx + 1;
      fixed := fixed + 1;
    end if;
  end loop;
  raise notice '% sequences checked, % corrected', tot, fixed;
end $$;
