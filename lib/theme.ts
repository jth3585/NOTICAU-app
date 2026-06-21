// 디자인 토큰. 톤: B+A (Linear 효율 + 토스 친근). 라이트 팔레트.
// 도메인 상수는 constants.ts. 토큰은 전부 여기서.

export const COLORS = {
  // 베이스 (쿨 양각: 배경은 연한 쿨 그레이, 카드는 순백 + 그림자로 떠보이게)
  bg: '#F5F7FA', // 베이스 배경 (연한 쿨 그레이)
  surface: '#FFFFFF', // 카드 배경 (양각, SHADOW.card과 함께)
  surface2: '#EFF1F4', // 강조 박스 배경
  border: '#E5E7EB',

  // 텍스트 3단계
  text: '#1A1D21',
  textSecondary: '#5B6470',
  textTertiary: '#6B7280', // WCAG AA(약 4.8:1) — 기존 #9AA3AE는 대비 미달이라 한 단계 진하게

  // CAU Blue accent
  accent: '#4A90E2',
  accentSoft: '#EAF2FC',
  accentText: '#2C6DBA',
  // accent 기반 부드러운 그라데이션 (살짝 인디고 → accent → 딥블루). 대각선 사용 권장.
  accentGradient: ['#6E8CEE', '#4A90E2', '#3A79CE'] as const,

  // D-day 빨강
  danger: '#FF3B30',
  dangerSoft: '#FFE8E6',

  // 카테고리 8색 (메인 + soft 페어)
  categories: {
    '학사정보': { main: '#6366F1', soft: '#EEF0FF' },
    '장학&등록금': { main: '#10B981', soft: '#E6F7F1' },
    '채용&인턴': { main: '#7C3AED', soft: '#F3EDFD' },
    '교내외활동': { main: '#06B6D4', soft: '#E5F7FB' },
    '창업': { main: '#EC4899', soft: '#FCEAF3' },
    '재학상태': { main: '#F59E0B', soft: '#FEF4E6' },
    '기숙사': { main: '#14B8A6', soft: '#E5F7F5' },
    '시설&시스템': { main: '#6B7280', soft: '#F0F1F3' },
  },
} as const;

export const FONT = {
  display: 24, // 화면 큰 제목
  title: 22, // 섹션 헤더 (## 헤더 — 본문과 7px 격차)
  subtitle: 17, // AI 요약 본문
  body: 15, // 일반 본문
  caption: 13, // 메타 정보, 라벨
  micro: 11, // 배지, 마이크로
} as const;

export const WEIGHT = {
  bold: '700' as const,
  semibold: '600' as const,
  regular: '400' as const,
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const RADIUS = {
  badge: 6, // 작은 배지
  pill: 999, // 칩 (완전 둥근)
  box: 12, // 작은 박스
  card: 16, // 카드 (메인)
  modal: 20, // 모달, 큰 박스
} as const;

// 공용 타이포 토큰 (탭/화면 간 일관성). 스타일에 스프레드해서 사용.
export const TEXT = {
  // 화면 최상단 페이지 타이틀
  pageTitle: { fontSize: FONT.display, fontWeight: WEIGHT.bold, color: COLORS.text },
  // 섹션/그룹 구분 라벨 (작은 회색 대문자형)
  sectionLabel: {
    fontSize: FONT.caption, fontWeight: WEIGHT.bold, color: COLORS.textTertiary,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
} as const;

// 카드 양각용 미세 그림자 (iOS shadow + Android elevation)
export const SHADOW = {
  card: {
    shadowColor: '#1A1D21',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  // 토스 느낌의 컬러 그림자 — accent 블루가 은은하게 번지는 부드러운 그림자.
  // (Android는 API 28+ 에서 elevation 그림자에 shadowColor 반영)
  accent: {
    shadowColor: COLORS.accent,
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;
