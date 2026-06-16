import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';
import { CalendarIcon, CheckIcon } from './icons';
import { addNoticeToCalendar, getSavedEventId, removeNoticeFromCalendar } from '../../lib/calendar';
import type { Notice } from '../../lib/types';

// 공지 마감일을 기기 캘린더에 추가/해제하는 토글 버튼.
// 마감일이 있을 때만 상세화면에서 렌더. eventId 로컬 매핑으로 상태 복원.
export function AddToCalendarButton({ notice, deadlineAt }: { notice: Notice; deadlineAt: string }) {
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getSavedEventId(notice.id).then((id) => { if (alive) setAdded(!!id); });
    return () => { alive = false; };
  }, [notice.id]);

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (added) {
        await removeNoticeFromCalendar(notice.id);
        setAdded(false);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        const res = await addNoticeToCalendar(notice, deadlineAt);
        if (res.ok) {
          setAdded(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else if (res.reason === 'permission') {
          Alert.alert(
            '캘린더 권한 필요',
            '설정에서 NOTICAU의 캘린더 접근을 허용해주세요.',
            [{ text: '취소', style: 'cancel' }, { text: '설정 열기', onPress: () => Linking.openSettings() }],
          );
        } else if (res.reason === 'no-calendar') {
          Alert.alert('캘린더 없음', '추가할 수 있는 캘린더를 찾지 못했습니다.');
        } else {
          Alert.alert('추가 실패', '캘린더에 추가하지 못했습니다. 잠시 후 다시 시도해주세요.');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      activeOpacity={0.7}
      style={[styles.btn, added && styles.btnAdded]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={added ? COLORS.accentText : COLORS.accent} />
      ) : added ? (
        <CheckIcon size={18} color={COLORS.accentText} />
      ) : (
        <CalendarIcon size={18} color={COLORS.accent} />
      )}
      <Text style={[styles.text, added && styles.textAdded]}>
        {added ? '캘린더에 추가됨' : '캘린더에 추가'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    alignSelf: 'flex-start',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.surface,
    marginBottom: SPACING.sm,
  },
  btnAdded: {
    borderColor: COLORS.accentSoft,
    backgroundColor: COLORS.accentSoft,
  },
  text: { fontSize: FONT.caption, fontWeight: WEIGHT.bold, color: COLORS.accent },
  textAdded: { color: COLORS.accentText },
});
