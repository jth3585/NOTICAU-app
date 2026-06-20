import Svg, { Path } from 'react-native-svg';

// 4-pointed sparkle (사각별). lucide Sparkles와 동일한 실루엣.
export function SparkleIcon({ size = 14, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 1.5 Q13 11 22.5 12 Q13 13 12 22.5 Q11 13 1.5 12 Q11 11 12 1.5 Z"
        fill={color}
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}
