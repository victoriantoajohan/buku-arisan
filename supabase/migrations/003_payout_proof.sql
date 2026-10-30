-- Buku Arisan — migrasi 003: bukti transfer dari bendahara ke pemenang
-- Status "sudah ditransfer" disimpan di data arisan (jsonb); gambar buktinya
-- disimpan di tabel terpisah supaya data utama tetap ringan.
-- Aman dijalankan berulang kali.

create table if not exists public.arisan_proof (
  arisan_id  uuid        not null references public.arisan(id) on delete cascade,
  round      integer     not null,
  member_id  text        not null,
  image      text        not null,
  hash       text        not null,
  created_at timestamptz not null default now(),
  primary key (arisan_id, round, member_id)
);

alter table public.arisan_proof enable row level security;
revoke all on public.arisan_proof from anon, authenticated;

-- Simpan / hapus bukti (butuh PIN). p_img null atau '' = hapus.
create or replace function public.set_payout_proof(p_id uuid, p_pin text, p_round integer, p_member text, p_img text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  err text;
  h text;
begin
  if p_round is null or p_round < 0 or p_round > 1000 or length(coalesce(p_member, '')) not between 1 and 64 then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  if p_img is not null and p_img <> '' then
    if p_img !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' then
      return jsonb_build_object('ok', false, 'error', 'invalid_image');
    end if;
    if octet_length(p_img) > 700000 then
      return jsonb_build_object('ok', false, 'error', 'too_large');
    end if;
  end if;
  err := public._arisan_verify_pin(p_id, p_pin);
  if err is not null then
    return jsonb_build_object('ok', false, 'error', err);
  end if;
  if p_img is null or p_img = '' then
    delete from public.arisan_proof where arisan_id = p_id and round = p_round and member_id = p_member;
    return jsonb_build_object('ok', true, 'hash', null);
  end if;
  if (select count(*) from public.arisan_proof where arisan_id = p_id) >= 300 then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;
  h := left(md5(p_img), 12);
  insert into public.arisan_proof (arisan_id, round, member_id, image, hash)
  values (p_id, p_round, p_member, p_img, h)
  on conflict (arisan_id, round, member_id)
  do update set image = excluded.image, hash = excluded.hash, created_at = now();
  return jsonb_build_object('ok', true, 'hash', h);
end;
$$;

-- Lihat bukti (publik, cukup tahu id arisan)
create or replace function public.get_payout_proof(p_id uuid, p_round integer, p_member text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select image from public.arisan_proof
   where arisan_id = p_id and round = p_round and member_id = p_member;
$$;

revoke all on function public.set_payout_proof(uuid, text, integer, text, text) from public;
revoke all on function public.get_payout_proof(uuid, integer, text)             from public;
grant execute on function public.set_payout_proof(uuid, text, integer, text, text) to anon, authenticated;
grant execute on function public.get_payout_proof(uuid, integer, text)             to anon, authenticated;
