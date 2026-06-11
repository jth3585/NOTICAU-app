import Svg, { Path } from 'react-native-svg';

// iOS 스타일 공유 아이콘 (박스 + 위로 향한 화살표). BookmarkIcon과 동일 stroke 패턴.
export function ShareIcon({ size = 22, color }: { size?: number; color: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M12 2v13" />
      <Path d="M8 6l4-4 4 4" />
      <Path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
    </Svg>
  );
}
