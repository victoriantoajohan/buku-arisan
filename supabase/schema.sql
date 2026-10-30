-- Buku Arisan — skema Supabase
-- Jalankan sekali di Supabase Dashboard → SQL Editor → New query → Run.
--
-- Desain keamanan:
--  * Tabel `arisan` TIDAK bisa diakses langsung oleh anon key (RLS aktif tanpa policy).
--  * Semua akses lewat fungsi RPC (security definer):
--      - siapa pun yang punya link (UUID acak) bisa MELIHAT data,
--      - hanya yang tahu PIN bendahara bisa MENGUBAH.
--  * PIN disimpan sebagai hash bcrypt; 5x salah PIN → terkunci 15 menit.
--  * Optimistic locking lewat kolom `version` supaya dua bendahara tidak saling timpa.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.arisan (
  id              uuid primary key default gen_random_uuid(),
  name            text        not null,
  data            jsonb       not null default '{}'::jsonb,
  pin_hash        text        not null,
  version         integer     not null default 1,
  failed_attempts integer     not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.arisan enable row level security;
revoke all on public.arisan from anon, authenticated;

-- ---------------------------------------------------------------
-- Helper internal: verifikasi PIN + catat percobaan gagal.
-- Mengembalikan null kalau OK, atau kode error.
-- ---------------------------------------------------------------
create or replace function public._arisan_verify_pin(p_id uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r public.arisan%rowtype;
begin
  select * into r from public.arisan where id = p_id for update;
  if not found then
    return 'not_found';
  end if;
  if r.locked_until is not null and r.locked_until > now() then
    return 'locked';
  end if;
  if r.pin_hash <> crypt(coalesce(p_pin, ''), r.pin_hash) then
    update public.arisan
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5
                               then now() + interval '15 minutes' end
     where id = p_id;
    return 'invalid_pin';
  end if;
  if r.failed_attempts > 0 or r.locked_until is not null then
    update public.arisan set failed_attempts = 0, locked_until = null where id = p_id;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------
-- Buat arisan baru → mengembalikan id (dipakai di link ?g=<id>)
-- ---------------------------------------------------------------
create or replace function public.create_arisan(p_name text, p_pin text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_id uuid;
begin
  if length(coalesce(trim(p_name), '')) = 0 then
    return jsonb_build_object('ok', false, 'error', 'name_required');
  end if;
  if length(coalesce(p_pin, '')) < 4 then
    return jsonb_build_object('ok', false, 'error', 'pin_too_short');
  end if;
  if octet_length(coalesce(p_data, '{}'::jsonb)::text) > 500000 then
    return jsonb_build_object('ok', false, 'error', 'too_large');
  end if;
  insert into public.arisan (name, data, pin_hash)
  values (left(trim(p_name), 120), coalesce(p_data, '{}'::jsonb), crypt(p_pin, gen_salt('bf', 10)))
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'version', 1);
end;
$$;

-- ---------------------------------------------------------------
-- Baca data (publik, cukup tahu id)
-- ---------------------------------------------------------------
create or replace function public.get_arisan(p_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object('ok', true, 'name', name, 'data', data,
                            'version', version, 'updated_at', updated_at)
    from public.arisan where id = p_id;
$$;

-- ---------------------------------------------------------------
-- Cek PIN (untuk "Masuk sebagai bendahara")
-- ---------------------------------------------------------------
create or replace function public.check_pin(p_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  err text := public._arisan_verify_pin(p_id, p_pin);
begin
  if err is not null then
    return jsonb_build_object('ok', false, 'error', err);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------
-- Simpan data (butuh PIN + versi terakhir yang dibaca)
-- ---------------------------------------------------------------
create or replace function public.save_arisan(p_id uuid, p_pin text, p_data jsonb, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  err text;
  cur integer;
begin
  if octet_length(coalesce(p_data, '{}'::jsonb)::text) > 500000 then
    return jsonb_build_object('ok', false, 'error', 'too_large');
  end if;
  err := public._arisan_verify_pin(p_id, p_pin);
  if err is not null then
    return jsonb_build_object('ok', false, 'error', err);
  end if;
  select version into cur from public.arisan where id = p_id for update;
  if cur <> p_version then
    return jsonb_build_object('ok', false, 'error', 'version_conflict', 'version', cur);
  end if;
  update public.arisan
     set data = p_data,
         name = left(coalesce(nullif(trim(p_data->>'name'), ''), name), 120),
         version = version + 1,
         updated_at = now()
   where id = p_id
  returning version into cur;
  return jsonb_build_object('ok', true, 'version', cur);
end;
$$;

-- ---------------------------------------------------------------
-- Ganti PIN
-- ---------------------------------------------------------------
create or replace function public.change_pin(p_id uuid, p_old text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  err text;
begin
  if length(coalesce(p_new, '')) < 4 then
    return jsonb_build_object('ok', false, 'error', 'pin_too_short');
  end if;
  err := public._arisan_verify_pin(p_id, p_old);
  if err is not null then
    return jsonb_build_object('ok', false, 'error', err);
  end if;
  update public.arisan set pin_hash = crypt(p_new, gen_salt('bf', 10)) where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------
-- Hak akses: hanya fungsi publik yang boleh dipanggil anon.
-- ---------------------------------------------------------------
revoke all on function public._arisan_verify_pin(uuid, text) from public, anon, authenticated;
revoke all on function public.create_arisan(text, text, jsonb)          from public;
revoke all on function public.get_arisan(uuid)                          from public;
revoke all on function public.check_pin(uuid, text)                     from public;
revoke all on function public.save_arisan(uuid, text, jsonb, integer)   from public;
revoke all on function public.change_pin(uuid, text, text)              from public;
grant execute on function public.create_arisan(text, text, jsonb)        to anon, authenticated;
grant execute on function public.get_arisan(uuid)                        to anon, authenticated;
grant execute on function public.check_pin(uuid, text)                   to anon, authenticated;
grant execute on function public.save_arisan(uuid, text, jsonb, integer) to anon, authenticated;
grant execute on function public.change_pin(uuid, text, text)           to anon, authenticated;
