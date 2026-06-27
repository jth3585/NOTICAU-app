import Svg, { Path, Circle, Line, Polyline, Rect } from 'react-native-svg';

// 공용 라인 아이콘 모음 (lucide 기반, 24x24 viewBox, stroke 방식).
// 이모지를 대체하는 단색 아이콘. size/color props로 통일.

type IconProps = { size?: number; color: string };

function Base({ size = 22, children }: { size?: number; children: React.ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

// 🏠 홈
export function HomeIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke={color} />
      <Path d="M9 22V12h6v10" stroke={color} />
    </Base>
  );
}

// 📋 전체 공지 (clipboard-list)
export function ClipboardListIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" stroke={color} />
      <Rect x="8" y="2" width="8" height="4" rx="1" stroke={color} />
      <Path d="M12 11h4" stroke={color} />
      <Path d="M12 16h4" stroke={color} />
      <Path d="M8 11h.01" stroke={color} />
      <Path d="M8 16h.01" stroke={color} />
    </Base>
  );
}

// 👤 마이페이지 (user)
export function UserIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke={color} />
      <Circle cx="12" cy="7" r="4" stroke={color} />
    </Base>
  );
}

// 📁 폴더
export function FolderIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Path
        d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
        stroke={color}
      />
    </Base>
  );
}

// # 키워드 (hash)
export function HashIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Line x1="4" y1="9" x2="20" y2="9" stroke={color} />
      <Line x1="4" y1="15" x2="20" y2="15" stroke={color} />
      <Line x1="10" y1="3" x2="8" y2="21" stroke={color} />
      <Line x1="16" y1="3" x2="14" y2="21" stroke={color} />
    </Base>
  );
}

// ✉ 읽지 않음 (mail)
export function MailIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Rect x="2" y="4" width="20" height="16" rx="2" stroke={color} />
      <Path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" stroke={color} />
    </Base>
  );
}

// 📎 첨부 (paperclip)
export function PaperclipIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Path
        d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
        stroke={color}
      />
    </Base>
  );
}

// 🕒 시계 (clock)
export function ClockIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Circle cx="12" cy="12" r="10" stroke={color} />
      <Polyline points="12 6 12 12 16 14" stroke={color} />
    </Base>
  );
}

// 📅 캘린더 (calendar)
export function CalendarIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke={color} />
      <Line x1="16" y1="2" x2="16" y2="6" stroke={color} />
      <Line x1="8" y1="2" x2="8" y2="6" stroke={color} />
      <Line x1="3" y1="10" x2="21" y2="10" stroke={color} />
    </Base>
  );
}

// 🔔 알림 (bell)
export function BellIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke={color} />
      <Path d="M13.73 21a2 2 0 0 1-3.46 0" stroke={color} />
    </Base>
  );
}

// 📄 문서 (file-text)
export function FileTextIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={color} />
      <Path d="M14 2v6h6" stroke={color} />
      <Line x1="9" y1="13" x2="15" y2="13" stroke={color} />
      <Line x1="9" y1="17" x2="15" y2="17" stroke={color} />
    </Base>
  );
}

// 🛡 개인정보 (shield)
export function ShieldIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke={color} />
    </Base>
  );
}

// 🎓 학사모 (graduation-cap) — 학년
export function GraduationCapIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Path d="M22 10 12 5 2 10l10 5 10-5Z" stroke={color} />
      <Path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" stroke={color} />
      <Path d="M22 10v6" stroke={color} />
    </Base>
  );
}

// 🏛 건물 (building) — 캠퍼스
export function BuildingIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" stroke={color} />
      <Line x1="3" y1="21" x2="21" y2="21" stroke={color} />
      <Line x1="10" y1="8" x2="14" y2="8" stroke={color} />
      <Line x1="10" y1="12" x2="14" y2="12" stroke={color} />
      <Line x1="10" y1="16" x2="14" y2="16" stroke={color} />
    </Base>
  );
}

// 📖 펼친 책 (book-open) — 단과대/학과
export function BookOpenIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Path d="M2 4h6a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2H2z" stroke={color} />
      <Path d="M22 4h-6a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2H22z" stroke={color} />
    </Base>
  );
}

// ▤ 레이어 (layers) — 복수전공
export function LayersIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Path d="M12 2 2 7l10 5 10-5z" stroke={color} />
      <Path d="M2 17l10 5 10-5" stroke={color} />
      <Path d="M2 12l10 5 10-5" stroke={color} />
    </Base>
  );
}

// ✓ 원형 체크 (check-circle) — 재학상태
export function CheckCircleIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Circle cx="12" cy="12" r="9" stroke={color} />
      <Polyline points="8.5 12 11 14.5 15.5 9.5" stroke={color} />
    </Base>
  );
}

// ✏️ 연필 (pencil) — 수정
export function PencilIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Path d="M12 20h9" stroke={color} />
      <Path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" stroke={color} />
    </Base>
  );
}

// ⠿ 드래그 손잡이 (grip, 점 6개)
export function GripIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Circle cx="9" cy="5" r="1.5" />
      <Circle cx="9" cy="12" r="1.5" />
      <Circle cx="9" cy="19" r="1.5" />
      <Circle cx="15" cy="5" r="1.5" />
      <Circle cx="15" cy="12" r="1.5" />
      <Circle cx="15" cy="19" r="1.5" />
    </Svg>
  );
}

// 🗑 휴지통 (삭제)
export function TrashIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Polyline points="3 6 5 6 21 6" stroke={color} />
      <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke={color} />
      <Line x1="10" y1="11" x2="10" y2="17" stroke={color} />
      <Line x1="14" y1="11" x2="14" y2="17" stroke={color} />
    </Base>
  );
}

// ⓘ 정보 (info)
export function InfoIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Circle cx="12" cy="12" r="10" stroke={color} />
      <Line x1="12" y1="11" x2="12" y2="16" stroke={color} />
      <Path d="M12 8h.01" stroke={color} />
    </Base>
  );
}

// ✓ 체크
export function CheckIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Path d="M20 6 9 17l-5-5" stroke={color} />
    </Base>
  );
}

// ✕ 닫기/삭제
export function CloseIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Line x1="18" y1="6" x2="6" y2="18" stroke={color} />
      <Line x1="6" y1="6" x2="18" y2="18" stroke={color} />
    </Base>
  );
}

// → 오른쪽 (chevron)
export function ChevronRightIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Polyline points="9 18 15 12 9 6" stroke={color} />
    </Base>
  );
}

// ← 왼쪽 (chevron)
export function ChevronLeftIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Polyline points="15 18 9 12 15 6" stroke={color} />
    </Base>
  );
}

// ↑ 위 (chevron)
export function ChevronUpIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Polyline points="18 15 12 9 6 15" stroke={color} />
    </Base>
  );
}

// ↓ 아래 (chevron)
export function ChevronDownIcon({ size = 22, color }: IconProps) {
  return (
    <Base size={size}>
      <Polyline points="6 9 12 15 18 9" stroke={color} />
    </Base>
  );
}
