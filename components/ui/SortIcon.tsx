import Svg, { Line, Polyline } from 'react-native-svg';

// 정렬 아이콘 (위아래 화살표)
export function SortIcon({ size = 18, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="8 16 12 20 16 16" />
      <Line x1="12" y1="20" x2="12" y2="4" />
      <Polyline points="16 8 12 4 8 8" />
    </Svg>
  );
}
