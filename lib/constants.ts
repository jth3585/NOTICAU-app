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

// sources.parser_key → 짧은 표시 라벨
export const SOURCE_LABELS: Record<string, string> = {
  cau_main: '본교',
  cau_bne: '경영대',
  cau_biz: '경영학부',
  cau_library: '학술정보원',
};

export function sourceLabel(parserKey: string | null | undefined): string {
  if (!parserKey) return '';
  return SOURCE_LABELS[parserKey] ?? parserKey;
}
