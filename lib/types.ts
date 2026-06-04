// 리스트 쿼리 응답 형태 타입.
// 쿼리: notices.select('*, notice_meta(*), sources(parser_key, name)')
//
// 주의: 실제 DB의 sources 컬럼은 name (name_ko/name_en 없음).

export type EnrollmentStatus = 'enrolled' | 'leave' | 'returning' | 'graduating';

export type NoticeMeta = {
  notice_id: string;
  topic: string | null;
  action: string | null;
  deadline_at: string | null; // ISO timestamptz 문자열
  target_grades: number[] | null;
  target_depts: string[] | null;
  target_campuses: string[] | null;
  // 2026-05 추가 (이 화면에선 미사용, 다음 세션 마이페이지에서 사용)
  target_enrollment_status: EnrollmentStatus[] | null;
  targets_freshmen: boolean;
  // LLM이 재구성한 모바일용 마크다운. null이면 body_text 폴백.
  body_markdown: string | null;
};

export type Source = {
  parser_key: string | null;
  name: string | null;
};

export type Notice = {
  id: string;
  source_id: string;
  title: string;
  body_text: string | null;
  body_image_urls: string[] | null;
  attachment_urls: string[] | null;
  source_url: string | null;
  source_category: string | null;
  author: string | null;
  posted_at: string | null; // ISO timestamptz 문자열
  is_pinned: boolean | null;

  // PostgREST 임베드. 1:1/N:1이라 보통 단일 객체로 오지만,
  // 방어적으로 배열 가능성도 허용 (format.ts의 one()으로 정규화).
  notice_meta: NoticeMeta | NoticeMeta[] | null;
  sources: Source | Source[] | null;
};

// react-navigation 스택 파라미터
export type RootStackParamList = {
  Tabs: undefined;
  Detail: { notice: Notice };
};

export type TabParamList = {
  Home: undefined;
  Feed: undefined;
  Bookmark: undefined;
  MyPage: undefined;
};
