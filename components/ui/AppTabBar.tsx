import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSequence, withTiming, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { COLORS, FONT, WEIGHT } from '../../lib/theme';
import { HomeIcon, ClipboardListIcon, UserIcon } from './icons';
import { BookmarkIcon } from './BookmarkIcon';

type IconCmp = (p: { size?: number; color: string }) => React.ReactElement;

const ICONS: Record<string, IconCmp> = {
  Home: HomeIcon,
  Feed: ClipboardListIcon,
  Bookmark: (p) => <BookmarkIcon size={p.size} color={p.color} />,
  MyPage: UserIcon,
};
const LABELS: Record<string, string> = {
  Home: '홈', Feed: '공지', Bookmark: '북마크', MyPage: '프로필',
};

function TabItem({ focused, Icon, label, onPress }: {
  focused: boolean; Icon: IconCmp; label: string; onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const color = focused ? COLORS.accent : COLORS.textTertiary;

  const handlePress = () => {
    // 토스 느낌: 눌리듯 살짝 수축 → 스프링으로 살짝 오버슈트하며 튕겨 복귀(과하지 않게).
    scale.value = withSequence(
      withTiming(0.93, { duration: 80 }),
      withSpring(1, { damping: 15, stiffness: 300, mass: 0.5 }),
    );
    onPress();
  };

  return (
    <Pressable style={styles.item} onPress={handlePress} accessibilityRole="button" accessibilityState={{ selected: focused }} accessibilityLabel={label}>
      <Animated.View style={[styles.itemInner, aStyle]}>
        <Icon size={24} color={color} />
        <Text style={[styles.label, { color }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

export function AppTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const onPress = () => {
          // 재탭 스크롤/새로고침(useTabReselect)이 동작하도록 항상 tabPress emit.
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <TabItem
            key={route.key}
            focused={focused}
            Icon={ICONS[route.name] ?? HomeIcon}
            label={LABELS[route.name] ?? route.name}
            onPress={onPress}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    // 라운드된 바를 콘텐츠 위로 살짝 띄우는 부드러운 상단 그림자
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 16,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  itemInner: { alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontSize: FONT.micro, fontWeight: WEIGHT.semibold },
});
