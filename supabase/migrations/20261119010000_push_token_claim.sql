-- 푸시 토큰 소유권 이전 (2026-11-19)
--
-- 문제: push_tokens 는 token 이 PK 이고 RLS 가 "본인 행만(auth.uid() = user_id)" 이다.
--   앱을 다시 설치하면 익명 계정이 새로 생기지만 기기의 Expo 푸시 토큰은 그대로라서,
--   앱의 upsert(on conflict token do update)가 '예전 계정 소유 행'을 고치려다 RLS 에 막힌다.
--   앱은 이 오류를 경고만 찍고 넘어가므로 → 새 계정은 토큰이 없어 푸시를 못 받고,
--   기기에는 예전 계정 기준 알림(옛 학과·키워드)이 계속 간다. 운영자 계정에서 발견.
-- 해결: insert 직전에 같은 토큰을 가진 다른 계정의 행을 지운다(토큰을 가진 기기가 지금 로그인한 계정의 것).
--   앱 코드는 그대로(모든 배포 버전에 바로 적용). RLS 의 with check(auth.uid() = user_id)는 트리거 뒤에
--   검사되므로, 남의 user_id 로 넣으려는 시도는 실패하고 삭제도 함께 롤백된다.
--   토큰 문자열을 알아야만 가져갈 수 있다(기기 밖으로 나가지 않는 값).
-- previous_user_id: 옮겨 온 행에 예전 소유자를 남긴다(영향 규모 확인용).

alter table public.push_tokens add column if not exists previous_user_id uuid;

create or replace function public.push_tokens_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_owner uuid;
begin
  delete from public.push_tokens
  where token = new.token and user_id is distinct from new.user_id
  returning user_id into old_owner;
  if old_owner is not null then
    new.previous_user_id := old_owner;
  end if;
  return new;
end;
$$;

revoke all on function public.push_tokens_claim() from public, anon, authenticated;

drop trigger if exists push_tokens_claim on public.push_tokens;
create trigger push_tokens_claim
  before insert on public.push_tokens
  for each row execute function public.push_tokens_claim();
