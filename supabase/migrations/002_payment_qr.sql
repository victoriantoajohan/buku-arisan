-- Buku Arisan — migrasi 002: gambar QR pembayaran (QRIS)
-- Gambar disimpan di kolom terpisah supaya tidak ikut terkirim setiap kali
-- checklist disimpan atau halaman melakukan polling. Klien hanya mengambil
-- gambar ketika `qr_hash` berubah.
-- Aman dijalankan berulang kali.

alter table public.arisan add column if not exists pay_qr text;
alter table public.arisan add column if not exists pay_qr_hash text;

-- get_arisan sekarang ikut mengembalikan qr_hash (tanpa gambarnya)
create or replace function public.get_arisan(p_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object('ok', true, 'name', name, 'data', data,
                            'version', version, 'updated_at', updated_at,
                            'qr_hash', pay_qr_hash)
    from public.arisan where id = p_id;
$$;

-- Ambil gambar QR (publik, cukup tahu id)
create or replace function public.get_arisan_qr(p_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select pay_qr from public.arisan where id = p_id;
$$;

-- Simpan / hapus gambar QR (butuh PIN). p_qr null atau '' = hapus.
create or replace function public.set_arisan_qr(p_id uuid, p_pin text, p_qr text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  err text;
  h text;
begin
  if p_qr is not null and p_qr <> '' then
    if p_qr !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' then
      return jsonb_build_object('ok', false, 'error', 'invalid_image');
    end if;
    if octet_length(p_qr) > 700000 then
      return jsonb_build_object('ok', false, 'error', 'too_large');
    end if;
  end if;
  err := public._arisan_verify_pin(p_id, p_pin);
  if err is not null then
    return jsonb_build_object('ok', false, 'error', err);
  end if;
  h := case when p_qr is null or p_qr = '' then null else left(md5(p_qr), 12) end;
  update public.arisan
     set pay_qr = nullif(p_qr, ''), pay_qr_hash = h, updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true, 'qr_hash', h);
end;
$$;

revoke all on function public.get_arisan(uuid)                    from public;
revoke all on function public.get_arisan_qr(uuid)                 from public;
revoke all on function public.set_arisan_qr(uuid, text, text)     from public;
grant execute on function public.get_arisan(uuid)                 to anon, authenticated;
grant execute on function public.get_arisan_qr(uuid)              to anon, authenticated;
grant execute on function public.set_arisan_qr(uuid, text, text)  to anon, authenticated;
