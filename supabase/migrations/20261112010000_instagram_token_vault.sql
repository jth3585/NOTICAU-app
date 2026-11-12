-- Instagram Graph API 토큰을 Supabase secret(env) 대신 vault에 보관 → 엣지 함수가 스스로 갱신 가능.
-- cau_instagram 의 tokenMaint 모드가 장기 사용자 토큰을 '만료 없는 페이지 토큰'으로 바꿔 여기에 저장한다.
-- 토큰 재발급 시(비번 변경·권한 해제 등): 대시보드 SQL에서 select public.set_instagram_token('<새 장기 사용자 토큰>');
--   → 다음 tokenMaint(주 1회, 수동 호출 가능)가 페이지 토큰으로 변환.

create or replace function public.get_instagram_token()
returns text
language sql
security definer
set search_path to ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'instagram_token' limit 1
$$;

create or replace function public.set_instagram_token(p_token text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare v_id uuid;
begin
  if p_token is null or length(p_token) < 20 then
    raise exception 'invalid token';
  end if;
  select id into v_id from vault.secrets where name = 'instagram_token';
  if v_id is null then
    perform vault.create_secret(p_token, 'instagram_token', coalesce(p_note, ''));
  else
    perform vault.update_secret(v_id, p_token, 'instagram_token', coalesce(p_note, ''));
  end if;
end $$;

revoke all on function public.get_instagram_token() from public, anon, authenticated;
revoke all on function public.set_instagram_token(text, text) from public, anon, authenticated;
grant execute on function public.get_instagram_token() to service_role;
grant execute on function public.set_instagram_token(text, text) to service_role;

-- 연동 상태(토큰 종류·만료·마지막 오류). 공개 접근 없음(RLS on, 정책 없음 → service role 만).
create table if not exists public.integration_status (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.integration_status enable row level security;
