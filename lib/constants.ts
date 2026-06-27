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
  cau_bne: '경영경제대학',
  cau_biz: '경영학부',
  cau_biz_career: '경력개발센터',
  cau_econ: '경제학부',
  cau_stat: '응용통계학과',
  cau_adpr: '광고홍보학부',
  cau_security: '산업보안학과',
  cau_iacf: '산학협력단',
  cau_abeek: '공학교육혁신센터',
  cau_library: '학술정보원',
  cau_dorm: '생활관',
  cau_dorm_seoul: '생활관',
};

export function sourceLabel(parserKey: string | null | undefined): string {
  if (!parserKey) return '';
  return SOURCE_LABELS[parserKey] ?? parserKey;
}
