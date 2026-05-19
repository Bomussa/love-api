-- Verification script: anon must not perform DML on public.doctors.
-- Run after migrations:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/doctors_anon_dml_blocked.sql

begin;

set local role anon;

-- INSERT should fail.
do $$
begin
  begin
    insert into public.doctors (name, username, password)
    values ('anon-test', 'anon_test_blocked', 'x');
    raise exception 'SECURITY REGRESSION: anon INSERT on public.doctors succeeded unexpectedly';
  exception
    when insufficient_privilege then
      null;
    when others then
      if position('row-level security' in lower(sqlerrm)) > 0 then
        null;
      else
        raise;
      end if;
  end;
end $$;

-- UPDATE should fail.
do $$
begin
  begin
    update public.doctors set name = 'tampered-by-anon' where true;
    raise exception 'SECURITY REGRESSION: anon UPDATE on public.doctors succeeded unexpectedly';
  exception
    when insufficient_privilege then
      null;
    when others then
      if position('row-level security' in lower(sqlerrm)) > 0 then
        null;
      else
        raise;
      end if;
  end;
end $$;

-- DELETE should fail.
do $$
begin
  begin
    delete from public.doctors where true;
    raise exception 'SECURITY REGRESSION: anon DELETE on public.doctors succeeded unexpectedly';
  exception
    when insufficient_privilege then
      null;
    when others then
      if position('row-level security' in lower(sqlerrm)) > 0 then
        null;
      else
        raise;
      end if;
  end;
end $$;

rollback;
