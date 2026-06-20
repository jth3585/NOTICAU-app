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

  // PostgREST 임베드. 1:1/N:1이라 보통 단일 객체로 오지만,
  // 방어적으로 배열 가능성도 허용 (format.ts의 one()으로 정규화).
  notice_meta: NoticeMeta | NoticeMeta[] | null;
  sources: Source | Source[] | null;
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
};

export type UserKeyword = {
  id: string;
  user_id: string;
  keyword: string;
  notify: boolean;
};

// react-navigation 스택 파라미터
export type RootStackParamList = {
  Onboarding: undefined;
  Tabs: undefined;
  Detail: { notice: Notice };
  BookmarkFolder:
    | { folder: 'unread' | 'keyword' }
    | { folder: 'custom'; folderId: string; folderName: string };
  ProfileEdit: undefined;
  KeywordManage: undefined;
  CategoryPrefs: undefined;
  NotificationSettings: undefined;
  AccountInfo: undefined;
  Terms: undefined;
  Privacy: undefined;
  DeleteAccount: undefined;
};

export type TabParamList = {
  // tab: 알림 딥링크로 특정 필터 탭을 열 때 (소비 후 비움)
  Home: { tab?: 'new' | 'keyword' | 'deadline' } | undefined;
  Feed: undefined;
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
