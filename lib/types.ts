// 리스트 쿼리 응답 형태 타입.
// 쿼리: notices.select('*, notice_meta(*), sources(parser_key, name)')
//
// 주의: 실제 DB의 sources 컬럼은 name (name_ko/name_en 없음).

export type EnrollmentStatus = 'enrolled' | 'on_leave' | 'graduating';

export type NoticeMeta = {
  notice_id: string;
  topic: string | null;
  action: string | null;
  apply_start_at: string | null; // 신청 시작일 (없으면 null). now<이 값이면 "신청 D-N"
  deadline_at: string | null;    // 신청 마감/종료
  target_grades: number[] | null;
  target_depts: string[] | null;
  target_campuses: string[] | null;
  target_enrollment_status: EnrollmentStatus[] | null;
  targets_freshmen: boolean;
  excludes_undergrad?: boolean | null;
  body_markdown: string | null;
};

export type Source = {
  parser_key: string | null;
  name: string | null;
  campus?: string | null; // 'seoul' | 'anseong' | 'both' — 게시판 자체의 캠퍼스 귀속
  owner_unit?: string | null; // 학과 게시판의 소속 단위 코드(dept/college). null=전체 게시판
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
  crawled_at: string | null; // 우리 DB에 적재된 시각 (새공지 판별용)
  is_pinned: boolean | null;

  // 교차출처 중복 처리: 비대표 공지는 duplicate_of=대표id(피드에서 제외).
  // 대표 공지는 dup_count(다른 게시판 수)/dup_source_keys(다른 출처 parser_key)를 가짐.
  duplicate_of: string | null;
  dup_count: number | null;
  dup_source_keys: string[] | null;

  // 'board'(게시판) | 'instagram'(학생회 인스타). 행사 탭 RPC 응답에만 실려 온다(일반 피드는 게시판뿐).
  channel?: string | null;
  // 행사 탭(events_feed RPC) 전용: 공지에서 뽑은 행사 정보.
  event?: EventInfo | null;

  // PostgREST 임베드. 1:1/N:1이라 보통 단일 객체로 오지만,
  // 방어적으로 배열 가능성도 허용 (format.ts의 one()으로 정규화).
  notice_meta: NoticeMeta | NoticeMeta[] | null;
  sources: Source | Source[] | null;
};

// 행사 탭: event_extract 가 뽑은 행사 정보(같은 행사를 올린 여러 글은 서버가 대표 1건으로 묶어 준다).
export type EventInfo = {
  kind: 'event' | 'giveaway';   // 참석형 행사 | 경품·혜택 참여형
  name: string | null;          // 말머리·수식어를 뺀 행사 이름
  start_at: string | null;      // 자정(00:00 KST)이면 시간 미상
  end_at: string | null;
  place: string | null;
  ends_at: string | null;       // 이 시각이 지나면 목록에서 빠진다(서버 계산). null = 일정 미정
  open: boolean;                // true = 타 학과도 참석 가능
  member_units: string[];       // open=false 일 때 참석 가능한 소속 코드(학과·단과대)
};

// 다이제스트/매칭용 공유 타입
export type Profile = {
  user_id: string;
  grade: number;
  campus: string;
  college: string | null;
  dept: string | null;
  dept_secondary: string | null;
  enrollment_status: string[];
  is_dormitory: boolean;
  nickname: string | null;
  show_cross_dept?: boolean; // 타 학과 게시판의 전공무관 공지 노출 여부(기본 true)
};

export type UserKeyword = {
  id: string;
  user_id: string;
  keyword: string;
  notify: boolean;
  title_only?: boolean; // true면 제목만 매칭, false(기본)면 제목+본문
};

// react-navigation 스택 파라미터
export type RootStackParamList = {
  Onboarding: undefined;
  Tabs: undefined;
  Detail: { notice: Notice; source?: string };
  BookmarkFolder:
    | { folder: 'unread' | 'keyword' }
    | { folder: 'custom'; folderId: string; folderName: string };
  ProfileEdit: undefined;
  KeywordManage: undefined;
  CategoryPrefs: undefined;
  DeptNoticePrefs: undefined;
  NotificationSettings: undefined;
  AccountInfo: undefined;
  Terms: undefined;
  Privacy: undefined;
  DeleteAccount: undefined;
  // 알림함(홈 🔔) / 알림 하나에 묶인 공지 모음
  Notifications: undefined;
  NotificationNotices: { notificationId: string };
};

export type TabParamList = {
  // tab: 알림 딥링크로 특정 필터 탭을 열 때 (소비 후 비움)
  Home: { tab?: 'new' | 'keyword' | 'deadline' } | undefined;
  Feed: undefined;
  Events: undefined;
  Bookmark: undefined;
  MyPage: undefined;
};

export type OnboardingStackParamList = {
  Grade: undefined;
  Campus: undefined;
  College: undefined;
  Dept: { collegeCode: string };
  SecondaryDept: undefined;
  Enrollment: undefined;
  Nickname: undefined;
};
