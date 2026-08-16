-- 가입자 시트 동기화 cron (2026-08-16)
--
-- 매일 KST 09:00 (= UTC 00:00) 에 export_signups_sheet 호출 → Google Sheets 전체 스냅샷 갱신.
-- 함수 배포 + 시트 공유가 끝난 뒤 등록 (이전에 걸면 403/404 실행만 쌓임).

select cron.schedule(
  'export_signups_sheet',
  '0 0 * * *',
  $$
  select net.http_post(
    url := 'https://ntepavohsldelxaiubip.supabase.co/functions/v1/export_signups_sheet',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
