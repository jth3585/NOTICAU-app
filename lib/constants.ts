// 디자인 토큰 + 도메인 상수. 라이트 팔레트만 (다크는 v2).

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

// sources.parser_key → 짧은 표시 라벨
export const SOURCE_LABELS: Record<string, string> = {
  cau_main: '본교',
  cau_bne: '경영대',
  cau_biz: '경영학부',
};

export function sourceLabel(parserKey: string | null | undefined): string {
  if (!parserKey) return '';
  return SOURCE_LABELS[parserKey] ?? parserKey;
}

export const COLORS = {
  bg: '#FFFFFF',
  card: '#F5F5F7',
  text: '#1C1C1E',
  textDim: '#6E6E73',
  accent: '#FF3B30', // D-day 임박 빨강
  accentDim: '#8E8E93', // 마감 지남 회색
  badgeBg: '#E5E5EA',
};

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const RADIUS = { card: 12, badge: 16 };

export const FONT = {
  badge: 11,
  meta: 13,
  body: 15,
  cardTitle: 17,
  detailTitle: 22,
  header: 28,
};
