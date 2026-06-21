import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONT, SPACING, WEIGHT } from '../../lib/theme';

// 전역 오프라인 배너 — 연결이 끊기면 상단에 안내. 루트에 1개 마운트.
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      // isConnected가 명시적으로 false일 때만 (초기 null은 무시)
      setOffline(state.isConnected === false);
    });
    return () => unsub();
  }, []);

  if (!offline) return null;

  return (
    <Animated.View
      entering={SlideInUp.duration(220)}
      exiting={SlideOutUp.duration(180)}
      style={[styles.bar, { paddingTop: insets.top + SPACING.xs }]}
    >
      <Text style={styles.text}>오프라인이에요 · 인터넷 연결을 확인해 주세요</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    backgroundColor: COLORS.text, // 다크 바
    paddingBottom: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    zIndex: 100,
  },
  text: { color: '#fff', fontSize: FONT.caption, fontWeight: WEIGHT.semibold },
});
