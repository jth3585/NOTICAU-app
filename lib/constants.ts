// 도메인 상수만. 디자인 토큰은 lib/theme.ts.

// 카테고리 칩 (단일 선택). '전체' = 필터 없음.
export const CHIP_TOPICS = [
  '전체',
  '학사정보',
  '장학&등록금',
  '채용&인턴',
  '교내외활동',
  '창업',
  '재학상태',
  '기숙사',
  '시설&시스템',
] as const;

// 출처 표시 이름은 DB sources.name이 단일 소스다(하드코딩 맵 폐지).
//  - 대표 출처 배지: 공지에 조인돼 오는 sources.name 사용 (components/ui/SourceBadge)
//  - 교차출처 중복(parser_key 배열): lib/sources.ts의 useSourceLabels()로 해석
// → DB에 출처 추가 시 name만 채우면 앱 재빌드 없이 표시됨.
