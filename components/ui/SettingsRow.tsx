import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS, FONT, RADIUS, SHADOW, SPACING } from '../../lib/theme';
import { ChevronRightIcon } from './icons';

// 설정 그룹 카드 (흰 양각 컨테이너)
export function SettingsGroup({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

// 설정 행: 틴트 아이콘 + 라벨 + chevron. danger 변형.
export function SettingsRow({
  icon, label, onPress, danger, last,
}: {
  icon?: ReactNode;
  label: string;
  onPress?: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  return (
    <TouchableOpacity style={[styles.row, last && styles.rowLast]} onPress={onPress} activeOpacity={0.6}>
      <View style={styles.left}>
        {icon ? <View style={[styles.iconBox, danger && styles.iconBoxDanger]}>{icon}</View> : null}
        <Text style={[styles.label, danger && styles.labelDanger]}>{label}</Text>
      </View>
      <ChevronRightIcon size={18} color={COLORS.textTertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    ...SHADOW.card,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md + 2,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  rowLast: { borderBottomWidth: 0 },
  left: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, flex: 1 },
  iconBox: {
    width: 30, height: 30, borderRadius: 9,
    backgroundColor: COLORS.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBoxDanger: { backgroundColor: COLORS.dangerSoft },
  label: { fontSize: FONT.body, color: COLORS.text },
  labelDanger: { color: COLORS.danger },
});
