-- 인스타 이미지 재호스팅(cau_instagram → Storage crawled-images/ig/…)의 보관 기간 정리.
-- 게시 30일(IMG_KEEP_DAYS) 지난 인스타 글의 이미지를 Storage 에서 지우고 body_image_urls 를 비운다(북마크된 글은 유지).
-- Storage 객체는 SQL 로 지울 수 없어(storage.objects 직접 삭제 차단) 엣지 함수의 purgeImages 모드가 Storage API 로 지운다.
-- 매일 04:41 KST(19:41 UTC). 1회 최대 200건.
select cron.unschedule('cau_instagram_purge') where exists (select 1 from cron.job where jobname = 'cau_instagram_purge');
select cron.schedule('cau_instagram_purge', '41 19 * * *', $$
  select net.http_post(
    url:='https://ntepavohsldelxaiubip.supabase.co/functions/v1/cau_instagram',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
    body:='{"purgeImages":true}'::jsonb,
    timeout_milliseconds:=150000);
$$);
