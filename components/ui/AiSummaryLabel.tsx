import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path, Text as SvgText } from 'react-native-svg';

// AI 요약 라벨: 그라데이션(파랑→보라) 스파클 + 그라데이션 볼드 글씨.
// react-native-svg의 gradient fill로 처리 → masked-view 등 새 네이티브 의존성 불필요.
const C1 = '#5B9BF0';
const C2 = '#9B7BF0';

export function AiSummaryLabel({ text = 'AI 요약' }: { text?: string }) {
  // 글씨 폭은 글자 수에 비례해 넉넉히 (좌측 정렬이라 남는 폭은 안 보임)
  const textW = Math.max(40, text.length * 15 + 6);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Svg width={16} height={16} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id="aiSpark" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={C1} />
            <Stop offset="1" stopColor={C2} />
          </LinearGradient>
        </Defs>
        <Path d="M12 1 Q12.9 11.1 23 12 Q12.9 12.9 12 23 Q11.1 12.9 1 12 Q11.1 11.1 12 1 Z" fill="url(#aiSpark)" />
      </Svg>
      <Svg width={textW} height={18}>
        <Defs>
          <LinearGradient id="aiText" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={C1} />
            <Stop offset="1" stopColor={C2} />
          </LinearGradient>
        </Defs>
        <SvgText x={0} y={14} fontSize={14} fontWeight="bold" fill="url(#aiText)">{text}</SvgText>
      </Svg>
    </View>
  );
}
