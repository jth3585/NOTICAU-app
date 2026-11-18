-- Expo 푸시 영수증(receipt) 확인용 티켓 보관.
-- 발송 직후 받은 티켓 id 를 남겨 두었다가 15분 이상 지난 뒤 getReceipts 로 실제 전달 결과를 확인한다.
-- 영수증의 DeviceNotRegistered(앱 삭제 등)는 push_tokens.is_active=false 로 바꿔 더는 보내지 않는다.
-- Expo 는 영수증을 24시간만 보관하므로 그보다 오래된 행은 확인 단계에서 지운다.
-- 쓰기·읽기는 엣지 함수(service role)만 한다 → RLS 켜고 정책 없음.

create table if not exists public.push_tickets (
  id text primary key,            -- Expo 티켓 id(= receipt id)
  token text not null,            -- 보낸 Expo push token
  created_at timestamptz not null default now()
);

create index if not exists push_tickets_created_at_idx on public.push_tickets (created_at);

alter table public.push_tickets enable row level security;
