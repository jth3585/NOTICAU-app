-- 프로필 수정에서 캠퍼스를 바꾸면 앱이 college/dept를 null로 리셋하는데,
-- college 컬럼의 NOT NULL 제약 때문에 UPDATE 전체가 거부(HTTP 400,
-- "null value in column \"college\" ... violates not-null constraint")되어
-- 캠퍼스 변경 자체가 저장되지 않던 문제를 수정한다.
-- 앱 데이터 모델은 이미 college를 nullable(string | null)로 다룬다.
ALTER TABLE public.profiles ALTER COLUMN college DROP NOT NULL;
