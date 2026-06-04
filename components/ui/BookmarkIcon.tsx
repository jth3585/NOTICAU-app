import Svg, { Path } from 'react-native-svg';

// 표준 북마크 모양 (lucide Bookmark와 동일 path).
// filled=false: outline만, filled=true: 동일 색으로 채움.
export function BookmarkIcon({
  size = 22,
  filled = false,
  color,
}: {
  size?: number;
  filled?: boolean;
  color: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </Svg>
  );
}
