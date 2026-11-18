-- crawler_watch 엣지 함수: 매일 00:30 UTC(09:30 KST). 크롤러 문제를 관리자(ops_admins) 폰으로 알린다.
-- (2026-11-18 SQL 로 등록함 — jobid 100. 이 파일은 기록용이며 다시 실행해도 같은 잡으로 덮어쓴다.)
select cron.unschedule('crawler_watch') where exists (select 1 from cron.job where jobname = 'crawler_watch');
select cron.schedule('crawler_watch', '30 0 * * *', $$
  SELECT net.http_post(
    url := 'https://ntepavohsldelxaiubip.supabase.co/functions/v1/crawler_watch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
