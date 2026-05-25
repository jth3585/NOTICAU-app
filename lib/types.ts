// 리스트 쿼리 응답 형태 타입.
// 쿼리: notices.select('*, notice_meta(*), sources(parser_key, name)')
//
// 주의: 실제 DB의 sources 컬럼은 name (name_ko/name_en 없음).

export type NoticeMeta = {
  notice_id: string;
  topic: string | null;
  action: string | null;
  deadline_at: string | null; // ISO timestamptz 문자열
  target_grades: number[] | null;
  target_depts: string[] | null;
  target_campuses: string[] | null;
};

export type Source = {
  parser_key: string | null;
  name: string | null;
};

export type Notice = {
  id: string;
  source_id: string;
  title: string;
  source_url: string | null;
  source_category: string | null;
  posted_at: string | null; // ISO timestamptz 문자열
  is_pinned: boolean | null;

  // PostgREST 임베드. 1:1/N:1이라 보통 단일 객체로 오지만,
  // 방어적으로 배열 가능성도 허용 (App.tsx에서 normalize).
  notice_meta: NoticeMeta | NoticeMeta[] | null;
  sources: Source | Source[] | null;
};
